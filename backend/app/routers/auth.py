"""Single-password authentication for the sole owner.

Endpoints: ``POST /api/auth/login``, ``POST /api/auth/logout``,
``GET /api/auth/status``. Login is rate limited per client IP.
"""

from __future__ import annotations

import time
from collections import deque

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from app.config import Settings, get_settings
from app.security import (
    COOKIE_NAME,
    check_password,
    create_session_token,
    verify_session_token,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

_LOGIN_WINDOW_SECONDS = 300
_LOGIN_MAX_ATTEMPTS = 10
_login_attempts: dict[str, deque[float]] = {}


class LoginRequest(BaseModel):
    password: str = Field(min_length=1)


class AuthStatus(BaseModel):
    authenticated: bool
    single_user: bool = True


def _login_rate_ok(request: Request) -> bool:
    client_ip = request.client.host if request.client else "unknown"
    now = time.monotonic()
    window = _login_attempts.setdefault(client_ip, deque())
    while window and now - window[0] > _LOGIN_WINDOW_SECONDS:
        window.popleft()
    if len(window) >= _LOGIN_MAX_ATTEMPTS:
        return False
    window.append(now)
    return True


@router.get("/status", response_model=AuthStatus)
async def auth_status(
    request: Request, settings: Settings = Depends(get_settings)
) -> AuthStatus:
    token = request.cookies.get(COOKIE_NAME, "")
    return AuthStatus(authenticated=verify_session_token(token, settings.session_secret))


@router.post("/login", response_model=AuthStatus)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
) -> AuthStatus:
    if not settings.app_password or not settings.session_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Autentikasi belum dikonfigurasi (APP_PASSWORD/SESSION_SECRET).",
        )
    if not _login_rate_ok(request):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Terlalu banyak percobaan login. Coba lagi nanti.",
        )
    if not check_password(payload.password, settings.app_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Kata sandi salah.",
        )

    max_age = settings.session_ttl_hours * 3600
    response.set_cookie(
        key=COOKIE_NAME,
        value=create_session_token(settings.session_secret, max_age),
        max_age=max_age,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        path="/",
    )
    return AuthStatus(authenticated=True)


@router.post("/logout", response_model=AuthStatus)
async def logout(response: Response) -> AuthStatus:
    response.delete_cookie(COOKIE_NAME, path="/")
    return AuthStatus(authenticated=False)
