"""Chat endpoint streaming responses via Server-Sent Events."""

from __future__ import annotations

from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.config import get_settings
from app.deps import CurrentUser, rate_limit
from app.memory_service_provider import (
    build_llm_provider,
    build_memory_extractor,
    build_memory_service,
)
from app.schemas import ChatRequest
from app.services.chat_service import ChatService

router = APIRouter(prefix="/api/chat", tags=["chat"])

_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _format_sse(event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"


@router.post("")
async def chat(payload: ChatRequest, user: CurrentUser = Depends(rate_limit)):
    """Stream one chat turn as SSE events.

    Events: meta, token, warning, memory, done, error.
    """
    settings = get_settings()
    llm = build_llm_provider()
    service = ChatService(
        settings=settings,
        llm=llm,
        memory_service_factory=build_memory_service,
        extractor=build_memory_extractor(llm),
    )

    async def generator() -> AsyncGenerator[str, None]:
        async for event in service.stream_response(
            client=user.client,
            user_id=user.id,
            conversation_id=payload.conversation_id,
            user_message=payload.message,
            model=payload.model,
            use_memory=payload.use_memory,
            temperature=payload.temperature,
            mode=payload.mode,
            command=payload.command,
        ):
            yield _format_sse(event["event"], event["data"])

    return StreamingResponse(generator(), media_type="text/event-stream", headers=_SSE_HEADERS)
