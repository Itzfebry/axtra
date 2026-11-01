"""Daily journal + goal tracking endpoints (Phase 2 completion, minimal)."""

from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.deps import CurrentUser, rate_limit, read_rate_limit
from app.schemas import (
    GoalCreate,
    GoalOut,
    GoalUpdate,
    JournalEntryCreate,
    JournalEntryOut,
    JournalEntryUpdate,
)
from app.services.journal_service import JournalService

router = APIRouter(prefix="/api", tags=["journal"])


@router.get("/journal", response_model=list[JournalEntryOut])
async def list_journal(
    user: CurrentUser = Depends(read_rate_limit),
    day: date | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[JournalEntryOut]:
    return await JournalService(user.client).list_entries(user.id, day=day, limit=limit)


@router.post(
    "/journal", response_model=JournalEntryOut, status_code=status.HTTP_201_CREATED
)
async def create_journal(
    payload: JournalEntryCreate, user: CurrentUser = Depends(rate_limit)
) -> JournalEntryOut:
    return await JournalService(user.client).create_entry(user.id, payload)


@router.patch("/journal/{entry_id}", response_model=JournalEntryOut)
async def update_journal(
    entry_id: uuid.UUID,
    payload: JournalEntryUpdate,
    user: CurrentUser = Depends(rate_limit),
) -> JournalEntryOut:
    try:
        return await JournalService(user.client).update_entry(
            user.id, str(entry_id), payload
        )
    except KeyError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Catatan tidak ditemukan.") from exc


@router.delete("/journal/{entry_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_journal(
    entry_id: uuid.UUID, user: CurrentUser = Depends(rate_limit)
) -> None:
    await JournalService(user.client).delete_entry(user.id, str(entry_id))


@router.get("/goals", response_model=list[GoalOut])
async def list_goals(
    user: CurrentUser = Depends(read_rate_limit),
    status_: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=200),
) -> list[GoalOut]:
    return await JournalService(user.client).list_goals(
        user.id, status=status_, limit=limit
    )


@router.post("/goals", response_model=GoalOut, status_code=status.HTTP_201_CREATED)
async def create_goal(
    payload: GoalCreate, user: CurrentUser = Depends(rate_limit)
) -> GoalOut:
    return await JournalService(user.client).create_goal(user.id, payload)


@router.patch("/goals/{goal_id}", response_model=GoalOut)
async def update_goal(
    goal_id: uuid.UUID,
    payload: GoalUpdate,
    user: CurrentUser = Depends(rate_limit),
) -> GoalOut:
    try:
        return await JournalService(user.client).update_goal(
            user.id, str(goal_id), payload
        )
    except KeyError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Target tidak ditemukan.") from exc


@router.delete("/goals/{goal_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_goal(
    goal_id: uuid.UUID, user: CurrentUser = Depends(rate_limit)
) -> None:
    await JournalService(user.client).delete_goal(user.id, str(goal_id))