"""Schedule/reminder endpoints (one-off reminders + countdown timers)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.deps import CurrentUser, rate_limit, read_rate_limit
from app.schemas import (
    ScheduleCreate,
    ScheduleOut,
    ScheduleSnooze,
    ScheduleUpdate,
)
from app.services.schedule_service import ScheduleService

router = APIRouter(prefix="/api/schedules", tags=["schedules"])


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail="Jadwal tidak ditemukan.")


@router.get("", response_model=list[ScheduleOut])
async def list_schedules(
    user: CurrentUser = Depends(read_rate_limit),
    status_: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=200),
) -> list[ScheduleOut]:
    return await ScheduleService(user.client).list(
        user.id, status=status_, limit=limit
    )


@router.post("", response_model=ScheduleOut, status_code=status.HTTP_201_CREATED)
async def create_schedule(
    payload: ScheduleCreate, user: CurrentUser = Depends(rate_limit)
) -> ScheduleOut:
    return await ScheduleService(user.client).create(user.id, payload)


@router.patch("/{schedule_id}", response_model=ScheduleOut)
async def update_schedule(
    schedule_id: uuid.UUID,
    payload: ScheduleUpdate,
    user: CurrentUser = Depends(rate_limit),
) -> ScheduleOut:
    try:
        return await ScheduleService(user.client).update(
            user.id, str(schedule_id), payload
        )
    except KeyError as exc:
        raise _not_found() from exc


@router.delete(
    "/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None
)
async def delete_schedule(
    schedule_id: uuid.UUID, user: CurrentUser = Depends(rate_limit)
) -> None:
    await ScheduleService(user.client).delete(user.id, str(schedule_id))


@router.post("/{schedule_id}/snooze", response_model=ScheduleOut)
async def snooze_schedule(
    schedule_id: uuid.UUID,
    payload: ScheduleSnooze,
    user: CurrentUser = Depends(rate_limit),
) -> ScheduleOut:
    try:
        return await ScheduleService(user.client).snooze(
            user.id, str(schedule_id), payload.minutes
        )
    except KeyError as exc:
        raise _not_found() from exc


@router.post("/{schedule_id}/complete", response_model=ScheduleOut)
async def complete_schedule(
    schedule_id: uuid.UUID, user: CurrentUser = Depends(rate_limit)
) -> ScheduleOut:
    try:
        return await ScheduleService(user.client).complete(user.id, str(schedule_id))
    except KeyError as exc:
        raise _not_found() from exc


@router.post("/{schedule_id}/cancel", response_model=ScheduleOut)
async def cancel_schedule(
    schedule_id: uuid.UUID, user: CurrentUser = Depends(rate_limit)
) -> ScheduleOut:
    try:
        return await ScheduleService(user.client).cancel(user.id, str(schedule_id))
    except KeyError as exc:
        raise _not_found() from exc
