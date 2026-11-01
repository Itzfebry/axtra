"""Schedule/reminder persistence (one-off reminders + countdown timers).

A row is ``active`` until a per-minute cron claims it (``claim_due``), which
flips it to ``done`` and stamps ``fired_at`` exactly once. Snoozing resets the
row to ``active`` with a new ``due_at``.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import AsyncClient

from app.schemas import ScheduleCreate, ScheduleOut, ScheduleUpdate

WIB = timezone(timedelta(hours=7), name="Asia/Jakarta")

TABLE = "schedules"


def _parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def to_utc(value: datetime) -> datetime:
    """Interpret a naive datetime as WIB, then return an aware UTC datetime."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=WIB)
    return value.astimezone(timezone.utc)


def resolve_due(payload: ScheduleCreate, *, now: datetime | None = None) -> datetime:
    """Compute the absolute UTC due time from a payload."""
    if payload.due_at is not None:
        return to_utc(payload.due_at)
    assert payload.due_in_minutes is not None  # validated by the schema
    base = now or datetime.now(timezone.utc)
    return base + timedelta(minutes=payload.due_in_minutes)


def _channels(raw: Any) -> list[str]:
    if isinstance(raw, list):
        return [str(item) for item in raw if isinstance(item, str)]
    return ["telegram", "push"]


def schedule_out(row: dict[str, Any], *, now: datetime | None = None) -> ScheduleOut:
    due_at = _parse_dt(row.get("due_at")) or datetime.now(timezone.utc)
    current = now or datetime.now(timezone.utc)
    return ScheduleOut(
        id=str(row["id"]),
        title=row.get("title") or "",
        note=row.get("note") or "",
        kind=row.get("kind") or "once",
        due_at=due_at,
        status=row.get("status") or "active",
        channels=_channels(row.get("channels")),
        source=row.get("source") or "web",
        fired_at=_parse_dt(row.get("fired_at")),
        done_at=_parse_dt(row.get("done_at")),
        created_at=_parse_dt(row.get("created_at")),
        updated_at=_parse_dt(row.get("updated_at")),
        due_in_seconds=int((due_at - current).total_seconds()),
    )


class ScheduleService:
    def __init__(self, client: AsyncClient) -> None:
        self.client = client

    async def create(
        self,
        user_id: str,
        payload: ScheduleCreate,
        *,
        source: str = "web",
        source_ref: dict[str, Any] | None = None,
    ) -> ScheduleOut:
        due = resolve_due(payload)
        row: dict[str, Any] = {
            "user_id": user_id,
            "title": payload.title,
            "note": payload.note,
            "kind": payload.kind,
            "due_at": due.isoformat(),
            "channels": payload.channels or ["telegram", "push"],
            "source": source,
            "source_ref": source_ref or {},
        }
        response = await self.client.table(TABLE).insert(row).execute()
        return schedule_out(response.data[0])

    async def list(
        self,
        user_id: str,
        *,
        status: str | None = None,
        limit: int = 100,
    ) -> list[ScheduleOut]:
        query = (
            self.client.table(TABLE)
            .select("*")
            .eq("user_id", user_id)
            .order("due_at")
            .limit(limit)
        )
        if status:
            query = query.eq("status", status)
        else:
            # Default view: everything not cancelled.
            query = query.neq("status", "cancelled")
        response = await query.execute()
        return [schedule_out(row) for row in response.data or []]

    async def get(self, user_id: str, schedule_id: str) -> ScheduleOut:
        response = await (
            self.client.table(TABLE)
            .select("*")
            .eq("user_id", user_id)
            .eq("id", schedule_id)
            .maybe_single()
            .execute()
        )
        if not response or not response.data:
            raise KeyError("schedule_not_found")
        return schedule_out(response.data)

    async def update(
        self, user_id: str, schedule_id: str, payload: ScheduleUpdate
    ) -> ScheduleOut:
        patch = payload.model_dump(exclude_unset=True, exclude_none=True)
        if "due_at" in patch and patch["due_at"] is not None:
            patch["due_at"] = to_utc(patch["due_at"]).isoformat()
        response = await (
            self.client.table(TABLE)
            .update(patch)
            .eq("user_id", user_id)
            .eq("id", schedule_id)
            .execute()
        )
        if not response.data:
            raise KeyError("schedule_not_found")
        return schedule_out(response.data[0])

    async def cancel(self, user_id: str, schedule_id: str) -> ScheduleOut:
        return await self._set_status(user_id, schedule_id, "cancelled")

    async def complete(self, user_id: str, schedule_id: str) -> ScheduleOut:
        response = await (
            self.client.table(TABLE)
            .update(
                {
                    "status": "done",
                    "done_at": datetime.now(timezone.utc).isoformat(),
                }
            )
            .eq("user_id", user_id)
            .eq("id", schedule_id)
            .execute()
        )
        if not response.data:
            raise KeyError("schedule_not_found")
        return schedule_out(response.data[0])

    async def snooze(
        self, user_id: str, schedule_id: str, minutes: int
    ) -> ScheduleOut:
        due = datetime.now(timezone.utc) + timedelta(minutes=minutes)
        response = await (
            self.client.table(TABLE)
            .update(
                {
                    "status": "active",
                    "due_at": due.isoformat(),
                    "fired_at": None,
                    "done_at": None,
                }
            )
            .eq("user_id", user_id)
            .eq("id", schedule_id)
            .execute()
        )
        if not response.data:
            raise KeyError("schedule_not_found")
        return schedule_out(response.data[0])

    async def _set_status(
        self, user_id: str, schedule_id: str, status: str
    ) -> ScheduleOut:
        response = await (
            self.client.table(TABLE)
            .update({"status": status})
            .eq("user_id", user_id)
            .eq("id", schedule_id)
            .execute()
        )
        if not response.data:
            raise KeyError("schedule_not_found")
        return schedule_out(response.data[0])

    async def delete(self, user_id: str, schedule_id: str) -> None:
        await (
            self.client.table(TABLE)
            .delete()
            .eq("user_id", user_id)
            .eq("id", schedule_id)
            .execute()
        )

    async def claim_due(self, *, limit: int = 50) -> list[ScheduleOut]:
        """Flip due ``active`` rows to ``done`` and return the claimed ones.

        The conditional update (``status='active'``) makes the claim idempotent
        even when two cron invocations overlap: only the update that changes a
        row returns data.
        """
        now = datetime.now(timezone.utc)
        response = await (
            self.client.table(TABLE)
            .select("*")
            .eq("status", "active")
            .lte("due_at", now.isoformat())
            .order("due_at")
            .limit(limit)
            .execute()
        )
        claimed: list[ScheduleOut] = []
        for row in response.data or []:
            updated = await (
                self.client.table(TABLE)
                .update({"status": "done", "fired_at": now.isoformat()})
                .eq("id", row["id"])
                .eq("status", "active")
                .execute()
            )
            if updated.data:
                claimed.append(schedule_out(row, now=now))
        return claimed
