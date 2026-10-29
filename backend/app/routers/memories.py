"""Memory management endpoints: inspect, create, correct, delete memories."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.config import get_settings
from app.deps import CurrentUser, rate_limit, read_rate_limit
from app.llm import LLMProviderError
from app.memory_service_provider import (
    build_llm_provider,
    build_memory_curator,
    build_memory_service,
)
from app.schemas import (
    MemoryClusterOut,
    MemoryCreate,
    MemoryMergeRequest,
    MemoryOut,
    MemorySearchOut,
    MemoryUpdate,
)
from app.services.memory_service import cluster_by_similarity
from app.services.usage_service import record_usage

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
    # The orchestrator saves facts opportunistically; never create a duplicate of
    # an existing active memory with the same content.
    if payload.source == "orchestrator":
        existing = await memory_service.find_active_by_content(user.id, payload.content)
        if existing is not None:
            return existing
    return await memory_service.create(
        user.id,
        type_=payload.type,
        content=payload.content,
        source=payload.source,
        confidence=payload.confidence,
        metadata=payload.metadata,
    )


@router.get("/clusters", response_model=list[MemoryClusterOut])
async def list_memory_clusters(
    user: CurrentUser = Depends(read_rate_limit),
) -> list[MemoryClusterOut]:
    """Suggest groups of same-topic active memories for merging."""
    memory_service = build_memory_service(user.client)
    memories = await memory_service.list_memories(user.id, limit=200)
    if len(memories) < 2:
        return []

    by_id = {memory.id: memory for memory in memories}
    groups: list[list[str]] = []

    clustered_with_embeddings = False
    if memory_service.embeddings_available:
        try:
            vectors = await memory_service.fetch_embeddings(user.id)
            vectors = {key: value for key, value in vectors.items() if key in by_id}
            groups = cluster_by_similarity(
                vectors, get_settings().memory_cluster_similarity
            )
            clustered_with_embeddings = True
        except Exception:  # noqa: BLE001 - embeddings table may be unavailable
            clustered_with_embeddings = False

    if not clustered_with_embeddings:
        try:
            curator = build_memory_curator(build_llm_provider())
        except LLMProviderError:
            return []
        groups = await curator.group_by_topic(memories)

    clusters: list[MemoryClusterOut] = []
    for index, group in enumerate(groups):
        members = [by_id[memory_id] for memory_id in group if memory_id in by_id]
        if len(members) < 2:
            continue
        clusters.append(MemoryClusterOut(key=f"cluster-{index}", memories=members))
    return clusters


@router.post("/merge", response_model=MemoryOut, status_code=status.HTTP_201_CREATED)
async def merge_memories(
    payload: MemoryMergeRequest, user: CurrentUser = Depends(rate_limit)
) -> MemoryOut:
    """Summarize selected memories into one, then hard-delete the originals."""
    memory_service = build_memory_service(user.client)
    memories: list[MemoryOut] = []
    for memory_id in payload.ids:
        try:
            memories.append(await memory_service.get(user.id, memory_id))
        except Exception as exc:  # noqa: BLE001 - invalid id or not owned
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, detail="Memori tidak ditemukan."
            ) from exc
    if len(memories) < 2:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Butuh minimal dua memori untuk dirangkum.",
        )

    try:
        curator = build_memory_curator(build_llm_provider())
    except LLMProviderError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    content, inferred_type, usage, model = await curator.summarize(memories)
    if not content:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, detail="Gagal merangkum memori. Coba lagi."
        )

    merged = await memory_service.create(
        user.id,
        type_=payload.type or inferred_type or "semantic",
        content=content,
        source="merge",
        confidence=max((memory.confidence for memory in memories), default=0.9),
        metadata={"merged_from": [memory.id for memory in memories]},
    )
    await record_usage(user.client, user.id, model, usage, source="memory_merge")
    for memory in memories:
        await memory_service.delete(user.id, memory.id)
    return merged


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
