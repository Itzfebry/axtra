"""Tests for the built-in Cloudflare Workers AI provider."""

from __future__ import annotations

import asyncio

import pytest

from app.config import Settings
from app.provider_catalog import (
    CLOUDFLARE_TEXT_MODELS,
    env_api_key,
    get_provider,
    provider_base_url,
)
from app.services import provider_registry
from app.services.provider_registry import (
    ProviderRequestError,
    fetch_models,
    ping,
    provider_ready,
)
from tests.image_fakes import FakeAsyncClient, FakeResponse


def _settings(**overrides) -> Settings:
    base = {"cloudflare_account_id": "acct123", "cloudflare_api_key": "cf-token"}
    base.update(overrides)
    return Settings(_env_file=None, **base)


@pytest.fixture
def patched_httpx(monkeypatch: pytest.MonkeyPatch):
    provider_registry._cache.clear()
    FakeAsyncClient.get_response = FakeResponse(200, {"data": []})
    monkeypatch.setattr(provider_registry.httpx, "AsyncClient", FakeAsyncClient)
    return FakeAsyncClient


def test_cloudflare_spec_registered() -> None:
    spec = get_provider("cloudflare")
    assert spec is not None
    assert spec.templated_base_url is True
    assert spec.fallback_models == CLOUDFLARE_TEXT_MODELS
    assert env_api_key(_settings(), spec) == "cf-token"


def test_base_url_built_from_account() -> None:
    spec = get_provider("cloudflare")
    assert spec is not None
    url = provider_base_url(_settings(), spec)
    assert url == "https://api.cloudflare.com/client/v4/accounts/acct123/ai/v1"


def test_base_url_override() -> None:
    spec = get_provider("cloudflare")
    assert spec is not None
    url = provider_base_url(
        _settings(cloudflare_base_url="https://proxy.test/ai/v1/"), spec
    )
    assert url == "https://proxy.test/ai/v1"


def test_provider_ready_requires_account() -> None:
    spec = get_provider("cloudflare")
    assert spec is not None
    assert provider_ready(_settings(), spec) is None
    message = provider_ready(_settings(cloudflare_account_id=""), spec)
    assert message is not None and "ACCOUNT_ID" in message


def test_fetch_models_falls_back_to_curated_list(patched_httpx) -> None:
    spec = get_provider("cloudflare")
    assert spec is not None
    patched_httpx.get_response = FakeResponse(404, {"error": {"message": "no route"}})
    models, cached = asyncio.run(fetch_models(_settings(), spec, "cf-token"))
    assert cached is False
    ids = [model["id"] for model in models]
    assert "@cf/meta/llama-3.1-8b-instruct" in ids
    # Curated models are surfaced as free so the free filter finds them.
    assert all(model["free"] for model in models)
    assert models[0]["id"].startswith("@cf/")


def test_fetch_models_missing_account_errors() -> None:
    spec = get_provider("cloudflare")
    assert spec is not None
    with pytest.raises(ProviderRequestError) as exc:
        asyncio.run(fetch_models(_settings(cloudflare_account_id=""), spec, "cf-token"))
    assert "ACCOUNT_ID" in str(exc.value)


def test_ping_tolerates_missing_models_endpoint(patched_httpx) -> None:
    spec = get_provider("cloudflare")
    assert spec is not None
    patched_httpx.get_response = FakeResponse(404, {})
    result = asyncio.run(ping(_settings(), spec, "cf-token"))
    assert result["ok"] is True
