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
from app.schemas import CronMinutelyOut, CronTickOut, ScheduleOut
from app.services.digest_service import build_daily_report, build_weekly_report
from app.services.health_scheduler import refresh_stale_projects
from app.services.journal_service import WIB
from app.services.notification_service import deliver_due, enqueue
from app.services.push_service import send_push
from app.services.schedule_service import ScheduleService
from app.services.telegram_client import TelegramClient, escape_html
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


# ---------------------------------------------------------------------------
# Per-minute dispatch: fire due schedules (Telegram + Web Push) and drain the
# outbox. Vercel Hobby cron cannot run per minute, so an external scheduler hits
# ``/api/cron/minutely`` (see README).
# ---------------------------------------------------------------------------
def _schedule_keyboard(schedule_id: str) -> dict[str, Any]:
    return {
        "inline_keyboard": [
            [{"text": "✔ Selesai", "callback_data": f"sch:done:{schedule_id}"}],
            [
                {"text": "+5 mnt", "callback_data": f"sch:snooze:5:{schedule_id}"},
                {"text": "+10 mnt", "callback_data": f"sch:snooze:10:{schedule_id}"},
                {"text": "+30 mnt", "callback_data": f"sch:snooze:30:{schedule_id}"},
            ],
            [{"text": "Batalkan", "callback_data": f"sch:cancel:{schedule_id}"}],
        ]
    }


def schedule_message(schedule: ScheduleOut) -> str:
    due = schedule.due_at.astimezone(WIB)
    lines = [f"⏰ <b>{escape_html(schedule.title)}</b>"]
    if schedule.note:
        lines.append(escape_html(schedule.note))
    lines.append(f"<i>{due.strftime('%a, %d %b %Y %H:%M')} WIB</i>")
    return "\n".join(lines)


async def _notify_schedule(
    client, settings: Settings, schedule: ScheduleOut
) -> tuple[int, int, int]:
    """Fan out one fired schedule. Returns (push_sent, push_failed, push_removed)."""
    channels = set(schedule.channels or [])
    if "telegram" in channels and settings.telegram_bot_token:
        links = await _enabled_links(client)
        for link in links:
            chat_id = str(link.get("chat_id") or "")
            if not chat_id:
                continue
            user_id = str(link.get("user_id") or settings.owner_user_id)
            try:
                await enqueue(
                    client,
                    user_id=user_id,
                    chat_id=chat_id,
                    text=schedule_message(schedule),
                    kind="schedule",
                    payload_extra={"reply_markup": _schedule_keyboard(schedule.id)},
                )
            except Exception as exc:  # noqa: BLE001 - one chat must not sink the rest
                logger.warning("Schedule enqueue failed for %s: %s", chat_id, exc)

    push_sent = push_failed = push_removed = 0
    if "push" in channels:
        body = schedule.note or "Waktunya sekarang."
        try:
            push_sent, push_failed, push_removed = await send_push(
                client,
                settings,
                settings.owner_user_id,
                title=f"⏰ {schedule.title}",
                body=body,
                url="/jadwal",
                tag=f"schedule-{schedule.id}",
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Push dispatch failed: %s", exc)
    return push_sent, push_failed, push_removed


@router.get("/minutely", response_model=CronMinutelyOut)
@router.post("/minutely", response_model=CronMinutelyOut)
async def minutely(
    request: Request, settings: Settings = Depends(get_settings)
) -> CronMinutelyOut:
    _authorize(request, settings)

    from app.supabase_client import get_owner_client

    client = await get_owner_client()
    result = CronMinutelyOut()
    notes: list[str] = []

    try:
        due = await ScheduleService(client).claim_due()
        result.schedules_fired = len(due)
        for schedule in due:
            sent, failed, _removed = await _notify_schedule(client, settings, schedule)
            result.push_sent += sent
            result.push_failed += failed
    except Exception as exc:  # noqa: BLE001 - a bad schedule must not stop the outbox
        logger.warning("Schedule dispatch failed: %s", exc)
        notes.append(f"schedules: {exc}")

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

    result.detail = "; ".join(notes)[:1000]
    return result