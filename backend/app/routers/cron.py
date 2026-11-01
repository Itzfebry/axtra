"""Single cron entrypoint that drives every scheduled task.

Vercel Hobby allows only infrequent cron jobs, so one daily tick fans out to all
logical schedules. Each schedule is idempotent per day (``automation_runs``), so
a duplicate or retried invocation never double-sends.
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.config import Settings, get_settings
from app.schemas import CronTickOut
from app.services.digest_service import build_daily_report, build_weekly_report
from app.services.health_scheduler import refresh_stale_projects
from app.services.journal_service import WIB
from app.services.notification_service import deliver_due, enqueue
from app.services.telegram_client import TelegramClient
from app.services.telegram_store import purge_updates

logger = logging.getLogger("axtra.cron")

router = APIRouter(prefix="/api/cron", tags=["cron"])


def _authorize(request: Request, settings: Settings) -> None:
    if not settings.cron_secret:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="CRON_SECRET belum diatur.",
        )
    provided = request.headers.get("authorization", "")
    if not secrets.compare_digest(provided, f"Bearer {settings.cron_secret}"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Tidak diizinkan.")


async def _claim_run(
    client, user_id: str, kind: str, day_key: str
) -> bool:
    """Reserve a scheduled run for idempotency. False when already claimed."""
    try:
        existing = await (
            client.table("automation_runs")
            .select("id")
            .eq("kind", kind)
            .eq("day_key", day_key)
            .maybe_single()
            .execute()
        )
        if existing and existing.data:
            return False
        await (
            client.table("automation_runs")
            .insert({"user_id": user_id, "kind": kind, "day_key": day_key})
            .execute()
        )
        return True
    except Exception as exc:  # noqa: BLE001 - a failed claim must not crash the tick
        logger.warning("Could not claim run %s/%s: %s", kind, day_key, exc)
        return False


async def _enabled_links(client) -> list[dict[str, Any]]:
    try:
        response = await (
            client.table("telegram_links")
            .select("*")
            .eq("enabled", True)
            .execute()
        )
        return response.data or []
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not read telegram links: %s", exc)
        return []


def _quiet(link: dict[str, Any], hour: int) -> bool:
    start = link.get("quiet_start")
    end = link.get("quiet_end")
    start = 22 if start is None else int(start)
    end = 7 if end is None else int(end)
    if start == end:
        return False
    if start < end:
        return start <= hour < end
    return hour >= start or hour < end


async def _dispatch_reports(
    client, settings: Settings, now_wib: datetime
) -> int:
    links = await _enabled_links(client)
    if not links:
        return 0
    day_key = now_wib.date().isoformat()
    day = now_wib.date()
    sent = 0

    for link in links:
        chat_id = str(link.get("chat_id") or "")
        if not chat_id or _quiet(link, now_wib.hour):
            continue
        user_id = str(link.get("user_id") or settings.owner_user_id)

        report_hour = link.get("report_hour")
        report_hour = (
            settings.automation_daily_report_hour
            if report_hour is None
            else int(report_hour)
        )
        if link.get("daily_report", True) and now_wib.hour >= report_hour:
            if await _claim_run(client, user_id, "daily_report", day_key):
                try:
                    text = await build_daily_report(settings, client, user_id, day=day)
                    await enqueue(
                        client, user_id=user_id, chat_id=chat_id, text=text
                    )
                    sent += 1
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Daily report failed for %s: %s", chat_id, exc)

        if (
            link.get("weekly_report", True)
            and now_wib.weekday() == 6
            and now_wib.hour >= settings.automation_weekly_report_hour
        ):
            week_key = f"{day_key}-w{now_wib.isocalendar().week}"
            if await _claim_run(client, user_id, "weekly_report", week_key):
                try:
                    text = await build_weekly_report(settings, client, user_id, day=day)
                    await enqueue(
                        client, user_id=user_id, chat_id=chat_id, text=text
                    )
                    sent += 1
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Weekly report failed for %s: %s", chat_id, exc)

    return sent


@router.get("/tick", response_model=CronTickOut)
@router.post("/tick", response_model=CronTickOut)
async def tick(
    request: Request, settings: Settings = Depends(get_settings)
) -> CronTickOut:
    _authorize(request, settings)

    from app.supabase_client import get_owner_client

    client = await get_owner_client()
    user_id = settings.owner_user_id
    result = CronTickOut()
    notes: list[str] = []

    try:
        result.health_refreshed = await refresh_stale_projects(client, user_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Health sweep failed: %s", exc)
        notes.append(f"health: {exc}")

    now_wib = datetime.now(timezone.utc).astimezone(WIB)
    try:
        result.reports_sent = await _dispatch_reports(client, settings, now_wib)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Report dispatch failed: %s", exc)
        notes.append(f"reports: {exc}")

    if settings.telegram_bot_token:
        try:
            sent, failed = await deliver_due(
                client, TelegramClient(settings.telegram_bot_token)
            )
            result.outbox_sent = sent
            result.outbox_failed = failed
        except Exception as exc:  # noqa: BLE001
            logger.warning("Outbox drain failed: %s", exc)
            notes.append(f"outbox: {exc}")

    if now_wib.weekday() == 6:
        await purge_updates(client, days=7)

    result.detail = "; ".join(notes)[:1000]
    return result