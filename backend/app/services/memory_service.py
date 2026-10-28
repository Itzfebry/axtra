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


def _parse_vector(raw: Any) -> list[float]:
    """Parse a pgvector value (str like "[..]" or list) into floats."""
    if raw is None:
        return []
    if isinstance(raw, str):
        text = raw.strip()
        if text.startswith("[") and text.endswith("]"):
            text = text[1:-1]
        parts = [part for part in text.replace(" ", "").split(",") if part]
        try:
            return [float(part) for part in parts]
        except ValueError:
            return []
    if isinstance(raw, (list, tuple)):
        try:
            return [float(value) for value in raw]
        except (TypeError, ValueError):
            return []
    return []


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def cluster_by_similarity(
    vectors: dict[str, list[float]],
    threshold: float,
    min_size: int = 2,
) -> list[list[str]]:
    """Greedy single-link clustering of ids by cosine similarity."""
    ids = list(vectors)
    parent: dict[str, str] = {memory_id: memory_id for memory_id in ids}

    def find(item: str) -> str:
        while parent[item] != item:
            parent[item] = parent[parent[item]]
            item = parent[item]
        return item

    def union(left: str, right: str) -> None:
        root_left, root_right = find(left), find(right)
        if root_left != root_right:
            parent[root_right] = root_left

    for index, left in enumerate(ids):
        for right in ids[index + 1 :]:
            if _cosine(vectors[left], vectors[right]) >= threshold:
                union(left, right)

    groups: dict[str, list[str]] = {}
    for memory_id in ids:
        groups.setdefault(find(memory_id), []).append(memory_id)
    return [group for group in groups.values() if len(group) >= min_size]


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

    @property
    def embeddings_available(self) -> bool:
        return self._embeddings.available

    async def fetch_embeddings(self, user_id: str) -> dict[str, list[float]]:
        """Return ``{memory_id: vector}`` for the user's stored embeddings."""
        response = (
            await self._client.table("memory_embeddings")
            .select("memory_id, embedding")
            .eq("user_id", user_id)
            .execute()
        )
        vectors: dict[str, list[float]] = {}
        for row in response.data or []:
            vector = _parse_vector(row.get("embedding"))
            if vector:
                vectors[row["memory_id"]] = vector
        return vectors

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
