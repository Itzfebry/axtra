"""Telegram webhook + management endpoints.

The webhook is public (Telegram calls it) and therefore protected by the
``X-Telegram-Bot-Api-Secret-Token`` header instead of the session cookie.
Management endpoints use the normal session auth.
"""

from __future__ import annotations

import logging
import secrets
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from app.config import Settings, get_settings
from app.deps import CurrentUser, rate_limit, read_rate_limit
from app.schemas import TelegramLinkOut, TelegramSettingsUpdate, TelegramWebhookResult
from app.services.telegram_bot import TelegramBot
from app.services.telegram_client import TelegramClient, TelegramError
from app.services.telegram_store import (
    ensure_link,
    get_link,
    is_allowed,
    list_links,
    purge_updates,
    seen_update,
    update_link,
)

logger = logging.getLogger("axtra.telegram")

router = APIRouter(prefix="/api/telegram", tags=["telegram"])

_SECRET_HEADER = "x-telegram-bot-api-secret-token"


class SetWebhookRequest(BaseModel):
    url: str = Field(min_length=1, max_length=500)
    drop_pending: bool = False


class TestMessageRequest(BaseModel):
    chat_id: str | None = None
    text: str = Field(default="Tes koneksi Axtra ✅", max_length=1000)


@router.post("/webhook", response_model=TelegramWebhookResult)
async def telegram_webhook(
    update: dict[str, Any],
    request: Request,
    settings: Settings = Depends(get_settings),
) -> TelegramWebhookResult:
    if not settings.telegram_enabled or not settings.telegram_bot_token:
        return TelegramWebhookResult(ok=False, handled=False, detail="Telegram nonaktif.")
    if settings.telegram_webhook_secret:
        provided = request.headers.get(_SECRET_HEADER, "")
        if not secrets.compare_digest(provided, settings.telegram_webhook_secret):
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED, detail="Secret webhook tidak valid."
            )

    from app.supabase_client import get_owner_client

    client = await get_owner_client()
    if await seen_update(client, update.get("update_id")):
        return TelegramWebhookResult(ok=True, handled=False, detail="Duplikat.")

    bot = TelegramBot(settings, client, TelegramClient(settings.telegram_bot_token))
    handled = await bot.handle_update(update)
    return TelegramWebhookResult(ok=True, handled=handled)


@router.get("/status", response_model=dict[str, Any])
async def telegram_status(
    user: CurrentUser = Depends(read_rate_limit),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    links = await list_links(user.client, user.id)
    return {
        "enabled": settings.telegram_enabled,
        "token_configured": bool(settings.telegram_bot_token),
        "webhook_secret_configured": bool(settings.telegram_webhook_secret),
        "allowed_chat_ids": settings.telegram_allowed_list,
        "links": links,
    }


@router.get("/links", response_model=list[TelegramLinkOut])
async def telegram_links(
    user: CurrentUser = Depends(read_rate_limit),
) -> list[TelegramLinkOut]:
    rows = await list_links(user.client, user.id)
    return [TelegramLinkOut(**row) for row in rows]


@router.patch("/settings", response_model=TelegramLinkOut)
async def update_telegram_settings(
    payload: TelegramSettingsUpdate,
    chat_id: str | None = Query(default=None),
    user: CurrentUser = Depends(rate_limit),
) -> TelegramLinkOut:
    target = chat_id or ""
    if not target:
        rows = await list_links(user.client, user.id)
        if not rows:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, detail="Belum ada chat tertaut."
            )
        target = str(rows[0]["chat_id"])
    patch = payload.model_dump(exclude_unset=True, exclude_none=True)
    updated = await update_link(user.client, target, patch)
    if updated is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Chat tidak ditemukan.")
    return TelegramLinkOut(**updated)


@router.post("/test", response_model=TelegramWebhookResult)
async def send_test_message(
    payload: TestMessageRequest,
    user: CurrentUser = Depends(rate_limit),
    settings: Settings = Depends(get_settings),
) -> TelegramWebhookResult:
    if not settings.telegram_bot_token:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TELEGRAM_BOT_TOKEN belum diatur.",
        )
    rows = await list_links(user.client, user.id)
    target = payload.chat_id or (str(rows[0]["chat_id"]) if rows else "")
    if not target:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Tidak ada chat tujuan.")
    telegram = TelegramClient(settings.telegram_bot_token)
    try:
        await telegram.send_message(target, payload.text)
    except TelegramError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return TelegramWebhookResult(ok=True, handled=True)


@router.post("/outbox/flush", response_model=dict[str, int])
async def flush_outbox(
    user: CurrentUser = Depends(rate_limit),
    settings: Settings = Depends(get_settings),
) -> dict[str, int]:
    """Manual drain for debugging; the cron tick does this automatically."""
    from app.services.notification_service import deliver_due

    if not settings.telegram_bot_token:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TELEGRAM_BOT_TOKEN belum diatur.",
        )
    sent, failed = await deliver_due(
        user.client, TelegramClient(settings.telegram_bot_token)
    )
    return {"sent": sent, "failed": failed}


@router.post("/set-webhook", response_model=dict[str, Any])
async def set_webhook(
    payload: SetWebhookRequest,
    user: CurrentUser = Depends(rate_limit),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    if not settings.telegram_bot_token:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TELEGRAM_BOT_TOKEN belum diatur.",
        )
    telegram = TelegramClient(settings.telegram_bot_token)
    try:
        result = await telegram.set_webhook(
            payload.url, settings.telegram_webhook_secret
        )
    except TelegramError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return {"ok": True, "result": result}


@router.post("/register", response_model=TelegramLinkOut)
async def register_link(
    user: CurrentUser = Depends(rate_limit),
    settings: Settings = Depends(get_settings),
    chat_id: str = Query(min_length=1),
    username: str = Query(default=""),
    first_name: str = Query(default=""),
) -> TelegramLinkOut:
    """Link a chat explicitly (alternative to the /start handshake)."""
    if not is_allowed(settings, chat_id, await get_link(user.client, chat_id)):
        # Allow explicit registration only for ids in the configured allowlist.
        if str(chat_id) not in set(settings.telegram_allowed_list):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, detail="Chat id tidak ada di allowlist."
            )
    row = await ensure_link(
        user.client,
        user_id=user.id,
        chat_id=chat_id,
        username=username,
        first_name=first_name,
        default_mode=settings.telegram_default_mode,
        settings=settings,
    )
    if row is None:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Gagal menautkan chat."
        )
    return TelegramLinkOut(**row)


@router.post("/maintenance/purge", response_model=dict[str, Any])
async def maintenance_purge(
    user: CurrentUser = Depends(rate_limit),
    days: int = Query(default=7, ge=1, le=90),
) -> dict[str, Any]:
    await purge_updates(user.client, days=days)
    return {"ok": True, "purged_before_days": days}