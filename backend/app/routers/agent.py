"""Headless agent surface.

Everything here is reachable with the API token (``X-API-Key`` or
``Authorization: Bearer``) as well as the browser cookie, so scripts, cron
ticks, and Hermes drive Axtra without a session. Three jobs:

* ``/state``      — orchestrator menu/theme config, server-side (was localStorage).
* ``/apply``      — execute orchestrator actions on the server instead of the browser.
* ``/jobs``       — queue a chat turn; ``/api/cron/minutely`` runs it.
* ``/hooks/*``    — outbound bridge so Axtra can call Hermes.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.config import Settings, get_settings
from app.deps import CurrentUser, rate_limit, read_rate_limit
from app.memory_service_provider import build_memory_service
from app.schemas import OrchestratorAction, ScheduleCreate
from app.services.agent_job_service import enqueue_job, get_job, list_jobs
from app.services.schedule_service import ScheduleService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent", tags=["agent"])

STATE_TABLE = "orchestrator_state"
_STATE_FIELDS = ("order", "hidden", "labels", "theme", "updated_at")
# Handled by _apply_menu_actions, not by the per-action loop above it.
_MENU_ACTION_TYPES = (
    "menu_order",
    "menu_visibility",
    "menu_rename",
    "reset_menu",
    "set_theme",
)


class MenuState(BaseModel):
    order: list[str] = Field(default_factory=list)
    hidden: list[str] = Field(default_factory=list)
    labels: dict[str, str] = Field(default_factory=dict)
    theme: Literal["light", "dark"] | None = None
    updated_at: datetime | None = None


class ApplyRequest(BaseModel):
    actions: list[OrchestratorAction] = Field(default_factory=list)
    queue_chat: bool = True


class ApplyResult(BaseModel):
    executed: list[str] = Field(default_factory=list)
    queued_job_ids: list[str] = Field(default_factory=list)
    skipped: list[str] = Field(default_factory=list)
    state: MenuState = Field(default_factory=MenuState)


class JobCreate(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    mode: str = "general"
    title: str | None = Field(default=None, max_length=120)


class HookRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


def _state_out(row: dict[str, Any] | None) -> MenuState:
    if not row:
        return MenuState()
    return MenuState(**{key: row[key] for key in _STATE_FIELDS if key in row})


async def _read_state(client: Any, user_id: str) -> dict[str, Any] | None:
    response = (
        await client.table(STATE_TABLE)
        .select("*")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    return response.data if response else None


async def _write_state(client: Any, user_id: str, patch: dict[str, Any]) -> None:
    existing = await _read_state(client, user_id)
    patch = {**patch, "user_id": user_id}
    if existing:
        await client.table(STATE_TABLE).update(patch).eq("id", existing["id"]).execute()
    else:
        await client.table(STATE_TABLE).insert(patch).execute()


async def _apply_menu_actions(
    client: Any,
    user_id: str,
    actions: list[OrchestratorAction],
    theme: MenuState,
) -> MenuState:
    """Menu/theme actions used to be applied by the browser only (localStorage)."""
    patch: dict[str, Any] = {}
    for action in actions:
        if action.type == "menu_order" and action.order:
            patch["order"] = action.order
        elif action.type == "menu_visibility":
            patch["hidden"] = action.hidden or []
        elif action.type == "menu_rename" and action.labels:
            patch["labels"] = {**theme.labels, **(action.labels or {})}
        elif action.type == "set_theme" and action.theme:
            patch["theme"] = action.theme
        elif action.type == "reset_menu":
            patch = {"order": [], "hidden": [], "labels": {}}
    if not patch:
        return theme
    await _write_state(client, user_id, patch)
    return _state_out({**theme.model_dump(), **patch})


@router.get("/state", response_model=MenuState)
async def get_state(user: CurrentUser = Depends(read_rate_limit)) -> MenuState:
    return _state_out(await _read_state(user.client, user.id))


@router.put("/state", response_model=MenuState)
async def put_state(
    payload: MenuState, user: CurrentUser = Depends(rate_limit)
) -> MenuState:
    """Partial upsert: only the fields present in the body are overwritten, so a
    menu-only PUT from the sidebar never clears the theme (and vice versa)."""
    patch = payload.model_dump(exclude_unset=True, exclude={"updated_at"})
    if patch:
        await _write_state(user.client, user.id, patch)
    return _state_out(await _read_state(user.client, user.id))


@router.post("/apply", response_model=ApplyResult)
async def apply_actions(
    payload: ApplyRequest, user: CurrentUser = Depends(rate_limit)
) -> ApplyResult:
    """Execute orchestrator actions server-side.

    Memory writes, schedules, and menu/theme state land in the DB; chat work is
    queued as a job (a browser session would have run it inline).
    """
    result = ApplyResult()
    state = _state_out(await _read_state(user.client, user.id))

    for action in payload.actions:
        if action.type == "save_memory" and action.content:
            service = build_memory_service(user.client)
            existing = await service.find_active_by_content(user.id, action.content)
            memory = existing or await service.create(
                user.id,
                type_=action.memory_type or "semantic",
                content=action.content,
                source="orchestrator",
            )
            result.executed.append(f"save_memory:{memory.id}")
        elif action.type == "create_schedule" and action.title and (
            action.due_at or action.due_in_minutes
        ):
            schedule = await ScheduleService(user.client).create(
                user.id,
                ScheduleCreate(
                    title=action.title,
                    note=action.note or "",
                    due_at=action.due_at,
                    due_in_minutes=action.due_in_minutes,
                ),
            )
            result.executed.append(f"create_schedule:{schedule.id}")
        elif action.type in ("navigate", "new_conversation"):
            prompt = action.prompt or (action.title if action.type == "new_conversation" else None)
            if not prompt or not payload.queue_chat:
                result.skipped.append(f"{action.type}:tidak ada prompt")
                continue
            job = await enqueue_job(
                user.client,
                user.id,
                prompt=prompt,
                mode=action.mode or "general",
                title=action.title,
            )
            result.executed.append(f"queue_chat:{job['id']}")
            result.queued_job_ids.append(str(job["id"]))
        elif action.type in _MENU_ACTION_TYPES:
            # Applied by _apply_menu_actions below, so not a skip.
            continue
        else:
            result.skipped.append(f"{action.type}:tidak dieksekusi server")

    result.state = await _apply_menu_actions(user.client, user.id, payload.actions, state)
    return result


@router.post("/jobs", status_code=status.HTTP_201_CREATED)
async def create_job(
    payload: JobCreate, user: CurrentUser = Depends(rate_limit)
) -> dict[str, Any]:
    return await enqueue_job(
        user.client, user.id, prompt=payload.prompt, mode=payload.mode, title=payload.title
    )


@router.get("/jobs")
async def get_jobs(
    limit: int = 20, user: CurrentUser = Depends(read_rate_limit)
) -> list[dict[str, Any]]:
    return await list_jobs(user.client, user.id, limit=max(1, min(limit, 100)))


@router.get("/jobs/{job_id}")
async def get_job_by_id(
    job_id: str, user: CurrentUser = Depends(read_rate_limit)
) -> dict[str, Any]:
    job = await get_job(user.client, user.id, job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Job tidak ditemukan.")
    return job


@router.post("/hooks/hermes", status_code=status.HTTP_202_ACCEPTED)
async def forward_to_hermes(
    payload: HookRequest,
    user: CurrentUser = Depends(rate_limit),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Send a message to a Hermes webhook route (the outbound half of the bridge)."""
    if not settings.hermes_webhook_url:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, detail="HERMES_WEBHOOK_URL belum diatur."
        )
    headers = (
        {"Authorization": f"Bearer {settings.hermes_webhook_token}"}
        if settings.hermes_webhook_token
        else {}
    )
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            response = await http.post(
                settings.hermes_webhook_url,
                json={"text": payload.text, "source": "axtra"},
                headers=headers,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, detail=f"Hermes tidak terjangkau: {exc}"
        ) from exc
    return {"ok": response.status_code < 400, "status": response.status_code}
