"""Memory service: storage, retrieval, embedding, and conflict handling.

All queries go through the caller's RLS-scoped Supabase client, so a user can
never read or modify another user's memories.
"""

from __future__ import annotations

from typing import Any

from supabase import AsyncClient

from app.embeddings import EmbeddingProvider
from app.schemas import MemoryOut, MemorySearchOut

TABLE = "memories"


def _row_to_memory(row: dict[str, Any]) -> MemoryOut:
    return MemoryOut(
        id=row["id"],
        type=row.get("type", "semantic"),
        content=row.get("content", ""),
        source=row.get("source", "manual"),
        source_ref=row.get("source_ref") or {},
        confidence=float(row.get("confidence") or 0.5),
        status=row.get("status", "active"),
        metadata=row.get("metadata") or {},
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


def _vector_literal(vector: list[float]) -> str:
    """Format a vector as a pgvector literal string."""
    return "[" + ",".join(f"{value:.6f}" for value in vector) + "]"


class MemoryService:
    def __init__(
        self,
        client: AsyncClient,
        embedding_provider: EmbeddingProvider,
        retrieval_count: int = 6,
        min_similarity: float = 0.25,
    ) -> None:
        self._client = client
        self._embeddings = embedding_provider
        self._retrieval_count = retrieval_count
        self._min_similarity = min_similarity

    # ------------------------------------------------------------------ CRUD
    async def create(
        self,
        user_id: str,
        *,
        type_: str,
        content: str,
        source: str = "manual",
        source_ref: dict[str, Any] | None = None,
        confidence: float = 0.9,
        metadata: dict[str, Any] | None = None,
    ) -> MemoryOut:
        payload = {
            "user_id": user_id,
            "type": type_,
            "content": content,
            "source": source,
            "source_ref": source_ref or {},
            "confidence": confidence,
            "metadata": metadata or {},
            "status": "active",
        }
        response = await self._client.table(TABLE).insert(payload).execute()
        row = response.data[0]

        if self._embeddings.available:
            try:
                await self._store_embedding(user_id, row["id"], content)
            except Exception:
                # Memory is still saved; embedding can be backfilled later.
                pass
        return _row_to_memory(row)

    async def update(self, user_id: str, memory_id: str, patch: dict[str, Any]) -> MemoryOut:
        response = (
            await self._client.table(TABLE)
            .update(patch)
            .eq("id", memory_id)
            .eq("user_id", user_id)
            .execute()
        )
        if not response.data:
            raise KeyError("memory_not_found")
        row = response.data[0]
        if self._embeddings.available and "content" in patch:
            try:
                await (
                    self._client.table("memory_embeddings")
                    .delete()
                    .eq("memory_id", memory_id)
                    .eq("user_id", user_id)
                    .execute()
                )
                await self._store_embedding(user_id, memory_id, patch["content"])
            except Exception:
                pass
        return _row_to_memory(row)

    async def archive(self, user_id: str, memory_id: str) -> None:
        """Soft delete; keeps the audit trail instead of hard-deleting rows."""
        await (
            self._client.table(TABLE)
            .update({"status": "archived"})
            .eq("id", memory_id)
            .eq("user_id", user_id)
            .execute()
        )

    async def delete(self, user_id: str, memory_id: str) -> None:
        await (
            self._client.table(TABLE)
            .delete()
            .eq("id", memory_id)
            .eq("user_id", user_id)
            .execute()
        )

    async def list_memories(
        self,
        user_id: str,
        *,
        type_: str | None = None,
        status_: str = "active",
        search: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[MemoryOut]:
        capped = min(limit, 200)
        query = self._client.table(TABLE).select("*").eq("user_id", user_id)
        if type_:
            query = query.eq("type", type_)
        if status_:
            query = query.eq("status", status_)
        query = query.order("created_at", desc=True).range(offset, offset + capped - 1)
        if search:
            # Match the GIN index (to_tsvector('simple', content)). text_search
            # returns a builder without order/range, so it must be applied last.
            query = query.text_search(
                "content", search, {"type": "web_search", "config": "simple"}
            )
        response = await query.execute()
        return [_row_to_memory(row) for row in response.data]

    async def get(self, user_id: str, memory_id: str) -> MemoryOut:
        response = (
            await self._client.table(TABLE)
            .select("*")
            .eq("id", memory_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        return _row_to_memory(response.data)

    async def count_active(self, user_id: str) -> int:
        response = (
            await self._client.table(TABLE)
            .select("id", count="exact")
            .eq("user_id", user_id)
            .eq("status", "active")
            .execute()
        )
        return int(response.count or 0)

    async def exists_active(self, user_id: str, content: str) -> bool:
        response = (
            await self._client.table(TABLE)
            .select("id")
            .eq("user_id", user_id)
            .eq("content", content)
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        return bool(response.data)

    # -------------------------------------------------------------- retrieval
    async def retrieve(
        self, user_id: str, query: str, limit: int | None = None
    ) -> list[MemorySearchOut]:
        """Semantic search when embeddings exist, keyword search otherwise."""
        limit = limit or self._retrieval_count
        if self._embeddings.available:
            try:
                vectors = await self._embeddings.embed([query])
                result = (
                    await self._client.rpc(
                        "match_memories_semantic",
                        {
                            "query_embedding": _vector_literal(vectors[0]),
                            "match_count": limit,
                            "min_similarity": self._min_similarity,
                        },
                    ).execute()
                )
                return [self._to_search_out(row) for row in result.data]
            except Exception:
                pass  # fall back to keyword search below

        result = (
            await self._client.rpc(
                "search_memories_keyword",
                {"query_text": query, "match_count": limit},
            ).execute()
        )
        return [self._to_search_out(row) for row in result.data]

    def _to_search_out(self, row: dict[str, Any]) -> MemorySearchOut:
        return MemorySearchOut(
            id=row["id"],
            type=row.get("type", "semantic"),
            content=row.get("content", ""),
            source=row.get("source", "manual"),
            source_ref=row.get("source_ref") or {},
            confidence=float(row.get("confidence") or 0.5),
            status=row.get("status", "active"),
            metadata=row.get("metadata") or {},
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
            score=float(row.get("similarity") or row.get("rank") or 0.0) or None,
        )

    # -------------------------------------------------------------- embedding
    async def _store_embedding(self, user_id: str, memory_id: str, content: str) -> None:
        vectors = await self._embeddings.embed([content])
        payload = {
            "memory_id": memory_id,
            "user_id": user_id,
            "embedding": _vector_literal(vectors[0]),
            "model": self._embeddings.name,
        }
        await (
            self._client.table("memory_embeddings")
            .upsert(payload, on_conflict="memory_id")
            .execute()
        )
