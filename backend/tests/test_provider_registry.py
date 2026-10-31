"""Tests for the provider catalog, key crypto, model normalization, picks."""

from __future__ import annotations

from app.config import Settings
from app.provider_catalog import get_provider, env_api_key
from app.services.provider_crypto import (
    decrypt_secret,
    encrypt_secret,
    encryption_available,
    mask_key,
)
from app.services.provider_registry import (
    normalize_model,
    recommend_models,
)


def _settings(**overrides) -> Settings:
    return Settings(_env_file=None, **overrides)


def test_crypto_round_trip() -> None:
    settings = _settings(app_encryption_key="unit-test-secret")
    assert encryption_available(settings)
    token = encrypt_secret(settings, "sk-secret-value")
    assert token != "sk-secret-value"
    assert decrypt_secret(settings, token) == "sk-secret-value"


def test_crypto_requires_secret() -> None:
    settings = _settings(app_encryption_key="", session_secret="")
    assert not encryption_available(settings)


def test_mask_key() -> None:
    assert mask_key("sk-1234567890abcd") == "sk-1…abcd"
    assert mask_key("short") == "••••"


def test_env_key_read() -> None:
    settings = _settings(openai_api_key="  sk-openai  ")
    spec = get_provider("openai")
    assert spec is not None
    assert env_api_key(settings, spec) == "sk-openai"


def test_normalize_openrouter_rich_metadata() -> None:
    spec = get_provider("openrouter")
    assert spec is not None
    model = normalize_model(
        spec,
        {
            "id": "google/gemini-flash",
            "name": "Gemini Flash",
            "context_length": 1000000,
            "architecture": {"input_modalities": ["text", "image"]},
            "pricing": {"prompt": "0", "completion": "0"},
        },
    )
    assert model["free"] is True
    assert model["context_window"] == 1000000
    assert model["modalities"] == ["text", "image"]
    assert "vision" in model["tags"]


def test_normalize_plain_provider_defaults_to_text() -> None:
    spec = get_provider("groq")
    assert spec is not None
    model = normalize_model(spec, {"id": "openai/gpt-oss-120b"})
    assert model["modalities"] == ["text"]
    assert model["free"] is False
    assert model["context_window"] is None


def test_recommend_prefers_free_and_large_context() -> None:
    models = [
        {"id": "paid-model", "free": False, "context_window": 8000, "tags": []},
        {"id": "free-small", "free": True, "context_window": 8000, "tags": []},
        {"id": "free-big", "free": True, "context_window": 128000, "tags": []},
    ]
    picks = recommend_models(models)
    assert picks[0]["model"] == "free-big"
    assert picks[0]["free"] is True


def test_openai_compatible_provider_name_and_label() -> None:
    from app.llm import OpenAICompatibleProvider

    provider = OpenAICompatibleProvider(
        api_key="sk-test", base_url="https://example.test/v1", name="openrouter"
    )
    assert provider.name == "openrouter"
    assert provider.label == "Openrouter"


def test_rate_limit_snapshot_recorded() -> None:
    import httpx

    from app.llm import get_rate_limits, record_rate_limits

    headers = httpx.Headers(
        {
            "x-ratelimit-remaining-tokens": "1200",
            "x-ratelimit-limit-tokens": "8000",
        }
    )
    record_rate_limits("groq", headers)
    snapshot = get_rate_limits("groq")
    assert snapshot["x-ratelimit-remaining-tokens"] == "1200"
    assert snapshot["x-ratelimit-limit-tokens"] == "8000"