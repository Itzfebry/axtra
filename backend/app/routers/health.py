"""Health and diagnostics."""

from __future__ import annotations

from fastapi import APIRouter

from app.config import get_settings
from app.schemas import HealthOut

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("", response_model=HealthOut)
async def health() -> HealthOut:
    settings = get_settings()
    from app.embeddings import build_embedding_provider

    embedding = build_embedding_provider(settings)
    return HealthOut(
        status="ok",
        app=settings.app_name,
        environment=settings.app_env,
        llm_provider="groq" if settings.groq_api_key else "unconfigured",
        embedding_provider=embedding.name,
    )
