"""Token usage endpoint for the navbar/sidebar meters."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.config import Settings, get_settings
from app.deps import CurrentUser, read_rate_limit
from app.schemas import UsageModelUsage, UsageOut
from app.services.llm_router import load_llm_preference
from app.services.usage_service import get_usage

router = APIRouter(prefix="/api/usage", tags=["usage"])


@router.get("", response_model=UsageOut)
async def read_usage(
    user: CurrentUser = Depends(read_rate_limit),
    settings: Settings = Depends(get_settings),
) -> UsageOut:
    """Rolling tokens-per-minute plus total tokens for the current WIB day."""
    window = await get_usage(user.client)
    provider, model = await load_llm_preference(user.client, user.id)
    provider = provider or settings.llm_provider or "groq"
    model = model or settings.default_chat_model
    by_model = sorted(
        (window.by_model or {}).items(), key=lambda item: item[1], reverse=True
    )
    return UsageOut(
        minute_tokens=window.minute_tokens,
        day_tokens=window.day_tokens,
        minute_limit=max(settings.model_tpm_limit, 0),
        day_limit=max(settings.model_daily_token_limit, 0),
        model=model,
        provider=provider,
        by_model=[
            UsageModelUsage(model=name, tokens=tokens) for name, tokens in by_model
        ],
        day_reset_at=window.day_reset_at,
    )
