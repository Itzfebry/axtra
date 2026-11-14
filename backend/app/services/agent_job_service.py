"""Durable queue for headless chat runs.

A command sent through the API token (or the Hermes bridge) is enqueued here
instead of being bound to one HTTP request: Vercel caps a function at 300s, so
long answers would otherwise be cut off. The cron ``/api/cron/minutely`` tick
claims the oldest queued job, runs one chat turn, stores the reply, and pushes
it to Telegram when a link exists.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from supabase import AsyncClient

from app.config import Settings

logger = logging.getLogger(__name__)

TABLE = "agent_jobs"
ACTIVE = ("queued", "running")


async def enqueue_job(
    client: AsyncClient,
    user_id: str,
    *,
    prompt: str,
    mode: str = "general",
    title: str | None = None,
) -> dict[str, Any]:
    row = {
        "user_id": user_id,
        "kind": "chat",
        "status": "queued",
        "title": (title or prompt)[:120],
        "prompt": prompt,
        "mode": mode,
    }
    response = await client.table(TABLE).insert(row).execute()
    return response.data[0]


async def list_jobs(client: AsyncClient, user_id: str, limit: int = 20) -> list[dict[str, Any]]:
    response = (
        await client.table(TABLE)
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return response.data or []


async def get_job(client: AsyncClient, user_id: str, job_id: str) -> dict[str, Any] | None:
    response = (
        await client.table(TABLE)
        .select("*")
        .eq("user_id", user_id)
        .eq("id", job_id)
        .maybe_single()
        .execute()
    )
    return response.data if response else None


async def claim_next_job(client: AsyncClient, user_id: str) -> dict[str, Any] | None:
    """Oldest queued job for the owner, flipped to ``running``.

    The status filter on the update is the guard: a second tick that raced to
    the same row gets an empty result and moves on.
    """
    response = (
        await client.table(TABLE)
        .select("*")
        .eq("user_id", user_id)
        .eq("status", "queued")
        .order("created_at")
        .limit(1)
        .maybe_single()
        .execute()
    )
    row = response.data if response else None
    if not row:
        return None
    claimed = await (
        client.table(TABLE)
        .update({"status": "running"})
        .eq("id", row["id"])
        .eq("status", "queued")
        .execute()
    )
    return row if claimed.data else None


async def run_jobs(
    client: AsyncClient, settings: Settings, *, limit: int = 1
) -> list[dict[str, Any]]:
    """Claim and run up to ``limit`` jobs. Never raises: one bad job must not
    stop the cron tick."""
    finished: list[dict[str, Any]] = []
    for _ in range(max(limit, 0)):
        try:
            job = await claim_next_job(client, settings.owner_user_id)
        except Exception as exc:  # noqa: BLE001 - queue read failure is not fatal
            logger.warning("Agent job claim failed: %s", exc)
            break
        if not job:
            break
        patch = await _execute(client, settings, job)
        await client.table(TABLE).update(patch).eq("id", job["id"]).execute()
        if patch["status"] == "done":
            await _notify(client, settings, job, patch["result"])
        finished.append({**job, **patch})
    return finished


async def _execute(
    client: AsyncClient, settings: Settings, job: dict[str, Any]
) -> dict[str, Any]:
    from app.memory_service_provider import (
        build_llm_provider,
        build_memory_extractor,
        build_memory_service,
    )
    from app.services.chat_service import ChatService

    try:
        llm = build_llm_provider()
        service = ChatService(
            settings=settings,
            llm=llm,
            memory_service_factory=build_memory_service,
            extractor=build_memory_extractor(llm),
        )
        content = ""
        conversation_id: str | None = None
        async for event in service.stream_response(
            client=client,
            user_id=settings.owner_user_id,
            conversation_id=None,
            user_message=job["prompt"],
            model=job.get("model") or settings.default_chat_model,
            use_memory=True,
            mode=job.get("mode") or "general",
        ):
            payload = json.loads(event["data"]) if event.get("data") else {}
            if event["event"] == "meta":
                conversation_id = payload.get("conversation_id") or conversation_id
            elif event["event"] == "done":
                content = payload.get("content") or content
            elif event["event"] == "error":
                raise RuntimeError(str(payload.get("detail") or "Chat gagal."))
        if not content:
            raise RuntimeError("Model tidak mengembalikan jawaban.")
        return {
            "status": "done",
            "result": content,
            "error": "",
            "conversation_id": conversation_id,
        }
    except Exception as exc:  # noqa: BLE001 - a failed job is recorded, not raised
        logger.warning("Agent job %s failed: %s", job.get("id"), exc)
        return {"status": "failed", "result": "", "error": str(exc)[:500]}


async def _notify(
    client: AsyncClient, settings: Settings, job: dict[str, Any], text: str
) -> None:
    """Push the finished answer to every enabled Telegram chat."""
    if not settings.telegram_bot_token or not text:
        return
    from app.services.notification_service import enqueue

    try:
        links = await client.table("telegram_links").select("chat_id").eq("enabled", True).execute()
        for link in links.data or []:
            await enqueue(
                client,
                user_id=settings.owner_user_id,
                chat_id=str(link["chat_id"]),
                text=f"🧠 {job.get('title') or 'Job'}\n\n{text}"[:4000],
            )
    except Exception as exc:  # noqa: BLE001 - delivery retries via the outbox
        logger.warning("Agent job notify failed: %s", exc)
