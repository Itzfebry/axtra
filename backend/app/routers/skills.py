"""AI skill management endpoints.

Skills are owner-scoped rows in ``public.skills``; assignment to AI features
lives in ``public.feature_skills`` and is edited through the feature-settings
router. These endpoints never execute skill content.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.deps import CurrentUser, rate_limit, read_rate_limit
from app.schemas import (
    SkillCreate,
    SkillOut,
    SkillParseOut,
    SkillParseRequest,
    SkillSummary,
    SkillUpdate,
)
from app.services.skill_parser import SkillParseError, parse_skill_md, slugify
from app.services.skill_service import (
    SkillConflict,
    SkillNotFound,
    SkillValidationError,
    create_skill,
    delete_skill,
    get_skill,
    list_skills,
    update_skill,
)

router = APIRouter(prefix="/api/skills", tags=["skills"])

_VALID_STATUS = {"draft", "active", "disabled"}


@router.get("", response_model=list[SkillSummary])
async def list_all_skills(
    search: str = Query(default="", max_length=120),
    category: str = Query(default="", max_length=60),
    skill_status: str = Query(default="", alias="status", max_length=20),
    user: CurrentUser = Depends(read_rate_limit),
) -> list[SkillSummary]:
    if skill_status and skill_status not in _VALID_STATUS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Status tidak dikenal.")
    rows = await list_skills(
        user.client,
        user.id,
        search=search,
        category=category,
        status=skill_status,
    )
    return [SkillSummary(**row) for row in rows]


@router.post("", response_model=SkillOut, status_code=status.HTTP_201_CREATED)
async def create_new_skill(
    payload: SkillCreate,
    user: CurrentUser = Depends(rate_limit),
) -> SkillOut:
    try:
        row = await create_skill(user.client, user.id, payload.model_dump())
    except SkillConflict as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return SkillOut(**row)


@router.post("/parse", response_model=SkillParseOut)
async def parse_skill_document(
    payload: SkillParseRequest,
    user: CurrentUser = Depends(read_rate_limit),
) -> SkillParseOut:
    """Parse a pasted SKILL.md (frontmatter + Markdown) without saving."""
    try:
        parsed = parse_skill_md(payload.raw, fallback_name=payload.fallback_name)
    except SkillParseError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    return SkillParseOut(
        name=parsed.name,
        slug=slugify(parsed.name),
        description=parsed.description,
        license=parsed.license,
        metadata=parsed.metadata,
        content=parsed.content,
    )


@router.get("/{skill_id}", response_model=SkillOut)
async def get_one_skill(
    skill_id: str,
    user: CurrentUser = Depends(read_rate_limit),
) -> SkillOut:
    try:
        row = await get_skill(user.client, user.id, skill_id)
    except SkillNotFound as exc:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Skill tidak ditemukan."
        ) from exc
    return SkillOut(**row)


@router.patch("/{skill_id}", response_model=SkillOut)
async def update_one_skill(
    skill_id: str,
    payload: SkillUpdate,
    user: CurrentUser = Depends(rate_limit),
) -> SkillOut:
    patch = payload.model_dump(exclude_unset=True)
    try:
        row = await update_skill(user.client, user.id, skill_id, patch)
    except SkillNotFound as exc:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Skill tidak ditemukan."
        ) from exc
    except SkillValidationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except SkillConflict as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return SkillOut(**row)


@router.delete("/{skill_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_one_skill(
    skill_id: str,
    user: CurrentUser = Depends(rate_limit),
) -> None:
    try:
        await delete_skill(user.client, user.id, skill_id)
    except SkillNotFound as exc:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Skill tidak ditemukan."
        ) from exc