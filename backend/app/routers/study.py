"""Belajar — study topics with the full learn loop."""

from __future__ import annotations

import uuid

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)

from app.config import Settings, get_settings
from app.deps import CurrentUser, rate_limit, read_rate_limit
from app.llm import LLMProviderError
from app.schemas import (
    StudyGenerateRequest,
    StudyGradeOut,
    StudyGradeRequest,
    StudyReviewRequest,
    StudyTopicCreate,
    StudyTopicOut,
    StudyTopicUpdate,
)
from app.services.feature_persona import load_feature_persona
from app.services.file_text import extract_text, safe_filename
from app.services.llm_router import resolve_active_llm
from app.services.study_service import StudyService

router = APIRouter(prefix="/api/study", tags=["study"])


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail="Topik tidak ditemukan.")


def _llm_error(exc: LLMProviderError) -> HTTPException:
    return HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.get("", response_model=list[StudyTopicOut])
async def list_topics(
    user: CurrentUser = Depends(read_rate_limit),
    status_: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=200),
) -> list[StudyTopicOut]:
    return await StudyService(user.client).list_topics(
        user.id, status=status_, limit=limit
    )


@router.post("", response_model=StudyTopicOut, status_code=status.HTTP_201_CREATED)
async def create_topic(
    payload: StudyTopicCreate, user: CurrentUser = Depends(rate_limit)
) -> StudyTopicOut:
    return await StudyService(user.client).create(user.id, payload)


@router.get("/{topic_id}", response_model=StudyTopicOut)
async def get_topic(
    topic_id: uuid.UUID, user: CurrentUser = Depends(read_rate_limit)
) -> StudyTopicOut:
    topic = await StudyService(user.client).get(user.id, str(topic_id))
    if topic is None:
        raise _not_found()
    return topic


@router.patch("/{topic_id}", response_model=StudyTopicOut)
async def update_topic(
    topic_id: uuid.UUID,
    payload: StudyTopicUpdate,
    user: CurrentUser = Depends(rate_limit),
) -> StudyTopicOut:
    try:
        return await StudyService(user.client).update(user.id, str(topic_id), payload)
    except KeyError as exc:
        raise _not_found() from exc


@router.delete("/{topic_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_topic(
    topic_id: uuid.UUID, user: CurrentUser = Depends(rate_limit)
) -> None:
    await StudyService(user.client).delete(user.id, str(topic_id))


@router.post("/{topic_id}/import", response_model=StudyTopicOut)
async def import_material(
    topic_id: uuid.UUID,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(rate_limit),
    settings: Settings = Depends(get_settings),
) -> StudyTopicOut:
    """Import TXT/MD/PDF text as the topic's study source."""
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="File kosong.")
    if len(data) > settings.max_upload_bytes:
        limit_mb = settings.max_upload_bytes // (1024 * 1024)
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Ukuran file melebihi batas {limit_mb} MB.",
        )
    filename = safe_filename(file.filename)
    text = extract_text(filename, file.content_type or "text/plain", data)
    if not text.strip():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Tidak ada teks yang bisa dibaca dari file ini.",
        )
    try:
        return await StudyService(user.client).import_source(
            user.id, str(topic_id), filename, text
        )
    except KeyError as exc:
        raise _not_found() from exc


@router.post("/{topic_id}/generate", response_model=StudyTopicOut)
async def generate_material(
    topic_id: uuid.UUID,
    payload: StudyGenerateRequest,
    user: CurrentUser = Depends(rate_limit),
) -> StudyTopicOut:
    """Generate study material for one topic (non-destructive on failure)."""
    settings = get_settings()
    try:
        llm, model = await resolve_active_llm(settings, user.client, user.id)
        persona = await load_feature_persona(user.client, "study", user_id=user.id)
        return await StudyService(user.client).generate_material(
            user.id, str(topic_id), llm, model, focus=payload.focus, persona=persona
        )
    except KeyError as exc:
        raise _not_found() from exc
    except LLMProviderError as exc:
        raise _llm_error(exc) from exc


@router.post("/{topic_id}/quiz", response_model=StudyTopicOut)
async def generate_quiz(
    topic_id: uuid.UUID, user: CurrentUser = Depends(rate_limit)
) -> StudyTopicOut:
    settings = get_settings()
    try:
        llm, model = await resolve_active_llm(settings, user.client, user.id)
        persona = await load_feature_persona(user.client, "study", user_id=user.id)
        return await StudyService(user.client).generate_quiz(
            user.id, str(topic_id), llm, model, persona=persona
        )
    except KeyError as exc:
        raise _not_found() from exc
    except LLMProviderError as exc:
        raise _llm_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/{topic_id}/quiz/grade", response_model=StudyGradeOut)
async def grade_quiz(
    topic_id: uuid.UUID,
    payload: StudyGradeRequest,
    user: CurrentUser = Depends(rate_limit),
) -> StudyGradeOut:
    try:
        return await StudyService(user.client).grade_quiz(
            user.id, str(topic_id), payload.answers
        )
    except KeyError as exc:
        raise _not_found() from exc


@router.post("/{topic_id}/plan", response_model=StudyTopicOut)
async def generate_plan(
    topic_id: uuid.UUID, user: CurrentUser = Depends(rate_limit)
) -> StudyTopicOut:
    settings = get_settings()
    try:
        llm, model = await resolve_active_llm(settings, user.client, user.id)
        persona = await load_feature_persona(user.client, "study", user_id=user.id)
        return await StudyService(user.client).generate_plan(
            user.id, str(topic_id), llm, model, persona=persona
        )
    except KeyError as exc:
        raise _not_found() from exc
    except LLMProviderError as exc:
        raise _llm_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/{topic_id}/review", response_model=StudyTopicOut)
async def schedule_review(
    topic_id: uuid.UUID,
    payload: StudyReviewRequest,
    user: CurrentUser = Depends(rate_limit),
) -> StudyTopicOut:
    try:
        return await StudyService(user.client).schedule_review(
            user.id, str(topic_id), payload
        )
    except KeyError as exc:
        raise _not_found() from exc


@router.post("/{topic_id}/goal", response_model=StudyTopicOut)
async def link_goal(
    topic_id: uuid.UUID, user: CurrentUser = Depends(rate_limit)
) -> StudyTopicOut:
    try:
        return await StudyService(user.client).link_goal(user.id, str(topic_id))
    except KeyError as exc:
        raise _not_found() from exc