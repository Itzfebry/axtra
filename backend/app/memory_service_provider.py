"""Factories for wiring services to a per-request Supabase client."""

from __future__ import annotations

from functools import lru_cache

from supabase import AsyncClient

from app.config import get_settings
from app.embeddings import build_embedding_provider
from app.services.memory_extraction import MemoryExtractor
from app.services.memory_curator import MemoryCurator
from app.services.memory_service import MemoryService
from app.services.code_indexer import CodeIndexer
from app.services.project_analyzer import ProjectAnalyzer
from app.services.vibe_service import VibeService
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


def build_memory_curator(llm: LLMProvider) -> MemoryCurator:
    return MemoryCurator(llm=llm, default_model=_settings().default_chat_model)


def build_code_indexer(client: AsyncClient) -> CodeIndexer:
    settings = _settings()
    embeddings = build_embedding_provider(settings)
    try:
        llm: LLMProvider | None = build_llm_provider()
    except LLMProviderError:
        llm = None
    return CodeIndexer(
        client=client,
        settings=settings,
        embedding_provider=embeddings,
        llm=llm,
    )


def build_project_analyzer() -> ProjectAnalyzer:
    """Raises LLMProviderError when no LLM key is configured."""
    settings = _settings()
    return ProjectAnalyzer(llm=build_llm_provider(), model=settings.default_chat_model)


def build_vibe_service(client: AsyncClient, persona: str = "") -> VibeService:
    """Vibe Coding workspace service using the configured LLM provider/model.

    Reads (sessions, documents, tasks, verification) must keep working when no
    LLM key is configured, so a missing provider is passed through as ``None``;
    only generation endpoints raise ``LLMProviderError``.
    """
    settings = _settings()
    try:
        llm: LLMProvider | None = build_llm_provider()
    except LLMProviderError:
        llm = None
    return VibeService(
        client=client,
        llm=llm,
        model=settings.default_chat_model,
        persona=persona,
    )
