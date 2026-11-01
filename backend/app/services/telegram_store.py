"""Persistence helpers for the single-owner Telegram bot."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import AsyncClient

from app.config import Settings

logger = logging.getLogger("axtra.telegram")

LINKS_TABLE = "telegram_links"
UPDATES_TABLE = "telegram_updates"


async def get_link(client: AsyncClient, chat_id: str) -> dict[str, Any] | None:
    try:
        response = await (
            client.table(LINKS_TABLE)
            .select("*")
            .eq("chat_id", str(chat_id))
            .maybe_single()
            .execute()
        )
    except Exception as exc:  # noqa: BLE001 - table may not be migrated yet
        logger.warning("Could not read telegram link: %s", exc)
        return None
    return (response.data if response else None) or None


async def list_links(client: AsyncClient, user_id: str) -> list[dict[str, Any]]:
    response = (
        await client.table(LINKS_TABLE)
        .select("*")
        .eq("user_id", user_id)
        .order("created_at")
        .execute()
    )
    return response.data or []


def is_allowed(settings: Settings, chat_id: str, link: dict[str, Any] | None) -> bool:
    if not settings.telegram_enabled:
        return False
    if link is not None:
        return bool(link.get("enabled", True))
    return str(chat_id) in set(settings.telegram_allowed_list)


async def ensure_link(
    client: AsyncClient,
    *,
    user_id: str,
    chat_id: str,
    username: str = "",
    first_name: str = "",
    default_mode: str = "general",
    settings: Settings | None = None,
) -> dict[str, Any] | None:
    """Create the link row for an allowed chat, or return the existing one."""
    existing = await get_link(client, chat_id)
    if existing is not None:
        return existing

    quiet_start = settings.automation_quiet_start if settings else 22
    quiet_end = settings.automation_quiet_end if settings else 7
    report_hour = settings.automation_daily_report_hour if settings else 21
    row = {
        "user_id": user_id,
        "chat_id": str(chat_id),
        "username": username or "",
        "first_name": first_name or "",
        "default_mode": default_mode,
        "quiet_start": quiet_start,
        "quiet_end": quiet_end,
        "report_hour": report_hour,
    }
    response = await client.table(LINKS_TABLE).insert(row).execute()
    return response.data[0] if response.data else None


async def update_link(
    client: AsyncClient, chat_id: str, patch: dict[str, Any]
) -> dict[str, Any] | None:
    if not patch:
        return await get_link(client, chat_id)
    patch = dict(patch)
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    response = (
        await client.table(LINKS_TABLE)
        .update(patch)
        .eq("chat_id", str(chat_id))
        .execute()
    )
    return response.data[0] if response.data else None


async def ensure_conversation(
    client: AsyncClient,
    *,
    user_id: str,
    link: dict[str, Any],
) -> str:
    """Return the bot's conversation id for this chat, creating it lazily."""
    existing = link.get("conversation_id")
    if existing:
        return str(existing)
    title = f"Telegram · {link.get('first_name') or link.get('username') or link['chat_id']}"
    response = (
        await client.table("conversations")
        .insert(
            {
                "user_id": user_id,
                "title": title,
                "mode": link.get("default_mode") or "general",
            }
        )
        .execute()
    )
    conversation_id = str(response.data[0]["id"])
    await update_link(client, str(link["chat_id"]), {"conversation_id": conversation_id})
    return conversation_id


async def seen_update(client: AsyncClient, update_id: int | None) -> bool:
    """Return True when this update was already processed (or is unidentifiable)."""
    if update_id is None:
        return False
    try:
        response = await (
            client.table(UPDATES_TABLE)
            .select("update_id")
            .eq("update_id", update_id)
            .maybe_single()
            .execute()
        )
        if response and response.data:
            return True
        await client.table(UPDATES_TABLE).insert({"update_id": update_id}).execute()
    except Exception as exc:  # noqa: BLE001 - dedupe is best-effort
        logger.warning("Telegram dedupe failed for %s: %s", update_id, exc)
        return False
    return False


def in_quiet_hours(link: dict[str, Any], now_wib_hour: int) -> bool:
    start = int(link.get("quiet_start") if link.get("quiet_start") is not None else 22)
    end = int(link.get("quiet_end") if link.get("quiet_end") is not None else 7)
    if start == end:
        return False
    if start < end:
        return start <= now_wib_hour < end
    # Wraps midnight, e.g. 22 -> 7.
    return now_wib_hour >= start or now_wib_hour < end


async def purge_updates(client: AsyncClient, days: int = 7) -> None:
    before = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    try:
        await client.rpc("purge_telegram_updates", {"p_before": before}).execute()
    except Exception as exc:  # noqa: BLE001 - housekeeping only
        logger.warning("Could not purge telegram updates: %s", exc)