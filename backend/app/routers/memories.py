"""Memory management endpoints: inspect, create, correct, delete memories."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.deps import CurrentUser, rate_limit, read_rate_limit
from app.memory_service_provider import build_memory_service
from app.schemas import MemoryCreate, MemoryOut, MemorySearchOut, MemoryUpdate

router = APIRouter(prefix="/api/memories", tags=["memories"])


@router.get("", response_model=list[MemoryOut])
async def list_memories(
    user: CurrentUser = Depends(read_rate_limit),
    type_: str | None = Query(default=None),
    search: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[MemoryOut]:
    memory_service = build_memory_service(user.client)
    return await memory_service.list_memories(
        user.id, type_=type_, search=search, limit=limit, offset=offset
    )


@router.get("/search", response_model=list[MemorySearchOut])
async def search_memories(
    user: CurrentUser = Depends(read_rate_limit),
    q: str = Query(min_length=1, max_length=1000),
    limit: int = Query(default=8, ge=1, le=50),
) -> list[MemorySearchOut]:
    memory_service = build_memory_service(user.client)
    return await memory_service.retrieve(user.id, q, limit=limit)


@router.post("", response_model=MemoryOut, status_code=status.HTTP_201_CREATED)
async def create_memory(
    payload: MemoryCreate, user: CurrentUser = Depends(rate_limit)
) -> MemoryOut:
    memory_service = build_memory_service(user.client)
    return await memory_service.create(
        user.id,
        type_=payload.type,
        content=payload.content,
        source=payload.source,
        confidence=payload.confidence,
        metadata=payload.metadata,
    )


@router.get("/{memory_id}", response_model=MemoryOut)
async def get_memory(memory_id: uuid.UUID, user: CurrentUser = Depends(read_rate_limit)) -> MemoryOut:
    memory_service = build_memory_service(user.client)
    try:
        return await memory_service.get(user.id, str(memory_id))
    except Exception as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Memori tidak ditemukan.") from exc


@router.patch("/{memory_id}", response_model=MemoryOut)
async def update_memory(
    memory_id: uuid.UUID,
    payload: MemoryUpdate,
    user: CurrentUser = Depends(rate_limit),
) -> MemoryOut:
    memory_service = build_memory_service(user.client)
    patch: dict[str, Any] = payload.model_dump(exclude_unset=True, exclude_none=True)
    try:
        return await memory_service.update(user.id, str(memory_id), patch)
    except KeyError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Memori tidak ditemukan.") from exc


@router.delete("/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_memory(memory_id: uuid.UUID, user: CurrentUser = Depends(rate_limit)) -> None:
    memory_service = build_memory_service(user.client)
    await memory_service.delete(user.id, str(memory_id))
