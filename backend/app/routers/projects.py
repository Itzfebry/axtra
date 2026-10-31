"""Project management endpoints: list, inspect, create, update, delete."""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from app.deps import CurrentUser, rate_limit, read_rate_limit
from app.llm import LLMProviderError
from app.memory_service_provider import build_code_indexer, build_project_analyzer
from app.config import get_settings
from app.schemas import (
    ProjectAskOut,
    ProjectConversationOut,
    ProjectCreate,
    ProjectDocumentCreate,
    ProjectDocumentOut,
    ProjectDocumentUpdate,
    ProjectOut,
    ProjectTaskCreate,
    ProjectTaskOut,
    ProjectTaskReorder,
    ProjectTaskUpdate,
    ProjectUpdate,
    RepoAskOut,
    RepoAskRequest,
    RepoFileContentOut,
    RepoFileOut,
)
from app.services.feature_persona import load_feature_persona
from app.services.health_scheduler import (
    cancel_health_refresh,
    is_health_refresh_pending,
    schedule_health_refresh,
)
from app.services.project_service import ProjectService
from app.supabase_client import get_owner_client

logger = logging.getLogger("axtra.projects")

router = APIRouter(prefix="/api/projects", tags=["projects"])

_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _format_sse(event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"


def _service(user: CurrentUser) -> ProjectService:
    return ProjectService(user.client)


async def _refresh_health(user: CurrentUser, project_id: str) -> None:
    """Mark the cached AI summary stale and schedule a debounced refresh."""
    try:
        await _service(user).update(user.id, project_id, {"health_stale": True})
    except Exception:  # noqa: BLE001 - staleness is best-effort
        pass
    settings = get_settings()
    if settings.project_health_auto_refresh:
        schedule_health_refresh(
            project_id, user.id, settings.project_health_debounce_seconds
        )


@router.get("", response_model=list[ProjectOut])
async def list_projects(
    user: CurrentUser = Depends(read_rate_limit),
    status_: str | None = Query(default=None),
    search: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[ProjectOut]:
    return await _service(user).list_projects(
        user.id, status_=status_, search=search, limit=limit, offset=offset
    )


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate, user: CurrentUser = Depends(rate_limit)
) -> ProjectOut:
    project = await _service(user).create(
        user.id,
        name=payload.name.strip(),
        description=payload.description,
        status_=payload.status,
        tech_stack=payload.tech_stack,
        labels=payload.labels,
        repo_url=payload.repo_url,
        notes=payload.notes,
    )
    await _refresh_health(user, project.id)
    return project


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: uuid.UUID, user: CurrentUser = Depends(read_rate_limit)
) -> ProjectOut:
    try:
        project = await _service(user).get(user.id, str(project_id))
    except Exception as exc:  # noqa: BLE001 - invalid id or not owned
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Proyek tidak ditemukan."
        ) from exc
    # Lazy bootstrap: refresh a stale summary once, without resetting the
    # debounce timer on every poll while the refresh is already queued.
    settings = get_settings()
    if (
        project.health_stale
        and settings.project_health_auto_refresh
        and not is_health_refresh_pending(str(project_id))
    ):
        schedule_health_refresh(str(project_id), user.id, 0.5)
    return project


@router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: uuid.UUID,
    payload: ProjectUpdate,
    user: CurrentUser = Depends(rate_limit),
) -> ProjectOut:
    service = _service(user)
    raw = payload.model_dump(exclude_unset=True)
    # Only repo_url is nullable. Every other field is NOT NULL in the table, so a
    # None sent for it must be ignored rather than written (which would error).
    patch: dict[str, Any] = {
        key: value
        for key, value in raw.items()
        if value is not None or key == "repo_url"
    }
    if "name" in patch:
        patch["name"] = patch["name"].strip()
    if "repo_url" in patch:
        # A new repo URL (or clearing it) invalidates the previous index.
        patch.update(
            {
                "repo_index_status": "none",
                "repo_summary": None,
                "repo_index_error": None,
                "repo_file_count": 0,
                "repo_chunk_count": 0,
                "repo_index_progress": 0,
                "repo_index_stage": None,
                "repo_indexed_at": None,
            }
        )
        await _clear_chunks(user, str(project_id))
    try:
        updated = await service.update(user.id, str(project_id), patch)
    except KeyError as exc:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Proyek tidak ditemukan."
        ) from exc
    await _refresh_health(user, str(project_id))
    return updated


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_project(
    project_id: uuid.UUID, user: CurrentUser = Depends(rate_limit)
) -> None:
    cancel_health_refresh(str(project_id))
    await _service(user).delete(user.id, str(project_id))


async def _clear_chunks(user: CurrentUser, project_id: str) -> None:
    await (
        user.client.table("project_code_chunks")
        .delete()
        .eq("project_id", project_id)
        .execute()
    )


async def _run_index(project_id: str, user_id: str, repo_url: str) -> None:
    client = await get_owner_client()
    indexer = build_code_indexer(client)
    await indexer.index_project(project_id, user_id, repo_url)
    # A fresh index changes the project context; refresh the AI summary.
    settings = get_settings()
    if settings.project_health_auto_refresh:
        try:
            service = ProjectService(client)
            await service.update(user_id, project_id, {"health_stale": True})
            schedule_health_refresh(
                project_id, user_id, settings.project_health_debounce_seconds
            )
        except Exception:  # noqa: BLE001 - best-effort
            logger.warning("Failed to schedule post-index health refresh for %s", project_id)


@router.post("/{project_id}/repo/index", response_model=ProjectOut)
async def index_repo(
    project_id: uuid.UUID,
    background: BackgroundTasks,
    user: CurrentUser = Depends(rate_limit),
) -> ProjectOut:
    service = _service(user)
    try:
        project = await service.get(user.id, str(project_id))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Proyek tidak ditemukan."
        ) from exc
    if not (project.repo_url or "").strip():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Proyek belum punya URL repo GitHub.",
        )
    updated = await service.update(
        user.id,
        str(project_id),
        {
            "repo_index_status": "pending",
            "repo_index_error": None,
            "repo_index_progress": 0,
            "repo_index_stage": "menunggu",
        },
    )
    background.add_task(_run_index, str(project_id), user.id, project.repo_url or "")
    return updated


@router.post("/{project_id}/repo/ask", response_model=RepoAskOut)
async def ask_repo(
    project_id: uuid.UUID,
    payload: RepoAskRequest,
    user: CurrentUser = Depends(rate_limit),
) -> RepoAskOut:
    service = _service(user)
    try:
        await service.get(user.id, str(project_id))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Proyek tidak ditemukan."
        ) from exc
    indexer = build_code_indexer(user.client)
    question = payload.question.strip()
    persona = await load_feature_persona(user.client, "projects:ask", user_id=user.id)
    try:
        result = await indexer.answer(str(project_id), question, persona)
    except LLMProviderError as exc:
        detail = _llm_error_detail(exc)
        await _save_ask(
            service, str(project_id), user.id, question=question, error=detail
        )
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail
        ) from exc
    saved = await _save_ask(
        service,
        str(project_id),
        user.id,
        question=question,
        answer=result.answer,
        sources=[source.model_dump() for source in result.sources],
    )
    return RepoAskOut(
        answer=result.answer,
        sources=result.sources,
        ask_id=saved.id if saved else None,
    )


@router.post("/{project_id}/repo/ask/stream")
async def ask_repo_stream(
    project_id: uuid.UUID,
    payload: RepoAskRequest,
    user: CurrentUser = Depends(rate_limit),
):
    """Stream a "Tanya proyek" answer as SSE.

    Events: ``token`` ({t}), ``sources`` ({sources}), ``done`` ({ask_id}),
    ``error`` ({detail}). The turn is persisted once the stream finishes.
    """
    service = _service(user)
    try:
        await service.get(user.id, str(project_id))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Proyek tidak ditemukan."
        ) from exc

    indexer = build_code_indexer(user.client)
    question = payload.question.strip()
    persona = await load_feature_persona(user.client, "projects:ask", user_id=user.id)

    async def generator() -> AsyncGenerator[str, None]:
        parts: list[str] = []
        sources: list[Any] = []
        try:
            async for kind, value in indexer.answer_stream(
                str(project_id), question, persona
            ):
                if kind == "token":
                    parts.append(value)
                    yield _format_sse("token", json.dumps({"t": value}))
                elif kind == "sources":
                    sources = [
                        source.model_dump() if hasattr(source, "model_dump") else source
                        for source in value
                    ]
        except LLMProviderError as exc:
            detail = _llm_error_detail(exc)
            await _save_ask(
                service, str(project_id), user.id, question=question, error=detail
            )
            yield _format_sse("error", json.dumps({"detail": detail}))
            return
        answer = "".join(parts).strip()
        saved = await _save_ask(
            service,
            str(project_id),
            user.id,
            question=question,
            answer=answer,
            sources=sources,
        )
        yield _format_sse("sources", json.dumps({"sources": sources}))
        yield _format_sse(
            "done",
            json.dumps({"ask_id": saved.id if saved else None, "answer": answer}),
        )

    return StreamingResponse(
        generator(), media_type="text/event-stream", headers=_SSE_HEADERS
    )


async def _save_ask(
    service: ProjectService,
    project_id: str,
    user_id: str,
    *,
    question: str,
    answer: str = "",
    sources: list[dict[str, Any]] | None = None,
    error: str | None = None,
) -> ProjectAskOut | None:
    """Persist a Q&A turn for the right sidebar; never break the answer."""
    try:
        return await service.add_ask(
            project_id,
            user_id,
            question=question,
            answer=answer,
            sources=sources,
            error=error,
        )
    except Exception:  # noqa: BLE001 - history is best-effort
        logger.warning("Failed to save project ask for %s", project_id)
        return None


def _llm_error_detail(exc: LLMProviderError) -> str:
    """Turn provider errors into short, actionable Indonesian messages."""
    raw = str(exc)
    lowered = raw.lower()
    if "429" in raw or "rate_limit" in lowered or "tokens per minute" in lowered:
        return (
            "Batas token per menit tercapai. Tunggu beberapa detik lalu coba lagi."
        )
    if "401" in raw or "invalid_api_key" in lowered or "unauthorized" in lowered:
        return "API key LLM tidak valid. Periksa GROQ_API_KEY di .env."
    if "413" in raw or "too large" in lowered:
        return "Pertanyaan terlalu besar untuk model. Coba pertanyaan yang lebih singkat."
    return raw


@router.get("/{project_id}/asks", response_model=list[ProjectAskOut])
async def list_project_asks(
    project_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=200),
    user: CurrentUser = Depends(read_rate_limit),
) -> list[ProjectAskOut]:
    service = _service(user)
    try:
        await service.get(user.id, str(project_id))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Proyek tidak ditemukan."
        ) from exc
    return await service.list_asks(str(project_id), limit=limit)


@router.delete(
    "/{project_id}/asks/{ask_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
async def delete_project_ask(
    project_id: uuid.UUID,
    ask_id: uuid.UUID,
    user: CurrentUser = Depends(rate_limit),
) -> None:
    await _service(user).delete_ask(str(project_id), str(ask_id))


@router.delete(
    "/{project_id}/asks",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
async def clear_project_asks(
    project_id: uuid.UUID, user: CurrentUser = Depends(rate_limit)
) -> None:
    await _service(user).clear_asks(str(project_id))


@router.post("/{project_id}/health", response_model=ProjectOut)
async def analyze_project_health(
    project_id: uuid.UUID, user: CurrentUser = Depends(rate_limit)
) -> ProjectOut:
    service = _service(user)
    try:
        project = await service.get(user.id, str(project_id))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Proyek tidak ditemukan."
        ) from exc
    try:
        analyzer = build_project_analyzer()
    except LLMProviderError as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LLM belum dikonfigurasi. Setel GROQ_API_KEY.",
        ) from exc
    tasks = await service.list_tasks(str(project_id))
    persona = await load_feature_persona(user.client, "projects:health", user_id=user.id)
    try:
        summary = await analyzer.analyze(
            project, tasks, await service.list_documents(str(project_id)), persona
        )
    except LLMProviderError as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, detail=_llm_error_detail(exc)
        ) from exc
    cancel_health_refresh(str(project_id))
    generated_at = datetime.now(timezone.utc).isoformat()
    # Keep a short history of analyses so the UI can show past snapshots.
    history = [
        item for item in (project.health_history or []) if isinstance(item, dict)
    ]
    history.append({"summary": summary, "generated_at": generated_at})
    history = history[-10:]
    return await service.update(
        user.id,
        str(project_id),
        {
            "health_summary": summary,
            "health_generated_at": generated_at,
            "health_stale": False,
            "health_history": history,
        },
    )


# ---------------------------------------------------------------------------
# Tasks (per-project todos)
# ---------------------------------------------------------------------------
@router.get("/{project_id}/tasks", response_model=list[ProjectTaskOut])
async def list_project_tasks(
    project_id: uuid.UUID, user: CurrentUser = Depends(read_rate_limit)
) -> list[ProjectTaskOut]:
    service = _service(user)
    try:
        await service.get(user.id, str(project_id))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Proyek tidak ditemukan."
        ) from exc
    return await service.list_tasks(str(project_id))


@router.post(
    "/{project_id}/tasks",
    response_model=ProjectTaskOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_project_task(
    project_id: uuid.UUID,
    payload: ProjectTaskCreate,
    user: CurrentUser = Depends(rate_limit),
) -> ProjectTaskOut:
    service = _service(user)
    try:
        await service.get(user.id, str(project_id))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Proyek tidak ditemukan."
        ) from exc
    task = await service.create_task(
        str(project_id),
        user.id,
        title=payload.title,
        detail=payload.detail,
        status_=payload.status,
        priority=payload.priority,
    )
    await _refresh_health(user, str(project_id))
    return task


@router.patch(
    "/{project_id}/tasks/{task_id}", response_model=ProjectTaskOut
)
async def update_project_task(
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    payload: ProjectTaskUpdate,
    user: CurrentUser = Depends(rate_limit),
) -> ProjectTaskOut:
    patch = payload.model_dump(exclude_unset=True)
    try:
        task = await _service(user).update_task(str(project_id), str(task_id), patch)
    except KeyError as exc:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Tugas tidak ditemukan."
        ) from exc
    await _refresh_health(user, str(project_id))
    return task


@router.delete(
    "/{project_id}/tasks/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
async def delete_project_task(
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    user: CurrentUser = Depends(rate_limit),
) -> None:
    await _service(user).delete_task(str(project_id), str(task_id))
    await _refresh_health(user, str(project_id))


@router.post("/{project_id}/tasks/reorder", response_model=list[ProjectTaskOut])
async def reorder_project_tasks(
    project_id: uuid.UUID,
    payload: ProjectTaskReorder,
    user: CurrentUser = Depends(rate_limit),
) -> list[ProjectTaskOut]:
    service = _service(user)
    try:
        await service.get(user.id, str(project_id))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Proyek tidak ditemukan."
        ) from exc
    tasks = await service.reorder_tasks(
        str(project_id), [item.model_dump() for item in payload.items]
    )
    await _refresh_health(user, str(project_id))
    return tasks


@router.delete("/{project_id}/repo", response_model=ProjectOut)
async def clear_repo(
    project_id: uuid.UUID, user: CurrentUser = Depends(rate_limit)
) -> ProjectOut:
    service = _service(user)
    try:
        await service.get(user.id, str(project_id))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Proyek tidak ditemukan."
        ) from exc
    await _clear_chunks(user, str(project_id))
    updated = await service.update(
        user.id,
        str(project_id),
        {
            "repo_index_status": "none",
            "repo_summary": None,
            "repo_index_error": None,
            "repo_file_count": 0,
            "repo_chunk_count": 0,
            "repo_index_progress": 0,
            "repo_index_stage": None,
            "repo_indexed_at": None,
        },
    )
    await _refresh_health(user, str(project_id))
    return updated


@router.get(
    "/{project_id}/conversations", response_model=list[ProjectConversationOut]
)
async def list_project_conversations(
    project_id: uuid.UUID, user: CurrentUser = Depends(read_rate_limit)
) -> list[ProjectConversationOut]:
    service = _service(user)
    try:
        await service.get(user.id, str(project_id))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Proyek tidak ditemukan."
        ) from exc
    return await service.list_conversations(str(project_id))


# ---------------------------------------------------------------------------
# Project documents & links (non-repo project data)
# ---------------------------------------------------------------------------
@router.get("/{project_id}/documents", response_model=list[ProjectDocumentOut])
async def list_project_documents(
    project_id: uuid.UUID, user: CurrentUser = Depends(read_rate_limit)
) -> list[ProjectDocumentOut]:
    service = _service(user)
    try:
        await service.get(user.id, str(project_id))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Proyek tidak ditemukan."
        ) from exc
    return await service.list_documents(str(project_id))


@router.post(
    "/{project_id}/documents",
    response_model=ProjectDocumentOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_project_document(
    project_id: uuid.UUID,
    payload: ProjectDocumentCreate,
    user: CurrentUser = Depends(rate_limit),
) -> ProjectDocumentOut:
    service = _service(user)
    try:
        await service.get(user.id, str(project_id))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Proyek tidak ditemukan."
        ) from exc
    document = await service.create_document(
        str(project_id),
        user.id,
        title=payload.title,
        kind=payload.kind,
        url=payload.url,
        content=payload.content,
    )
    await _refresh_health(user, str(project_id))
    return document


@router.patch(
    "/{project_id}/documents/{document_id}", response_model=ProjectDocumentOut
)
async def update_project_document(
    project_id: uuid.UUID,
    document_id: uuid.UUID,
    payload: ProjectDocumentUpdate,
    user: CurrentUser = Depends(rate_limit),
) -> ProjectDocumentOut:
    patch = payload.model_dump(exclude_unset=True)
    try:
        document = await _service(user).update_document(
            str(project_id), str(document_id), patch
        )
    except KeyError as exc:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Dokumen tidak ditemukan."
        ) from exc
    await _refresh_health(user, str(project_id))
    return document


@router.delete(
    "/{project_id}/documents/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
async def delete_project_document(
    project_id: uuid.UUID,
    document_id: uuid.UUID,
    user: CurrentUser = Depends(rate_limit),
) -> None:
    await _service(user).delete_document(str(project_id), str(document_id))
    await _refresh_health(user, str(project_id))


@router.get("/{project_id}/files", response_model=list[RepoFileOut])
async def list_repo_files(
    project_id: uuid.UUID, user: CurrentUser = Depends(read_rate_limit)
) -> list[RepoFileOut]:
    service = _service(user)
    try:
        await service.get(user.id, str(project_id))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Proyek tidak ditemukan."
        ) from exc
    return await service.list_repo_files(str(project_id))


@router.get("/{project_id}/files/content", response_model=RepoFileContentOut)
async def get_repo_file(
    project_id: uuid.UUID,
    path: str = Query(min_length=1, max_length=500),
    user: CurrentUser = Depends(read_rate_limit),
) -> RepoFileContentOut:
    service = _service(user)
    try:
        await service.get(user.id, str(project_id))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Proyek tidak ditemukan."
        ) from exc
    return await service.get_repo_file(str(project_id), path)
