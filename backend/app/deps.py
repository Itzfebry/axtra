"""FastAPI dependencies: session auth, owner-scoped Supabase client, rate limit."""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass
import secrets

from fastapi import Depends, HTTPException, Request, status
from supabase import AsyncClient

from app.config import Settings, get_settings
from app.security import COOKIE_NAME, verify_session_token
from app.supabase_client import get_owner_client


@dataclass
class CurrentUser:
    id: str
    email: str | None
    token: str
    client: AsyncClient


async def get_current_user(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    """Return the fixed owner context for a valid cookie *or* API token.

    The header path is what makes Axtra drivable headlessly: cron ticks, the
    Telegram bridge, and Hermes send ``X-API-Key`` instead of logging in.
    """
    token = request.cookies.get(COOKIE_NAME, "")
    if not verify_session_token(token, settings.session_secret):
        token = _api_token(request, settings)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesi tidak valid. Silakan login ulang.",
        )
    client = await get_owner_client()
    return CurrentUser(id=settings.owner_user_id, email=None, token=token, client=client)


def _api_token(request: Request, settings: Settings) -> str:
    """The configured automation token, or "" when absent/wrong."""
    provided = request.headers.get("x-api-key", "").strip()
    if not provided:
        authorization = request.headers.get("authorization", "")
        if authorization.lower().startswith("bearer "):
            provided = authorization[7:].strip()
    if provided and settings.api_token and secrets.compare_digest(provided, settings.api_token):
        return provided
    return ""


# ---------------------------------------------------------------------------
# Naive in-process rate limiter (per user id). Phase 1 guardrail only; swap for
# a shared store (Redis/Postgres) before running multiple workers.
# ---------------------------------------------------------------------------
_buckets: dict[str, deque[float]] = {}
_read_buckets: dict[str, deque[float]] = {}


def _consume(buckets: dict[str, deque[float]], key: str, limit: int) -> bool:
    now = time.monotonic()
    window = buckets.setdefault(key, deque())
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= max(limit, 1):
        return False
    window.append(now)
    return True


async def rate_limit(
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    """Write/LLM guardrail: 30 requests/minute by default."""
    if not _consume(_buckets, user.id, settings.rate_limit_per_minute):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Terlalu banyak permintaan. Coba lagi sebentar lagi.",
        )
    return user


async def read_rate_limit(
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    """Cheap read guardrail for sidebar/history browsing.

    Reads get their own, much larger budget so navigating conversations never
    consumes the chat quota (and vice versa).
    """
    if not _consume(_read_buckets, user.id, settings.read_rate_limit_per_minute):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Terlalu banyak permintaan. Coba lagi sebentar lagi.",
        )
    return user
