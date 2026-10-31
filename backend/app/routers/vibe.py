"""Vibe Coding workspace endpoints.

Nested under a project so every read/write is scoped by the existing project
ownership check. Only prompts and evidence are produced here: Axtra never runs
commands, edits the repository, commits, pushes, or deploys.
"""

from __future__ import annotations

import logging
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.deps import CurrentUser, rate_limit, read_rate_limit
from app.llm import LLMProviderError
from app.memory_service_provider import build_vibe_service
from app.schemas import (
    ProjectTaskOut,
    VibeArtifactGenerate,
    VibeArtifactKind,
    VibeArtifactOut,
    VibeArtifactUpdate,
    VibeArtifactVersionOut,
    VibeDecisionCreate,
    VibeDecisionOut,
    VibeDecisionUpdate,
    VibeDiscoveryReply,
    VibeMessageCreate,
    VibeMessageOut,
    VibeSessionCreate,
    VibeSessionOut,
    VibeSessionUpdate,
    VibeTaskGenerateRequest,
    VibeTaskPromptOut,
    VibeVerificationUpdate,
)
from app.services.feature_persona import load_feature_persona
from app.services.project_service import ProjectService
from app.services.vibe_service import VibeOutputError, VibeService

logger = logging.getLogger("axtra.vibe")

router = APIRouter(
    prefix="/api/projects/{project_id}/vibe", tags=["vibe"]
)


async def _service(user: CurrentUser, project_id: str) -> VibeService:
    """Verify project ownership, then build a workspace service.

    Reads stay available without an LLM key; generation endpoints surface the
    provider error themselves.
    """
    try:
        await ProjectService(user.client).get(user.id, project_id)
    except Exception as exc:  # noqa: BLE001 - invalid id or not owned
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Proyek tidak ditemukan."
        ) from exc
    persona = await load_feature_persona(user.client, "vibe", user_id=user.id)
    return build_vibe_service(user.client, persona)


def _not_found(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail=detail)


def _llm_error(exc: LLMProviderError) -> HTTPException:
    raw = str(exc)
    lowered = raw.lower()
    limit_match = re.search(r"limit\s+(\d+)", raw, re.IGNORECASE)
    used_match = re.search(r"used\s+(\d+)", raw, re.IGNORECASE)
    requested_match = re.search(r"requested\s+(\d+)", raw, re.IGNORECASE)
    retry_match = re.search(
        r"try again in\s+([0-9]+(?:\.[0-9]+)?)\s*s", raw, re.IGNORECASE
    )
    if "429" in raw or "rate_limit" in lowered or "tokens per minute" in lowered:
        limit = int(limit_match.group(1)) if limit_match else None
        requested = int(requested_match.group(1)) if requested_match else None
        if limit and requested and requested > limit:
            detail = (
                f"Konteks terlalu besar untuk limit model ({requested} token > "
                f"{limit} token/menit). Kurangi dokumen/konteks atau pakai model "
                "dengan limit lebih tinggi."
            )
        else:
            wait = f" Coba lagi dalam ~{retry_match.group(1)}s." if retry_match else " Tunggu lalu coba lagi."
            used = f" (terpakai {used_match.group(1)}/{limit})" if used_match and limit else ""
            detail = f"Batas token per menit Groq tercapai{used}.{wait}"
    elif "not configured" in lowered or "groq_api_key" in lowered:
        detail = "LLM belum dikonfigurasi. Setel GROQ_API_KEY."
    elif "401" in raw or "invalid_api_key" in lowered or "unauthorized" in lowered:
        detail = "API key LLM tidak valid. Periksa GROQ_API_KEY di .env."
    elif "timeout" in lowered or "timed out" in lowered:
        detail = "Model LLM melebihi batas waktu. Coba lagi."
    else:
        detail = "LLM gagal memproses permintaan. Coba lagi sebentar."
    return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail)


def _bad_output(exc: VibeOutputError) -> HTTPException:
    return HTTPException(
        status.HTTP_502_BAD_GATEWAY,
        detail=f"Output model tidak dapat digunakan: {exc}",
    )


async def _require_session(
    service: VibeService,
    user: CurrentUser,
    project_id: str,
    session_id: str,
) -> None:
    """Reject a session id that does not belong to this project/owner."""
    try:
        await service.get_session(user.id, project_id, session_id)
    except Exception as exc:  # noqa: BLE001
        raise _not_found("Workspace tidak ditemukan.") from exc


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------
@router.get("/sessions", response_model=list[VibeSessionOut])
async def list_sessions(
    project_id: uuid.UUID, user: CurrentUser = Depends(read_rate_limit)
) -> list[VibeSessionOut]:
    service = await _service(user, str(project_id))
    return await service.list_sessions(user.id, str(project_id))


@router.post(
    "/sessions", response_model=VibeSessionOut, status_code=status.HTTP_201_CREATED
)
async def create_session(
    project_id: uuid.UUID,
    payload: VibeSessionCreate,
    user: CurrentUser = Depends(rate_limit),
) -> VibeSessionOut:
    if not (
        payload.idea.strip()
        or payload.problem.strip()
        or payload.title.strip()
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Isi minimal ide, masalah, atau judul workspace.",
        )
    service = await _service(user, str(project_id))
    return await service.create_session(
        user.id,
        str(project_id),
        title=payload.title,
        idea=payload.idea,
        problem=payload.problem,
        target_users=payload.target_users,
        constraints=payload.constraints,
    )


@router.get("/sessions/{session_id}", response_model=VibeSessionOut)
async def get_session(
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    user: CurrentUser = Depends(read_rate_limit),
) -> VibeSessionOut:
    service = await _service(user, str(project_id))
    try:
        return await service.get_session(user.id, str(project_id), str(session_id))
    except Exception as exc:  # noqa: BLE001
        raise _not_found("Workspace tidak ditemukan.") from exc


@router.patch("/sessions/{session_id}", response_model=VibeSessionOut)
async def update_session(
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    payload: VibeSessionUpdate,
    user: CurrentUser = Depends(rate_limit),
) -> VibeSessionOut:
    service = await _service(user, str(project_id))
    try:
        return await service.update_session(
            user.id,
            str(project_id),
            str(session_id),
            payload.model_dump(exclude_unset=True),
        )
    except KeyError as exc:
        raise _not_found("Workspace tidak ditemukan.") from exc


@router.delete(
    "/sessions/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
async def delete_session(
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    user: CurrentUser = Depends(rate_limit),
) -> None:
    service = await _service(user, str(project_id))
    await service.delete_session(user.id, str(project_id), str(session_id))


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------
@router.get("/sessions/{session_id}/messages", response_model=list[VibeMessageOut])
async def list_messages(
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    limit: int = Query(default=200, ge=1, le=500),
    user: CurrentUser = Depends(read_rate_limit),
) -> list[VibeMessageOut]:
    service = await _service(user, str(project_id))
    try:
        await service.get_session(user.id, str(project_id), str(session_id))
    except Exception as exc:  # noqa: BLE001
        raise _not_found("Workspace tidak ditemukan.") from exc
    return await service.list_messages(str(session_id), limit=limit)


@router.post(
    "/sessions/{session_id}/messages",
    response_model=VibeDiscoveryReply,
    status_code=status.HTTP_201_CREATED,
)
async def send_discovery_message(
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    payload: VibeMessageCreate,
    user: CurrentUser = Depends(rate_limit),
) -> VibeDiscoveryReply:
    service = await _service(user, str(project_id))
    try:
        message, decisions, questions = await service.discovery(
            user.id, str(project_id), str(session_id), payload.content
        )
    except LLMProviderError as exc:
        raise _llm_error(exc) from exc
    except VibeOutputError as exc:
        raise _bad_output(exc) from exc
    except Exception as exc:  # noqa: BLE001 - most likely a missing session
        logger.warning("Vibe discovery failed for %s: %s", session_id, exc)
        raise _not_found("Workspace tidak ditemukan.") from exc
    return VibeDiscoveryReply(
        message=message, decisions=decisions, questions=questions
    )


# ---------------------------------------------------------------------------
# Decisions
# ---------------------------------------------------------------------------
@router.get(
    "/sessions/{session_id}/decisions", response_model=list[VibeDecisionOut]
)
async def list_decisions(
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    user: CurrentUser = Depends(read_rate_limit),
) -> list[VibeDecisionOut]:
    service = await _service(user, str(project_id))
    await _require_session(service, user, str(project_id), str(session_id))
    return await service.list_decisions(str(session_id))


@router.post(
    "/sessions/{session_id}/decisions",
    response_model=VibeDecisionOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_decision(
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    payload: VibeDecisionCreate,
    user: CurrentUser = Depends(rate_limit),
) -> VibeDecisionOut:
    service = await _service(user, str(project_id))
    await _require_session(service, user, str(project_id), str(session_id))
    return await service.create_decision(
        user.id,
        str(session_id),
        category=payload.category,
        statement=payload.statement,
        status=payload.status,
        rationale=payload.rationale,
        source=payload.source,
    )


@router.patch(
    "/sessions/{session_id}/decisions/{decision_id}",
    response_model=VibeDecisionOut,
)
async def update_decision(
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    decision_id: uuid.UUID,
    payload: VibeDecisionUpdate,
    user: CurrentUser = Depends(rate_limit),
) -> VibeDecisionOut:
    service = await _service(user, str(project_id))
    await _require_session(service, user, str(project_id), str(session_id))
    try:
        return await service.update_decision(
            str(session_id),
            str(decision_id),
            payload.model_dump(exclude_unset=True),
        )
    except KeyError as exc:
        raise _not_found("Keputusan tidak ditemukan.") from exc


@router.delete(
    "/sessions/{session_id}/decisions/{decision_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
async def delete_decision(
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    decision_id: uuid.UUID,
    user: CurrentUser = Depends(rate_limit),
) -> None:
    service = await _service(user, str(project_id))
    await _require_session(service, user, str(project_id), str(session_id))
    await service.delete_decision(str(session_id), str(decision_id))


# ---------------------------------------------------------------------------
# Artifacts
# ---------------------------------------------------------------------------
@router.get(
    "/sessions/{session_id}/artifacts", response_model=list[VibeArtifactOut]
)
async def list_artifacts(
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    user: CurrentUser = Depends(read_rate_limit),
) -> list[VibeArtifactOut]:
    service = await _service(user, str(project_id))
    await _require_session(service, user, str(project_id), str(session_id))
    return await service.list_artifacts(str(session_id))


@router.get(
    "/sessions/{session_id}/artifacts/{kind}", response_model=VibeArtifactOut
)
async def get_artifact(
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    kind: VibeArtifactKind,
    user: CurrentUser = Depends(read_rate_limit),
) -> VibeArtifactOut:
    service = await _service(user, str(project_id))
    await _require_session(service, user, str(project_id), str(session_id))
    try:
        return await service.get_artifact(str(session_id), kind)
    except Exception as exc:  # noqa: BLE001
        raise _not_found("Dokumen belum dibuat.") from exc


@router.post(
    "/sessions/{session_id}/artifacts/{kind}/generate",
    response_model=VibeArtifactOut,
)
async def generate_artifact(
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    kind: VibeArtifactKind,
    payload: VibeArtifactGenerate,
    user: CurrentUser = Depends(rate_limit),
) -> VibeArtifactOut:
    service = await _service(user, str(project_id))
    try:
        return await service.generate_artifact(
            user.id, str(project_id), str(session_id), kind, payload.instructions
        )
    except LLMProviderError as exc:
        raise _llm_error(exc) from exc
    except VibeOutputError as exc:
        raise _bad_output(exc) from exc
    except Exception as exc:  # noqa: BLE001
        logger.warning("Vibe artifact generation failed: %s", exc)
        raise _not_found("Workspace tidak ditemukan.") from exc


@router.put(
    "/sessions/{session_id}/artifacts/{kind}", response_model=VibeArtifactOut
)
async def save_artifact(
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    kind: VibeArtifactKind,
    payload: VibeArtifactUpdate,
    user: CurrentUser = Depends(rate_limit),
) -> VibeArtifactOut:
    service = await _service(user, str(project_id))
    try:
        return await service.save_artifact_edit(
            user.id,
            str(project_id),
            str(session_id),
            kind,
            payload.content,
            note=payload.note,
        )
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    except Exception as exc:  # noqa: BLE001
        raise _not_found("Workspace tidak ditemukan.") from exc


@router.post(
    "/sessions/{session_id}/artifacts/{kind}/approve",
    response_model=VibeArtifactOut,
)
async def approve_artifact(
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    kind: VibeArtifactKind,
    user: CurrentUser = Depends(rate_limit),
) -> VibeArtifactOut:
    service = await _service(user, str(project_id))
    await _require_session(service, user, str(project_id), str(session_id))
    try:
        return await service.approve_artifact(str(session_id), kind)
    except Exception as exc:  # noqa: BLE001
        raise _not_found("Dokumen belum dibuat.") from exc


@router.post(
    "/sessions/{session_id}/artifacts/{kind}/stale",
    response_model=VibeArtifactOut,
)
async def stale_artifact(
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    kind: VibeArtifactKind,
    user: CurrentUser = Depends(rate_limit),
) -> VibeArtifactOut:
    service = await _service(user, str(project_id))
    await _require_session(service, user, str(project_id), str(session_id))
    try:
        return await service.mark_artifact_stale(str(session_id), kind)
    except Exception as exc:  # noqa: BLE001
        raise _not_found("Dokumen belum dibuat.") from exc


@router.get(
    "/sessions/{session_id}/artifacts/{kind}/versions",
    response_model=list[VibeArtifactVersionOut],
)
async def list_versions(
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    kind: VibeArtifactKind,
    user: CurrentUser = Depends(read_rate_limit),
) -> list[VibeArtifactVersionOut]:
    service = await _service(user, str(project_id))
    await _require_session(service, user, str(project_id), str(session_id))
    try:
        artifact = await service.get_artifact(str(session_id), kind)
    except Exception as exc:  # noqa: BLE001
        raise _not_found("Dokumen belum dibuat.") from exc
    return await service.list_versions(artifact.id)


# ---------------------------------------------------------------------------
# Implementation plan, prompt handoff, verification
# ---------------------------------------------------------------------------
@router.get("/sessions/{session_id}/tasks", response_model=list[ProjectTaskOut])
async def list_session_tasks(
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    user: CurrentUser = Depends(read_rate_limit),
) -> list[ProjectTaskOut]:
    service = await _service(user, str(project_id))
    await _require_session(service, user, str(project_id), str(session_id))
    return await service.list_session_tasks(str(session_id))


@router.post("/sessions/{session_id}/tasks/generate", response_model=list[ProjectTaskOut])
async def generate_tasks(
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    payload: VibeTaskGenerateRequest,
    user: CurrentUser = Depends(rate_limit),
) -> list[ProjectTaskOut]:
    service = await _service(user, str(project_id))
    try:
        return await service.generate_tasks(
            user.id, str(project_id), str(session_id), payload.max_tasks
        )
    except LLMProviderError as exc:
        raise _llm_error(exc) from exc
    except VibeOutputError as exc:
        raise _bad_output(exc) from exc
    except Exception as exc:  # noqa: BLE001
        logger.warning("Vibe task generation failed: %s", exc)
        raise _not_found("Workspace tidak ditemukan.") from exc


@router.post(
    "/sessions/{session_id}/tasks/{task_id}/prompt",
    response_model=VibeTaskPromptOut,
)
async def build_task_prompt(
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    task_id: uuid.UUID,
    user: CurrentUser = Depends(rate_limit),
) -> VibeTaskPromptOut:
    service = await _service(user, str(project_id))
    try:
        prompt = await service.build_prompt(
            user.id, str(project_id), str(session_id), str(task_id)
        )
    except Exception as exc:  # noqa: BLE001
        raise _not_found("Task tidak ditemukan pada workspace ini.") from exc
    return VibeTaskPromptOut(task_id=str(task_id), prompt=prompt)


@router.patch(
    "/sessions/{session_id}/tasks/{task_id}/verification",
    response_model=ProjectTaskOut,
)
async def update_verification(
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    task_id: uuid.UUID,
    payload: VibeVerificationUpdate,
    user: CurrentUser = Depends(rate_limit),
) -> ProjectTaskOut:
    service = await _service(user, str(project_id))
    try:
        return await service.update_verification(
            str(project_id),
            str(session_id),
            str(task_id),
            status=payload.status,
            evidence=payload.evidence,
            notes=payload.notes,
        )
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    except Exception as exc:  # noqa: BLE001
        raise _not_found("Task tidak ditemukan pada workspace ini.") from exc