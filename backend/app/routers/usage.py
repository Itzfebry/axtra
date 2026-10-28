"""Token usage endpoint for the navbar/sidebar meters."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.config import Settings, get_settings
from app.deps import CurrentUser, read_rate_limit
from app.schemas import UsageOut
from app.services.usage_service import get_usage

router = APIRouter(prefix="/api/usage", tags=["usage"])


@router.get("", response_model=UsageOut)
async def read_usage(
    user: CurrentUser = Depends(read_rate_limit),
    settings: Settings = Depends(get_settings),
) -> UsageOut:
    """Rolling tokens-per-minute plus total tokens for the current WIB day."""
    window = await get_usage(user.client)
    return UsageOut(
        minute_tokens=window.minute_tokens,
        day_tokens=window.day_tokens,
        minute_limit=max(settings.model_tpm_limit, 0),
        day_limit=max(settings.model_daily_token_limit, 0),
        model=settings.default_chat_model,
        day_reset_at=window.day_reset_at,
    )
