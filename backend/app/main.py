"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Receive, Scope, Send

from app.config import get_settings
from app.memory_service_provider import build_llm_provider
from app.routers import (
    auth,
    chat,
    chat_settings,
    conversations,
    documents,
    feature_settings,
    health,
    images,
    jobs,
    memories,
    orchestrator,
    profile,
    projects,
    providers,
    recommendations,
    research,
    skills,
    usage,
    vibe,
)

logger = logging.getLogger("axtra")

# SSE must not be compressed or buffered; everything else benefits from gzip.
_NO_GZIP_PATHS = ("/api/chat", "/api/images/generate/stream")


class SelectiveGZipMiddleware:
    """GZip responses except on streaming (SSE) paths.

    ``GZipMiddleware`` buffers up to ``minimum_size`` bytes, which delays the
    small token frames of a chat stream. Requests under ``_NO_GZIP_PATHS`` are
    passed through untouched.
    """

    def __init__(
        self, app: ASGIApp, minimum_size: int = 1024, exclude_paths: tuple[str, ...] = ()
    ) -> None:
        self._app = app
        self._exclude_paths = exclude_paths
        self._gzip = GZipMiddleware(app, minimum_size=minimum_size)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["path"].startswith(self._exclude_paths):
            await self._app(scope, receive, send)
            return
        await self._gzip(scope, receive, send)



@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    if not settings.groq_api_key:
        logger.warning("GROQ_API_KEY is not set; chat endpoints will fail.")
    try:
        build_llm_provider()
    except Exception:  # noqa: BLE001 - startup must not crash on missing config
        logger.warning("LLM provider not ready; disabled until configured.")
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs" if not settings.is_production else None,
        redoc_url=None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.add_middleware(
        SelectiveGZipMiddleware,
        minimum_size=1024,
        exclude_paths=_NO_GZIP_PATHS,
    )

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(profile.router)
    app.include_router(chat.router)
    app.include_router(chat_settings.router)
    app.include_router(feature_settings.router)
    app.include_router(skills.router)
    app.include_router(conversations.router)
    app.include_router(documents.router)
    app.include_router(memories.router)
    app.include_router(projects.router)
    app.include_router(vibe.router)
    app.include_router(jobs.router)
    app.include_router(research.router)
    app.include_router(recommendations.router)
    app.include_router(orchestrator.router)
    app.include_router(usage.router)
    app.include_router(providers.router)
    app.include_router(images.router)

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        logger.exception("Unhandled error on %s %s", request.method, request.url)
        # Never leak stack traces or secrets to the client.
        return JSONResponse(
            status_code=500, content={"detail": "Terjadi kesalahan internal."}
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        # Preserve route-specific 404 details; only genuinely unknown routes
        # (Starlette's default "Not Found") use the generic fallback.
        detail = exc.detail
        if exc.status_code == 404 and detail in (None, "Not Found"):
            detail = "Endpoint tidak ditemukan."
        return JSONResponse(
            status_code=exc.status_code, content={"detail": detail or "Terjadi kesalahan."}
        )

    return app


app = create_app()
