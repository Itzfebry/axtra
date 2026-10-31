"""Endpoint-level tests for the image router (mock httpx, fake Supabase)."""

from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from app.config import Settings
from app.deps import CurrentUser
from app.routers import images
from app.schemas import ImageGenerateRequest
from app.services import image_service
from tests.fake_supabase import FakeClient
from tests.image_fakes import FakeAsyncClient, FakeResponse, FakeStream

USER = "00000000-0000-0000-0000-000000000001"


def _settings(**overrides) -> Settings:
    base = {
        "openrouter_api_key": "sk-or-test",
        "image_provider": "openrouter",
        "image_model": "google/gemini-3-pro-image",
        "image_max_retries": 0,
    }
    base.update(overrides)
    return Settings(_env_file=None, **base)


def _user() -> CurrentUser:
    return CurrentUser(id=USER, email=None, token="test", client=FakeClient())


@pytest.fixture
def patched_httpx(monkeypatch: pytest.MonkeyPatch):
    image_service._MODEL_CACHE.clear()
    FakeAsyncClient.get_response = FakeResponse(200, {"data": []})
    FakeAsyncClient.post_response = FakeResponse(200, {})
    FakeAsyncClient.stream_obj = None
    monkeypatch.setattr(image_service.httpx, "AsyncClient", FakeAsyncClient)
    return FakeAsyncClient


def test_config_returns_defaults(patched_httpx) -> None:
    config = asyncio.run(images.image_config(_user(), _settings()))
    assert config.provider == "openrouter"
    assert config.key_ok is True
    assert config.max_n == 10
    assert config.daily_limit == 100
    assert "1:1" in config.aspect_ratios
    assert config.style == "none"
    assert any(item.id == "anime" for item in config.styles)


def test_models_include_capabilities(patched_httpx) -> None:
    patched_httpx.get_response = FakeResponse(
        200,
        {
            "data": [
                {
                    "id": "google/gemini-3-pro-image",
                    "name": "Gemini 3 Pro Image",
                    "supported_parameters": {"aspect_ratio": {"type": "enum", "values": ["1:1"]}},
                    "supports_streaming": True,
                    "architecture": {"input_modalities": ["text", "image"]},
                }
            ]
        },
    )
    result = asyncio.run(images.image_models(_user(), _settings(), "openrouter"))
    assert result.count == 1
    model = result.models[0]
    assert model.supports_streaming is True
    assert model.capabilities["aspect_ratio"]["values"] == ["1:1"]
    assert model.input_modalities == ["text", "image"]


def test_usage_shape(patched_httpx) -> None:
    result = asyncio.run(images.image_usage(_user(), _settings()))
    assert result.day_images == 0
    assert result.day_limit == 100


def test_credits_forbidden_is_graceful(patched_httpx) -> None:
    patched_httpx.get_response = FakeResponse(403, {"error": {"message": "management only"}})
    result = asyncio.run(images.image_credits(_user(), _settings(), ""))
    assert result.available is False


def test_endpoints_listing(patched_httpx) -> None:
    patched_httpx.get_response = FakeResponse(
        200,
        {
            "endpoints": [
                {
                    "provider_name": "Google",
                    "provider_slug": "google-ai-studio",
                    "provider_tag": "google-ai-studio",
                    "supports_streaming": True,
                    "supported_parameters": {},
                    "pricing": [{"billable": "output_image", "unit": "image", "cost_usd": 0.05}],
                }
            ]
        },
    )
    result = asyncio.run(
        images.image_endpoints(_user(), _settings(), "google/gemini-3-pro-image", "openrouter")
    )
    assert result.endpoints[0].provider_slug == "google-ai-studio"
    assert result.endpoints[0].pricing[0]["cost_usd"] == 0.05


def test_generate_requires_prompt() -> None:
    payload = ImageGenerateRequest(prompt="a cat")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(images.generate(ImageGenerateRequest(prompt="   "), _user(), _settings()))
    assert exc.value.status_code == 400
    assert payload.prompt == "a cat"


def test_generate_returns_images(patched_httpx) -> None:
    patched_httpx.get_response = FakeResponse(
        200, {"data": [{"id": "google/gemini-3-pro-image"}]}
    )
    patched_httpx.post_response = FakeResponse(
        200,
        {
            "data": [{"b64_json": "AAAA", "media_type": "image/png"}],
            "usage": {"cost": 0.04},
        },
    )
    payload = ImageGenerateRequest(
        prompt="a cat",
        model="google/gemini-3-pro-image",
        provider_only=["google-ai-studio"],
        provider_sort="price",
        provider_allow_fallbacks=False,
    )
    result = asyncio.run(images.generate(payload, _user(), _settings()))
    assert result.images[0].data_url == "data:image/png;base64,AAAA"
    # Routing threaded into the provider payload.
    sent = FakeAsyncClient.last_post
    assert sent is not None
    assert sent["provider"] == {"only": ["google-ai-studio"], "sort": "price", "allow_fallbacks": False}


def test_generate_stream_emits_sse(patched_httpx) -> None:
    patched_httpx.get_response = FakeResponse(
        200, {"data": [{"id": "google/gemini-3-pro-image"}]}
    )
    patched_httpx.stream_obj = FakeStream(
        200,
        [
            'data: {"type":"image_generation.partial_image","partial_image_index":0,"b64_json":"PP"}',
            'data: {"type":"image_generation.completed","b64_json":"BB","media_type":"image/png","usage":{"cost":0.01}}',
            "data: [DONE]",
        ],
    )
    payload = ImageGenerateRequest(prompt="a cat", model="google/gemini-3-pro-image")

    async def run() -> list[str]:
        response = await images.generate_stream(payload, _user(), _settings())
        return [chunk async for chunk in response.body_iterator]

    chunks = asyncio.run(run())
    text = "".join(chunks)
    assert "event: partial" in text
    assert "event: completed" in text
    assert '"data:image/png;base64,BB"' in text
