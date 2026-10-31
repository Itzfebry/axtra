"""Token usage accounting.

Every LLM call (the visible chat answer and the background memory-extraction
call) records its token usage here. The UI reads aggregated totals to show a
rolling tokens-per-minute figure and a daily total that resets at 00:00 WIB.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import AsyncClient

TABLE = "token_usage_events"

# WIB (Asia/Jakarta) has no daylight saving, so a fixed offset is exact.
WIB = timezone(timedelta(hours=7), name="Asia/Jakarta")

_WINDOW_SECONDS = 60


@dataclass
class UsageWindow:
    minute_tokens: int
    day_tokens: int
    minute_since: datetime
    day_since: datetime
    day_reset_at: datetime
    by_model: dict[str, int] | None = None


def _as_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def normalize_usage(usage: dict[str, Any] | None) -> dict[str, int] | None:
    """Extract prompt/completion/total tokens from a provider usage payload."""
    if not usage:
        return None
    prompt = _as_int(usage.get("prompt_tokens"))
    completion = _as_int(usage.get("completion_tokens"))
    total = _as_int(usage.get("total_tokens")) or (prompt + completion)
    if total <= 0:
        return None
    return {
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": total,
    }


async def record_usage(
    client: AsyncClient,
    user_id: str,
    model: str | None,
    usage: dict[str, Any] | None,
    source: str = "chat",
) -> None:
    """Persist one LLM call's usage. Best-effort: never breaks the caller."""
    normalized = normalize_usage(usage)
    if not normalized:
        return
    try:
        await (
            client.table(TABLE)
            .insert(
                {
                    "user_id": user_id,
                    "model": model,
                    "source": source,
                    **normalized,
                }
            )
            .execute()
        )
    except Exception:  # noqa: BLE001 - telemetry must never break a reply
        pass


def current_window(now: datetime | None = None) -> UsageWindow:
    """Compute the rolling-minute and current-day boundaries in WIB."""
    now_utc = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    now_wib = now_utc.astimezone(WIB)
    day_start_wib = now_wib.replace(hour=0, minute=0, second=0, microsecond=0)
    next_day_wib = day_start_wib + timedelta(days=1)
    return UsageWindow(
        minute_tokens=0,
        day_tokens=0,
        minute_since=now_utc - timedelta(seconds=_WINDOW_SECONDS),
        day_since=day_start_wib.astimezone(timezone.utc),
        day_reset_at=next_day_wib.astimezone(timezone.utc),
    )


async def get_usage(client: AsyncClient, now: datetime | None = None) -> UsageWindow:
    """Read aggregated usage for the rolling minute and the current WIB day."""
    window = current_window(now)
    try:
        response = await client.rpc(
            "get_token_usage",
            {
                "p_minute_since": window.minute_since.isoformat(),
                "p_day_since": window.day_since.isoformat(),
            },
        ).execute()
    except Exception:  # noqa: BLE001 - report zeros rather than fail the UI
        return window

    row: dict[str, Any] = {}
    if isinstance(response.data, list) and response.data:
        row = response.data[0] or {}
    elif isinstance(response.data, dict):
        row = response.data
    window.minute_tokens = _as_int(row.get("minute_tokens"))
    window.day_tokens = _as_int(row.get("day_tokens"))

    # Per-model breakdown for the current day. Best-effort: older deployments
    # without the RPC simply show no breakdown.
    try:
        by_model_response = await client.rpc(
            "get_token_usage_by_model",
            {"p_day_since": window.day_since.isoformat()},
        ).execute()
    except Exception:  # noqa: BLE001 - breakdown is optional telemetry
        return window
    breakdown: dict[str, int] = {}
    rows = (
        by_model_response.data
        if isinstance(by_model_response.data, list)
        else []
    )
    for item in rows:
        if not isinstance(item, dict):
            continue
        model = str(item.get("model") or "(tidak diketahui)")
        tokens = _as_int(item.get("day_tokens"))
        if tokens > 0:
            breakdown[model] = breakdown.get(model, 0) + tokens
    window.by_model = breakdown
    return window
