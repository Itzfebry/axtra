"""Daily journal + goal tracking (Phase 2 completion, minimal)."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from supabase import AsyncClient

from app.schemas import (
    GoalCreate,
    GoalOut,
    GoalUpdate,
    JournalEntryCreate,
    JournalEntryOut,
    JournalEntryUpdate,
)

WIB = timezone(timedelta(hours=7), name="Asia/Jakarta")

JOURNAL_TABLE = "journal_entries"
GOALS_TABLE = "goals"


def today_wib(now: datetime | None = None) -> date:
    return (now or datetime.now(timezone.utc)).astimezone(WIB).date()


def _entry_out(row: dict[str, Any]) -> JournalEntryOut:
    tags = row.get("tags")
    return JournalEntryOut(
        id=str(row["id"]),
        entry_date=row["entry_date"],
        content=row.get("content") or "",
        mood=row.get("mood") or "",
        tags=[str(tag) for tag in tags] if isinstance(tags, list) else [],
        source=row.get("source") or "web",
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


def _goal_out(row: dict[str, Any]) -> GoalOut:
    return GoalOut(
        id=str(row["id"]),
        title=row.get("title") or "",
        detail=row.get("detail") or "",
        status=row.get("status") or "active",
        target_date=row.get("target_date"),
        progress=int(row.get("progress") or 0),
        source=row.get("source") or "web",
        completed_at=row.get("completed_at"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


class JournalService:
    def __init__(self, client: AsyncClient) -> None:
        self.client = client

    # -- journal -----------------------------------------------------------
    async def create_entry(
        self,
        user_id: str,
        payload: JournalEntryCreate,
        *,
        source: str = "web",
        source_ref: dict[str, Any] | None = None,
    ) -> JournalEntryOut:
        row: dict[str, Any] = {
            "user_id": user_id,
            "entry_date": (payload.entry_date or today_wib()).isoformat(),
            "content": payload.content,
            "mood": payload.mood,
            "tags": payload.tags,
            "source": source,
            "source_ref": source_ref or {},
        }
        response = await self.client.table(JOURNAL_TABLE).insert(row).execute()
        return _entry_out(response.data[0])

    async def list_entries(
        self, user_id: str, *, day: date | None = None, limit: int = 50
    ) -> list[JournalEntryOut]:
        query = (
            self.client.table(JOURNAL_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .order("entry_date", desc=True)
            .order("created_at", desc=True)
            .limit(limit)
        )
        if day is not None:
            query = query.eq("entry_date", day.isoformat())
        response = await query.execute()
        return [_entry_out(row) for row in response.data or []]

    async def update_entry(
        self, user_id: str, entry_id: str, payload: JournalEntryUpdate
    ) -> JournalEntryOut:
        patch = payload.model_dump(exclude_unset=True, exclude_none=True)
        if "entry_date" in patch and patch["entry_date"] is not None:
            patch["entry_date"] = patch["entry_date"].isoformat()
        response = (
            await self.client.table(JOURNAL_TABLE)
            .update(patch)
            .eq("user_id", user_id)
            .eq("id", entry_id)
            .execute()
        )
        if not response.data:
            raise KeyError("journal_not_found")
        return _entry_out(response.data[0])

    async def delete_entry(self, user_id: str, entry_id: str) -> None:
        await (
            self.client.table(JOURNAL_TABLE)
            .delete()
            .eq("user_id", user_id)
            .eq("id", entry_id)
            .execute()
        )

    # -- goals -------------------------------------------------------------
    async def create_goal(
        self,
        user_id: str,
        payload: GoalCreate,
        *,
        source: str = "web",
        source_ref: dict[str, Any] | None = None,
    ) -> GoalOut:
        row: dict[str, Any] = {
            "user_id": user_id,
            "title": payload.title,
            "detail": payload.detail,
            "progress": payload.progress,
            "source": source,
            "source_ref": source_ref or {},
        }
        if payload.target_date is not None:
            row["target_date"] = payload.target_date.isoformat()
        response = await self.client.table(GOALS_TABLE).insert(row).execute()
        return _goal_out(response.data[0])

    async def list_goals(
        self, user_id: str, *, status: str | None = None, limit: int = 100
    ) -> list[GoalOut]:
        query = (
            self.client.table(GOALS_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
        )
        if status:
            query = query.eq("status", status)
        response = await query.execute()
        return [_goal_out(row) for row in response.data or []]

    async def update_goal(
        self, user_id: str, goal_id: str, payload: GoalUpdate
    ) -> GoalOut:
        patch = payload.model_dump(exclude_unset=True, exclude_none=True)
        if "target_date" in patch and patch["target_date"] is not None:
            patch["target_date"] = patch["target_date"].isoformat()
        if patch.get("status") == "done":
            patch["completed_at"] = datetime.now(timezone.utc).isoformat()
            patch.setdefault("progress", 100)
        elif patch.get("status") == "active":
            patch["completed_at"] = None
        response = (
            await self.client.table(GOALS_TABLE)
            .update(patch)
            .eq("user_id", user_id)
            .eq("id", goal_id)
            .execute()
        )
        if not response.data:
            raise KeyError("goal_not_found")
        return _goal_out(response.data[0])

    async def delete_goal(self, user_id: str, goal_id: str) -> None:
        await (
            self.client.table(GOALS_TABLE)
            .delete()
            .eq("user_id", user_id)
            .eq("id", goal_id)
            .execute()
        )

    async def daily_snapshot(self, user_id: str, day: date) -> dict[str, Any]:
        """Counts + goal/entry summary used by the daily report."""
        entries: list[JournalEntryOut] = []
        goals: list[GoalOut] = []
        try:
            entries = await self.list_entries(user_id, day=day, limit=50)
        except Exception:  # noqa: BLE001 - report is best-effort
            entries = []
        try:
            goals = await self.list_goals(user_id, status="active", limit=50)
        except Exception:  # noqa: BLE001
            goals = []
        return {"entries": entries, "active_goals": goals}