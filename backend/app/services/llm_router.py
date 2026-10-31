"""Resolve the user's active provider/model into a ready LLM client.

The Settings → Provider tab stores ``profiles.preferences['llm']`` and an
encrypted per-user key. This module turns that into an
``OpenAICompatibleProvider`` + model name for chat and job features.

Fallback chain when the selected provider has no usable key:
1. selected provider's user or env key,
2. Groq env key (the original default),
3. clear error asking the user to configure a key.
"""

from __future__ import annotations

from typing import Any

from app.config import Settings
from app.llm import LLMProvider, LLMProviderError, OpenAICompatibleProvider
from app.provider_catalog import env_api_key, get_provider, provider_base_url
from app.services.provider_registry import (
    provider_ready,
    resolve_api_key,
    resolve_provider_spec,
)


async def load_llm_preference(client: Any, user_id: str) -> tuple[str, str]:
    """Return ``(provider_id, model)`` from profiles.preferences, or blanks."""
    response = (
        await client.table("profiles")
        .select("preferences")
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    row = (response.data if response else None) or {}
    preferences = row.get("preferences")
    if isinstance(preferences, dict):
        llm = preferences.get("llm")
        if isinstance(llm, dict):
            return (
                str(llm.get("provider") or "").strip(),
                str(llm.get("model") or "").strip(),
            )
    return "", ""


async def resolve_active_llm(
    settings: Settings, client: Any, user_id: str
) -> tuple[LLMProvider, str]:
    """Build the LLM client for the user's current selection."""
    provider_id, model = await load_llm_preference(client, user_id)
    provider_id = provider_id or settings.llm_provider or "groq"
    model = model or settings.llm_model or ""

    spec = await resolve_provider_spec(settings, client, user_id, provider_id)
    if spec is None:
        spec = get_provider("groq")
    if spec is None:  # pragma: no cover - catalog always defines Groq
        raise LLMProviderError("Tidak ada provider LLM yang tersedia.")

    api_key, source = await resolve_api_key(settings, client, user_id, spec)
    if source == "none":
        # Fall back to Groq env when the chosen provider has no key yet.
        groq = get_provider("groq")
        groq_key = env_api_key(settings, groq) if groq else ""
        if groq and groq_key:
            spec = groq
            api_key = groq_key
            model = settings.default_chat_model
        else:
            raise LLMProviderError(
                f"API key {spec.label} belum diatur. Buka Pengaturan → Provider."
            )

    if not model:
        if spec.id == "groq":
            model = settings.default_chat_model
        else:
            raise LLMProviderError(
                f"Model {spec.label} belum dipilih. Pilih model di Pengaturan → Provider."
            )

    not_ready = provider_ready(settings, spec)
    if not_ready:
        raise LLMProviderError(not_ready)

    provider = OpenAICompatibleProvider(
        api_key=api_key,
        base_url=provider_base_url(settings, spec),
        name=spec.id,
    )
    return provider, model