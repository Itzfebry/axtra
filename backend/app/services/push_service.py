"""Web Push delivery via pywebpush (VAPID).

Subscription rows that the push service reports as gone (404/410) are pruned.
The blocking HTTP call runs in a worker thread so the event loop stays free.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from supabase import AsyncClient

from app.config import Settings

logger = logging.getLogger("axtra.push")

TABLE = "push_subscriptions"


def _subscription_info(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "endpoint": row["endpoint"],
        "keys": {"p256dh": row["p256dh"], "auth": row["auth"]},
    }


def _private_key_pem(settings: Settings) -> str:
    # PEM newlines may be stored escaped in a single-line env var.
    return settings.vapid_private_key.replace("\\n", "\n")


async def list_subscriptions(
    client: AsyncClient, user_id: str
) -> list[dict[str, Any]]:
    try:
        response = await (
            client.table(TABLE).select("*").eq("user_id", user_id).execute()
        )
    except Exception as exc:  # noqa: BLE001 - push is best-effort
        logger.warning("Could not read push subscriptions: %s", exc)
        return []
    return response.data or []


async def save_subscription(
    client: AsyncClient,
    user_id: str,
    *,
    endpoint: str,
    p256dh: str,
    auth: str,
    user_agent: str = "",
) -> None:
    """Upsert a subscription; the endpoint is globally unique."""
    row = {
        "user_id": user_id,
        "endpoint": endpoint,
        "p256dh": p256dh,
        "auth": auth,
        "user_agent": user_agent[:400],
    }
    await client.table(TABLE).upsert(row, on_conflict="endpoint").execute()


async def delete_subscription(
    client: AsyncClient, user_id: str, endpoint: str
) -> None:
    await (
        client.table(TABLE)
        .delete()
        .eq("user_id", user_id)
        .eq("endpoint", endpoint)
        .execute()
    )


async def send_push(
    client: AsyncClient,
    settings: Settings,
    user_id: str,
    *,
    title: str,
    body: str,
    url: str = "/jadwal",
    tag: str | None = None,
) -> tuple[int, int, int]:
    """Send a notification to every subscription. Returns (sent, failed, removed)."""
    if not settings.push_ready:
        return 0, 0, 0

    subscriptions = await list_subscriptions(client, user_id)
    if not subscriptions:
        return 0, 0, 0

    from pywebpush import WebPushException, webpush

    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
    pem = _private_key_pem(settings)
    claims = {"sub": settings.vapid_subject}

    sent = 0
    failed = 0
    removed = 0
    for row in subscriptions:
        try:
            await asyncio.to_thread(
                webpush,
                _subscription_info(row),
                data=payload,
                vapid_private_key=pem,
                vapid_claims=dict(claims),
                timeout=15,
            )
            sent += 1
        except WebPushException as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (404, 410):
                await delete_subscription(client, user_id, str(row["endpoint"]))
                removed += 1
                logger.info("Pruned stale push subscription %s", row.get("endpoint"))
            else:
                failed += 1
                logger.warning("Push failed (%s): %s", status, exc)
        except Exception as exc:  # noqa: BLE001 - never abort the batch
            failed += 1
            logger.warning("Push error: %s", exc)
    return sent, failed, removed
