"""Embedding provider abstraction.

Providers:
* ``none``        — no embedding; retrieval falls back to keyword search.
* ``huggingface`` — Hugging Face Inference API (free tier) feature-extraction.

The vector dimension is fixed by ``EMBEDDING_DIM`` (default 384), matching the
``memory_embeddings.embedding`` column and the ``match_memories_semantic`` RPC.
"""

from __future__ import annotations

from typing import Protocol

import httpx

from app.config import Settings


class EmbeddingProvider(Protocol):
    name: str
    dim: int
    available: bool

    async def embed(self, texts: list[str]) -> list[list[float]]: ...


class NullEmbeddingProvider:
    """Used when no embedding backend is configured."""

    name = "none"
    dim = 0
    available = False

    async def embed(self, texts: list[str]) -> list[list[float]]:  # noqa: ARG002
        raise RuntimeError("No embedding provider configured.")


class HuggingFaceEmbeddingProvider:
    name = "huggingface"
    available = True

    def __init__(self, api_key: str, model: str, dim: int) -> None:
        self._api_key = api_key
        self._model = model
        self.dim = dim
        # Hugging Face Inference Providers endpoint (the old api-inference
        # "pipeline/feature-extraction" path is deprecated).
        self._url = f"https://router.huggingface.co/hf-inference/models/{model}"

    async def embed(self, texts: list[str]) -> list[list[float]]:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                self._url,
                headers={"Authorization": f"Bearer {self._api_key}"},
                json={"inputs": texts, "options": {"wait_for_model": True}},
            )
            response.raise_for_status()
            data = response.json()
        return [self._reduce(vector) for vector in data]

    def _reduce(self, vector: list[float] | list[list[float]]) -> list[float]:
        # Some models return token-level embeddings; mean-pool to a single vector.
        if vector and isinstance(vector[0], list):
            rows = vector  # type: ignore[assignment]
            length = len(rows)
            pooled = [0.0] * len(rows[0])
            for row in rows:
                for index, value in enumerate(row):
                    pooled[index] += value
            return [value / length for value in pooled]
        return vector  # type: ignore[return-value]


def build_embedding_provider(settings: Settings) -> EmbeddingProvider:
    provider = settings.embedding_provider.lower()
    if provider == "huggingface" and settings.huggingface_api_key:
        return HuggingFaceEmbeddingProvider(
            api_key=settings.huggingface_api_key,
            model=settings.embedding_model,
            dim=settings.embedding_dim,
        )
    return NullEmbeddingProvider()
