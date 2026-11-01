"""Deterministic daily/weekly reports for the automation engine.

Reports are built without an LLM so they are cheap, predictable, and safe to
send on a schedule. Text uses Telegram HTML; every dynamic string is escaped.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from supabase import AsyncClient

from app.config import Settings
from app.services.journal_service import WIB, JournalService, today_wib
from app.services.telegram_client import escape_html
from app.services.usage_service import get_usage

_CLOSED_JOB_STATUSES = {"ditolak", "ditarik"}


def _day_since_utc(day: date) -> datetime:
    start = datetime(day.year, day.month, day.day, tzinfo=WIB)
    return start.astimezone(timezone.utc)


async def _count_since(
    client: AsyncClient, table: str, user_id: str, since: datetime
) -> int:
    try:
        response = await (
            client.table(table)
            .select("id")
            .eq("user_id", user_id)
            .gte("created_at", since.isoformat())
            .execute()
        )
        return len(response.data or [])
    except Exception:  # noqa: BLE001 - report is best-effort
        return 0


async def _upcoming_jobs(client: AsyncClient, user_id: str) -> list[dict[str, Any]]:
    try:
        response = await (
            client.table("job_applications")
            .select("company,role,status,deadline")
            .eq("user_id", user_id)
            .execute()
        )
    except Exception:  # noqa: BLE001
        return []
    today = today_wib()
    limit = today + timedelta(days=14)
    rows: list[dict[str, Any]] = []
    for row in response.data or []:
        status = str(row.get("status") or "")
        if status in _CLOSED_JOB_STATUSES:
            continue
        deadline = row.get("deadline")
        if not deadline:
            continue
        try:
            parsed = date.fromisoformat(str(deadline)[:10])
        except ValueError:
            continue
        if today <= parsed <= limit:
            rows.append(row)
    rows.sort(key=lambda row: str(row.get("deadline")))
    return rows


async def _stale_projects(client: AsyncClient, user_id: str) -> int:
    try:
        response = await (
            client.table("projects")
            .select("id")
            .eq("user_id", user_id)
            .eq("health_stale", True)
            .execute()
        )
        return len(response.data or [])
    except Exception:  # noqa: BLE001
        return 0


def _format_entries(entries: list[Any]) -> list[str]:
    lines: list[str] = []
    for entry in entries[:5]:
        content = " ".join((entry.content or "").split())
        if len(content) > 160:
            content = content[:159].rstrip() + "…"
        mood = f" ({escape_html(entry.mood)})" if entry.mood else ""
        lines.append(f"• {escape_html(content)}{mood}")
    return lines


async def build_daily_report(
    settings: Settings, client: AsyncClient, user_id: str, *, day: date | None = None
) -> str:
    day = day or today_wib()
    since = _day_since_utc(day)

    messages = await _count_since(client, "messages", user_id, since)
    memories = await _count_since(client, "memories", user_id, since)
    images = await _count_since(client, "image_usage_events", user_id, since)
    journal = JournalService(client)
    snapshot = await journal.daily_snapshot(user_id, day)
    usage = await get_usage(client)
    jobs = await _upcoming_jobs(client, user_id)
    stale = await _stale_projects(client, user_id)

    date_label = day.strftime("%d %B %Y")
    lines: list[str] = [
        f"<b>Laporan harian · {date_label}</b>",
        "",
        f"Aktivitas: <b>{messages}</b> pesan · <b>{memories}</b> memori baru · "
        f"<b>{images}</b> gambar",
        f"Token dipakai hari ini: <b>{usage.day_tokens:,}</b>".replace(",", "."),
    ]

    entries = snapshot.get("entries") or []
    if entries:
        lines += ["", f"<b>Jurnal ({len(entries)})</b>", *_format_entries(entries)]

    goals = snapshot.get("active_goals") or []
    if goals:
        lines += ["", f"<b>Target aktif ({len(goals)})</b>"]
        for goal in goals[:5]:
            lines.append(f"• {escape_html(goal.title)} ({goal.progress}%)")

    if jobs:
        lines += ["", "<b>Deadline lamaran ≤14 hari</b>"]
        for row in jobs[:5]:
            lines.append(
                f"• {escape_html(str(row.get('company') or '?'))} — "
                f"{escape_html(str(row.get('role') or '?'))} · "
                f"{escape_html(str(row.get('deadline')))}"
            )

    if stale:
        lines += ["", f"{stale} proyek menunggu pembaruan ringkasan kesehatan."]

    if not (entries or goals or jobs):
        lines += ["", "Belum ada catatan hari ini. Mulai dengan /jurnal atau /target."]

    return "\n".join(lines)


async def build_weekly_report(
    settings: Settings, client: AsyncClient, user_id: str, *, day: date | None = None
) -> str:
    day = day or today_wib()
    start = day - timedelta(days=6)
    since = _day_since_utc(start)

    messages = await _count_since(client, "messages", user_id, since)
    memories = await _count_since(client, "memories", user_id, since)
    images = await _count_since(client, "image_usage_events", user_id, since)
    jobs = await _upcoming_jobs(client, user_id)

    lines: list[str] = [
        f"<b>Review mingguan · {start.strftime('%d %b')} – {day.strftime('%d %b %Y')}</b>",
        "",
        f"Pesan: <b>{messages}</b> · Memori baru: <b>{memories}</b> · "
        f"Gambar: <b>{images}</b>",
    ]
    if jobs:
        lines += ["", "<b>Lamaran aktif dengan deadline terdekat</b>"]
        for row in jobs[:5]:
            lines.append(
                f"• {escape_html(str(row.get('company') or '?'))} — "
                f"{escape_html(str(row.get('role') or '?'))} · "
                f"{escape_html(str(row.get('deadline')))}"
            )
    lines += ["", "Tetapkan satu prioritas untuk minggu depan lewat /target."]
    return "\n".join(lines)