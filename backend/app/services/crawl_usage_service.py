"""Firecrawl crawl credit accounting.

Each Firecrawl scrape records its credit usage here — success and failure
alike, so the daily/monthly statistics stay accurate. The server reads the
aggregated totals to enforce a daily cap before spending more credits.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import AsyncClient

from app.services.usage_service import WIB, _as_int

TABLE = "crawl_usage_events"


@dataclass
class CrawlUsage:
    day_credits: int
    month_credits: int
    day_since: datetime
    month_since: datetime
    day_reset_at: datetime


def current_window(now: datetime | None = None) -> CrawlUsage:
    """Compute the current WIB day and month boundaries."""
    now_utc = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    now_wib = now_utc.astimezone(WIB)
    day_start = now_wib.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = day_start.replace(day=1)
    return CrawlUsage(
        day_credits=0,
        month_credits=0,
        day_since=day_start.astimezone(timezone.utc),
        month_since=month_start.astimezone(timezone.utc),
        day_reset_at=(day_start + timedelta(days=1)).astimezone(timezone.utc),
    )


async def get_crawl_usage(
    client: AsyncClient, now: datetime | None = None
) -> CrawlUsage:
    """Read aggregated Firecrawl credits for the current WIB day and month."""
    window = current_window(now)
    try:
        response = await client.rpc(
            "get_crawl_usage",
            {
                "p_day_since": window.day_since.isoformat(),
                "p_month_since": window.month_since.isoformat(),
            },
        ).execute()
    except Exception:  # noqa: BLE001 - report zeros rather than fail the UI
        return window

    row: dict[str, Any] = {}
    if isinstance(response.data, list) and response.data:
        row = response.data[0] or {}
    elif isinstance(response.data, dict):
        row = response.data
    window.day_credits = _as_int(row.get("day_credits"))
    window.month_credits = _as_int(row.get("month_credits"))
    return window


async def record_crawl(
    client: AsyncClient,
    user_id: str,
    *,
    provider: str,
    url: str,
    credits: int,
    status: str,
    code: str = "",
) -> None:
    """Persist one crawl attempt. Best-effort: never breaks the crawl."""
    try:
        await (
            client.table(TABLE)
            .insert(
                {
                    "user_id": user_id,
                    "provider": provider,
                    "url": url[:1000],
                    "credits": max(int(credits), 0),
                    "status": status,
                    "code": code[:120],
                }
            )
            .execute()
        )
    except Exception:  # noqa: BLE001 - telemetry must never break a crawl
        pass
