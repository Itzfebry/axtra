"""Vibe Coding template catalog.

Project-independent: a template only seeds which document kinds are relevant
and the file conventions to pass to an external coding agent. It never
generates code. Kept separate from the project-scoped ``vibe`` router so the
picker can load before a session exists.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.deps import CurrentUser, read_rate_limit
from app.schemas import VibeTemplateCatalogOut, VibeTemplateOut
from app.vibe_templates import ARTIFACT_KINDS, FEATURE_SCOPES, list_templates

router = APIRouter(prefix="/api/vibe", tags=["vibe"])


@router.get("/templates", response_model=VibeTemplateCatalogOut)
async def get_templates(
    user: CurrentUser = Depends(read_rate_limit),
) -> VibeTemplateCatalogOut:
    return VibeTemplateCatalogOut(
        templates=[VibeTemplateOut(**template) for template in list_templates()],
        scopes=list(FEATURE_SCOPES),
        artifact_kinds=list(ARTIFACT_KINDS),
    )
