"""Durable notification outbox with bounded retry.

Proactive notifications are inserted as rows instead of being sent inline. A
single cron tick drains due rows, so a Vercel instance that dies mid-request
never loses a message. Retries use capped exponential backoff.
"""

from __future__ import annotations

import base64
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import AsyncClient

from app.services.telegram_client import TelegramClient, TelegramError

logger = logging.getLogger("axtra.notifications")

TABLE = "notification_outbox"
_BACKOFF_MINUTES = (1, 5, 15, 60, 240)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def enqueue(
    client: AsyncClient,
    *,
    user_id: str,
    chat_id: str,
    text: str,
    kind: str = "message",
    payload_extra: dict[str, Any] | None = None,
    scheduled_at: datetime | None = None,
    max_attempts: int = 5,
) -> str:
    payload: dict[str, Any] = {"text": text}
    if payload_extra:
        payload.update(payload_extra)
    row = {
        "user_id": user_id,
        "chat_id": chat_id,
        "kind": kind,
        "payload": payload,
        "status": "pending",
        "max_attempts": max_attempts,
        "next_attempt_at": (scheduled_at or _now()).isoformat(),
    }
    response = await client.table(TABLE).insert(row).execute()
    return str(response.data[0]["id"])


async def _mark(
    client: AsyncClient,
    row_id: str,
    *,
    status: str,
    attempts: int,
    error: str = "",
    next_attempt_at: datetime | None = None,
) -> None:
    patch: dict[str, Any] = {
        "status": status,
        "attempts": attempts,
        "last_error": error[:1000],
    }
    if status == "sent":
        patch["sent_at"] = _now().isoformat()
    if next_attempt_at is not None:
        patch["next_attempt_at"] = next_attempt_at.isoformat()
    await client.table(TABLE).update(patch).eq("id", row_id).execute()


async def _send_row(telegram: TelegramClient, row: dict[str, Any]) -> None:
    payload = row.get("payload") or {}
    chat_id = str(row["chat_id"])
    text = str(payload.get("text") or "")
    kind = row.get("kind") or "message"
    if kind == "photo" and payload.get("photo_base64"):
        data = base64.b64decode(str(payload["photo_base64"]))
        await telegram.send_photo(
            chat_id,
            data,
            caption=text,
            reply_markup=payload.get("reply_markup"),
        )
        return
    await telegram.send_message(
        chat_id, text, reply_markup=payload.get("reply_markup")
    )


async def deliver_due(
    client: AsyncClient, telegram: TelegramClient, *, limit: int = 20
) -> tuple[int, int]:
    """Send due pending rows. Returns ``(sent, failed)`` counts."""
    if not telegram.configured:
        return 0, 0
    try:
        response = await (
            client.table(TABLE)
            .select("*")
            .eq("status", "pending")
            .lte("next_attempt_at", _now().isoformat())
            .order("next_attempt_at")
            .limit(limit)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001 - outbox is best-effort
        logger.warning("Could not read notification outbox: %s", exc)
        return 0, 0

    sent = 0
    failed = 0
    for row in response.data or []:
        row_id = str(row["id"])
        attempts = int(row.get("attempts") or 0) + 1
        max_attempts = int(row.get("max_attempts") or 5)
        try:
            await _send_row(telegram, row)
        except TelegramError as exc:
            if attempts >= max_attempts:
                failed += 1
                await _mark(
                    client, row_id, status="failed", attempts=attempts, error=str(exc)
                )
            else:
                backoff = _BACKOFF_MINUTES[
                    min(attempts - 1, len(_BACKOFF_MINUTES) - 1)
                ]
                await _mark(
                    client,
                    row_id,
                    status="pending",
                    attempts=attempts,
                    error=str(exc),
                    next_attempt_at=_now() + timedelta(minutes=backoff),
                )
            logger.warning("Notification %s failed (attempt %s): %s", row_id, attempts, exc)
        except Exception as exc:  # noqa: BLE001 - never abort the batch
            failed += attempts >= max_attempts
            await _mark(
                client,
                row_id,
                status="failed" if attempts >= max_attempts else "pending",
                attempts=attempts,
                error=str(exc),
                next_attempt_at=_now() + timedelta(minutes=5),
            )
            logger.warning("Notification %s error: %s", row_id, exc)
        else:
            sent += 1
            await _mark(client, row_id, status="sent", attempts=attempts)
    return sent, failed