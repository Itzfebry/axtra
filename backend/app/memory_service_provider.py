"""Factories for wiring services to a per-request Supabase client."""

from __future__ import annotations

from functools import lru_cache

from supabase import AsyncClient

from app.config import get_settings
from app.embeddings import build_embedding_provider
from app.services.memory_extraction import MemoryExtractor
from app.services.memory_service import MemoryService
from app.llm import LLMProvider, LLMProviderError


@lru_cache
def _settings():
    return get_settings()


def build_memory_service(client: AsyncClient) -> MemoryService:
    settings = _settings()
    embeddings = build_embedding_provider(settings)
    return MemoryService(
        client=client,
        embedding_provider=embeddings,
        retrieval_count=settings.memory_retrieval_count,
        min_similarity=settings.memory_min_similarity,
    )


def build_llm_provider() -> LLMProvider:
    settings = _settings()
    if not settings.groq_api_key:
        raise LLMProviderError("GROQ_API_KEY is not configured.")
    from app.services.chat_service import build_groq_provider

    return build_groq_provider(settings)


def build_memory_extractor(llm: LLMProvider) -> MemoryExtractor:
    return MemoryExtractor(llm=llm, default_model=_settings().default_chat_model)
