"""Web research for the Riset Web chat mode.

A page is crawled once, reduced to plain text, and stored against the
conversation. The chat service later injects the stored text as context.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.config import Settings, get_settings
from app.deps import CurrentUser, rate_limit, read_rate_limit
from app.schemas import ResearchCrawlRequest, ResearchSourceOut
from app.services.web_crawler import CrawlError, fetch_page, normalize_url

router = APIRouter(prefix="/api/research", tags=["research"])


async def _resolve_conversation(
    client: Any, user_id: str, conversation_id: str | None
) -> str:
    if conversation_id:
        response = (
            await client.table("conversations")
            .select("id, mode")
            .eq("id", conversation_id)
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        if not response or not response.data:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, detail="Percakapan tidak ditemukan."
            )
        if (response.data.get("mode") or "general") != "research":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Crawl hanya tersedia pada mode Riset Web.",
            )
        return response.data["id"]

    created = (
        await client.table("conversations")
        .insert({"user_id": user_id, "title": None, "mode": "research"})
        .execute()
    )
    return created.data[0]["id"]


def _excerpt(text: str, limit: int = 280) -> str:
    cleaned = " ".join((text or "").split())
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit].rstrip() + "..."


def _to_source(row: dict[str, Any]) -> ResearchSourceOut:
    content = row.get("content") or ""
    return ResearchSourceOut(
        id=row["id"],
        conversation_id=row["conversation_id"],
        url=row.get("url") or "",
        title=row.get("title") or "",
        site=row.get("site") or "",
        excerpt=_excerpt(content),
        char_count=len(content),
        created_at=row.get("created_at"),
    )


@router.post(
    "/crawl", response_model=ResearchSourceOut, status_code=status.HTTP_201_CREATED
)
async def crawl_page(
    payload: ResearchCrawlRequest,
    user: CurrentUser = Depends(rate_limit),
    settings: Settings = Depends(get_settings),
) -> ResearchSourceOut:
    try:
        url = normalize_url(payload.url)
    except CrawlError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    conversation_id = await _resolve_conversation(
        user.client, user.id, payload.conversation_id
    )

    existing = (
        await user.client.table("research_sources")
        .select("id", count="exact")
        .eq("conversation_id", conversation_id)
        .execute()
    )
    if int(existing.count or 0) >= settings.research_max_sources:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Maksimal {settings.research_max_sources} sumber per percakapan. "
                "Hapus salah satu sumber dulu."
            ),
        )

    try:
        page = await fetch_page(
            url,
            timeout=settings.research_fetch_timeout,
            max_bytes=settings.research_max_bytes,
        )
    except CrawlError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    content = page.text[: settings.research_max_chars]
    response = (
        await user.client.table("research_sources")
        .insert(
            {
                "user_id": user.id,
                "conversation_id": conversation_id,
                "url": page.url,
                "title": page.title[:300],
                "site": page.site[:200],
                "content": content,
            }
        )
        .execute()
    )
    return _to_source(response.data[0])


@router.get("/sources", response_model=list[ResearchSourceOut])
async def list_sources(
    conversation_id: str = Query(..., min_length=1),
    user: CurrentUser = Depends(read_rate_limit),
) -> list[ResearchSourceOut]:
    response = (
        await user.client.table("research_sources")
        .select("id, conversation_id, url, title, site, content, created_at")
        .eq("conversation_id", conversation_id)
        .eq("user_id", user.id)
        .order("created_at")
        .execute()
    )
    return [_to_source(row) for row in (response.data or [])]


@router.delete("/sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_source(
    source_id: str,
    user: CurrentUser = Depends(rate_limit),
) -> None:
    await (
        user.client.table("research_sources")
        .delete()
        .eq("id", source_id)
        .eq("user_id", user.id)
        .execute()
    )