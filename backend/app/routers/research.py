"""Web research for the Riset Web chat mode.

A page is crawled once, reduced to plain text, and stored against the
conversation. The chat service later injects the stored text as context.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.config import Settings, get_settings
from app.deps import CurrentUser, rate_limit, read_rate_limit
from app.memory_service_provider import (
    build_llm_provider,
    build_memory_extractor,
    build_memory_service,
)
from app.schemas import (
    MemoryOut,
    ResearchCrawlRequest,
    ResearchSearchRequest,
    ResearchSourceOut,
)
from app.services.crawl_provider import (
    crawl,
    firecrawl_ready,
    resolve_user_provider,
)
from app.services.crawl_usage_service import record_crawl
from app.services.crawlers import firecrawl
from app.services.feature_persona import load_feature_persona
from app.services.usage_service import record_usage
from app.services.web_crawler import CrawlError, normalize_url

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
                detail="Sumber web hanya tersedia pada mode Riset Web.",
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


def _to_source(
    row: dict[str, Any], notice: str | None = None
) -> ResearchSourceOut:
    content = row.get("content") or ""
    return ResearchSourceOut(
        id=row["id"],
        conversation_id=row["conversation_id"],
        url=row.get("url") or "",
        title=row.get("title") or "",
        site=row.get("site") or "",
        excerpt=_excerpt(content),
        char_count=len(content),
        provider=row.get("provider") or "",
        notice=notice,
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

    # Cache: reuse a source already crawled for this URL in this conversation.
    # Scoped to the conversation (hence one user) so content never leaks across.
    cached = (
        await user.client.table("research_sources")
        .select("id, conversation_id, url, title, site, content, provider, created_at")
        .eq("conversation_id", conversation_id)
        .eq("url", url)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if cached.data:
        return _to_source(
            cached.data[0], notice="Memakai sumber tersimpan di percakapan ini."
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

    provider = await resolve_user_provider(user.client, user.id, settings)
    try:
        outcome = await crawl(
            url,
            settings=settings,
            client=user.client,
            user_id=user.id,
            provider=provider,
        )
    except CrawlError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    page = outcome.page
    content = page.text[: settings.research_max_chars]
    response = (
        await user.client.table("research_sources")
        .insert(
            {
                "user_id": user.id,
                "conversation_id": conversation_id,
                "url": url,
                "title": page.title[:300],
                "site": page.site[:200],
                "content": content,
                "provider": outcome.provider,
            }
        )
        .execute()
    )
    return _to_source(response.data[0], notice=outcome.notice)


@router.post(
    "/search",
    response_model=list[ResearchSourceOut],
    status_code=status.HTTP_201_CREATED,
)
async def search_web(
    payload: ResearchSearchRequest,
    user: CurrentUser = Depends(rate_limit),
    settings: Settings = Depends(get_settings),
) -> list[ResearchSourceOut]:
    """Web search via Firecrawl and store the hits as conversation sources.

    Only Firecrawl can search; the built-in httpx parser only fetches known
    URLs, so this endpoint is unavailable when Firecrawl is not configured.
    """
    if not firecrawl_ready(settings):
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Pencarian web butuh Firecrawl. Isi FIRECRAWL_API_KEY di server "
                "lalu pilih provider Firecrawl."
            ),
        )

    conversation_id = payload.conversation_id
    if conversation_id:
        conversation_id = await _resolve_conversation(
            user.client, user.id, conversation_id
        )

    # Existing URLs in this conversation are never inserted twice.
    existing_urls: set[str] = set()
    used = 0
    if conversation_id:
        existing = (
            await user.client.table("research_sources")
            .select("url")
            .eq("conversation_id", conversation_id)
            .execute()
        )
        existing_urls = {row.get("url") or "" for row in (existing.data or [])}
        used = len(existing_urls)

    remaining = max(0, settings.research_max_sources - used)
    if remaining <= 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Maksimal {settings.research_max_sources} sumber per percakapan. "
                "Hapus salah satu sumber dulu."
            ),
        )

    requested = payload.limit or settings.research_search_limit
    limit = max(1, min(requested, remaining, 10))

    async def _record(*, credits: int, status_: str, code: str) -> None:
        await record_crawl(
            user.client,
            user.id,
            provider="firecrawl",
            url=f"search:{payload.query.strip()}"[:1000],
            credits=credits,
            status=status_,
            code=code,
        )

    try:
        result = await firecrawl.search(
            payload.query.strip(), settings=settings, limit=limit
        )
    except firecrawl.FirecrawlAuthError as exc:
        await _record(credits=0, status_="error", code="auth")
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except firecrawl.FirecrawlQuotaError as exc:
        await _record(credits=0, status_="error", code="quota")
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, detail=str(exc)
        ) from exc
    except firecrawl.FirecrawlUnavailableError as exc:
        await _record(credits=0, status_="error", code="unavailable")
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, detail=str(exc)
        ) from exc

    hits = [
        page
        for page in result.pages
        if page.url.startswith(("http://", "https://")) and page.text.strip()
    ]
    if not hits:
        await _record(credits=result.credits, status_="success", code="empty")
        return []

    # A conversation row is only created once there is something to store.
    if not conversation_id:
        conversation_id = await _resolve_conversation(user.client, user.id, None)

    inserted: list[ResearchSourceOut] = []
    for page in hits:
        if len(inserted) >= remaining:
            break
        if page.url in existing_urls:
            continue
        existing_urls.add(page.url)
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
                    "provider": "firecrawl",
                }
            )
            .execute()
        )
        if response.data:
            inserted.append(_to_source(response.data[0]))

    await _record(credits=result.credits, status_="success", code="search")
    return inserted


@router.get("/sources", response_model=list[ResearchSourceOut])
async def list_sources(
    conversation_id: str = Query(..., min_length=1),
    user: CurrentUser = Depends(read_rate_limit),
) -> list[ResearchSourceOut]:
    response = (
        await user.client.table("research_sources")
        .select("id, conversation_id, url, title, site, content, provider, created_at")
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


@router.post("/sources/{source_id}/memory", response_model=list[MemoryOut])
async def save_source_to_memory(
    source_id: str,
    user: CurrentUser = Depends(rate_limit),
) -> list[MemoryOut]:
    """Extract durable facts from a crawled source and store them as memories.

    Near-duplicates update the existing memory instead of creating a copy.
    """
    response = (
        await user.client.table("research_sources")
        .select("id, url, title, content")
        .eq("id", source_id)
        .eq("user_id", user.id)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Sumber tidak ditemukan."
        )
    row = rows[0]

    try:
        llm = build_llm_provider()
    except Exception as exc:  # noqa: BLE001 - provider misconfiguration
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Ekstraksi memori tidak tersedia.",
        ) from exc

    extractor = build_memory_extractor(llm)
    text = (row.get("content") or "").strip()[:8000]
    persona = await load_feature_persona(user.client, "research", user_id=user.id)
    extracted, usage, model = await extractor.extract(
        text, recent_context="", persona=persona
    )
    await record_usage(user.client, user.id, model, usage, source="memory")

    memory_service = build_memory_service(user.client)
    ref = {"source_id": row["id"], "url": row.get("url"), "title": row.get("title")}
    saved: list[MemoryOut] = []
    for item in extracted:
        memory, action = await memory_service.upsert_fact(
            user.id,
            type_=item.type,
            content=item.content,
            source="research",
            source_ref=ref,
            metadata={"mode": "research"},
            confidence=item.confidence,
        )
        if action != "skipped":
            saved.append(memory)
    return saved