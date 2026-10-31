"""Tests for the image generation service (Image API, gating, billing)."""

from __future__ import annotations

import json

import pytest

from app.config import Settings
from app.services import image_service
from app.services.image_service import (
    ImageGenerationError,
    _build_payload,
    _capabilities,
    _parse_model,
    fetch_image_endpoints,
    generate_image,
    get_credits,
    list_image_models,
    stream_image,
    validate_model,
)
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


@pytest.fixture
def patched_httpx(monkeypatch: pytest.MonkeyPatch):
    image_service._MODEL_CACHE.clear()
    FakeAsyncClient.get_response = FakeResponse(200, {"data": []})
    FakeAsyncClient.post_response = FakeResponse(200, {})
    FakeAsyncClient.stream_obj = None
    FakeAsyncClient.last_post = None
    monkeypatch.setattr(image_service.httpx, "AsyncClient", FakeAsyncClient)
    return FakeAsyncClient


def test_build_payload_omits_empty_and_maps_refs() -> None:
    payload = _build_payload(
        "m",
        "p",
        aspect_ratio="16:9",
        quality="high",
        input_references=["data:image/png;base64,AAA"],
        seed=7,
        n=3,
        stream=True,
    )
    assert payload["aspect_ratio"] == "16:9"
    assert payload["quality"] == "high"
    assert payload["seed"] == 7
    assert payload["n"] == 3
    assert payload["stream"] is True
    assert payload["input_references"][0]["image_url"]["url"].startswith("data:image/png")
    assert "resolution" not in payload
    assert "output_format" not in payload


def test_build_payload_includes_provider_routing() -> None:
    routing = image_service.build_provider_routing(
        only=["google-ai-studio"], sort="price", allow_fallbacks=False
    )
    assert routing == {
        "only": ["google-ai-studio"],
        "sort": "price",
        "allow_fallbacks": False,
    }
    payload = _build_payload("m", "p", provider_routing=routing)
    assert payload["provider"]["only"] == ["google-ai-studio"]
    assert _build_payload("m", "p", provider_routing={}) == {"model": "m", "prompt": "p"}


def test_capabilities_and_parse_model() -> None:
    caps = _capabilities({"resolution": {"type": "enum", "values": ["1K", "2K"]}, "seed": {}})
    assert caps["resolution"]["values"] == ["1K", "2K"]
    assert "seed" in caps
    model = _parse_model(
        {
            "id": "x/y",
            "name": "Y",
            "supported_parameters": {"aspect_ratio": {"type": "enum", "values": ["1:1"]}},
            "supports_streaming": True,
            "architecture": {"input_modalities": ["text", "image"], "output_modalities": ["image"]},
        }
    )
    assert model is not None
    assert model["supports_streaming"] is True
    assert model["input_modalities"] == ["text", "image"]


def test_generate_image_success(patched_httpx) -> None:
    patched_httpx.get_response = FakeResponse(
        200, {"data": [{"id": "google/gemini-3-pro-image"}]}
    )
    patched_httpx.post_response = FakeResponse(
        200,
        {
            "data": [{"b64_json": "AAAA", "media_type": "image/png"}],
            "usage": {"cost": 0.04, "total_tokens": 100},
        },
    )
    client = FakeClient()

    result = image_service.asyncio.run(
        generate_image(
            _settings(),
            client,
            USER,
            prompt="a cat",
            model="google/gemini-3-pro-image",
        )
    )
    assert result["images"][0]["data_url"] == "data:image/png;base64,AAAA"
    assert result["usage"]["cost"] == 0.04
    # Telemetry row recorded.
    events = client.table("image_usage_events").rows
    assert len(events) == 1
    assert events[0]["images"] == 1


def test_generate_image_402(patched_httpx) -> None:
    patched_httpx.get_response = FakeResponse(
        200, {"data": [{"id": "google/gemini-3-pro-image"}]}
    )
    patched_httpx.post_response = FakeResponse(402, {"error": {"message": "no credits"}})
    with pytest.raises(ImageGenerationError) as exc:
        image_service.asyncio.run(
            generate_image(
                _settings(),
                FakeClient(),
                USER,
                prompt="a cat",
                model="google/gemini-3-pro-image",
            )
        )
    assert exc.value.status_code == 402


def test_validate_model_rejects_unknown(patched_httpx) -> None:
    patched_httpx.get_response = FakeResponse(
        200, {"data": [{"id": "google/gemini-3-pro-image"}]}
    )
    with pytest.raises(ImageGenerationError):
        image_service.asyncio.run(
            validate_model(_settings(), FakeClient(), USER, "openrouter", "nope/nope")
        )


def test_validate_model_best_effort_on_catalog_failure(patched_httpx) -> None:
    patched_httpx.get_response = FakeResponse(500, {"error": {"message": "boom"}})
    # Should not raise: catalog unavailable must not block generation.
    image_service.asyncio.run(
        validate_model(_settings(), FakeClient(), USER, "openrouter", "any/slug")
    )


def test_get_credits_normal_key_forbidden(patched_httpx) -> None:
    patched_httpx.get_response = FakeResponse(403, {"error": {"message": "management key only"}})
    result = image_service.asyncio.run(get_credits(_settings(), FakeClient(), USER))
    assert result["available"] is False


def test_get_credits_available(patched_httpx) -> None:
    patched_httpx.get_response = FakeResponse(
        200, {"data": {"total_credits": 10.0, "total_usage": 4.5}}
    )
    result = image_service.asyncio.run(get_credits(_settings(), FakeClient(), USER))
    assert result["available"] is True
    assert result["remaining"] == pytest.approx(5.5)


def test_stream_image_completed(patched_httpx) -> None:
    patched_httpx.get_response = FakeResponse(
        200, {"data": [{"id": "google/gemini-3-pro-image"}]}
    )
    completed = {
        "type": "image_generation.completed",
        "b64_json": "BBBB",
        "media_type": "image/png",
        "usage": {"cost": 0.02},
    }
    patched_httpx.stream_obj = FakeStream(
        200,
        [
            'data: {"type":"image_generation.partial_image","partial_image_index":0,"b64_json":"PP"}',
            f"data: {json.dumps(completed)}",
            "data: [DONE]",
        ],
    )

    async def run() -> list[dict]:
        events = []
        async for event in stream_image(
            _settings(),
            FakeClient(),
            USER,
            prompt="a cat",
            model="google/gemini-3-pro-image",
        ):
            events.append(event)
        return events

    events = image_service.asyncio.run(run())
    assert events[0]["type"] == "partial"
    assert events[0]["data_url"] == "data:image/png;base64,PP"
    assert events[-1]["type"] == "completed"
    assert events[-1]["images"][0]["data_url"] == "data:image/png;base64,BBBB"


# ---------------------------------------------------------------------------
# Cloudflare Workers AI image contract
# ---------------------------------------------------------------------------
def _cloudflare_settings(**overrides) -> Settings:
    base = {
        "cloudflare_api_key": "cf-token",
        "cloudflare_account_id": "acct123",
        "image_provider": "cloudflare",
        "image_max_retries": 0,
    }
    base.update(overrides)
    return Settings(_env_file=None, **base)


def test_cloudflare_run_url_and_steps_key() -> None:
    from app.provider_catalog import get_provider

    spec = get_provider("cloudflare")
    assert spec is not None
    url = image_service._cloudflare_run_url(_cloudflare_settings(), spec, "@cf/x/y")
    assert url == (
        "https://api.cloudflare.com/client/v4/accounts/acct123/ai/run/@cf/x/y"
    )
    assert image_service._cloudflare_steps_key("@cf/black-forest-labs/flux-1-schnell") == "steps"
    assert image_service._cloudflare_steps_key("@cf/stabilityai/stable-diffusion-xl-base-1.0") == "num_steps"


def test_custom_workers_ai_provider_uses_run_contract() -> None:
    from app.provider_catalog import custom_spec

    spec = custom_spec(
        "custom-cloudflare",
        "Cloudflare",
        "https://api.cloudflare.com/client/v4/accounts/acct123/ai/run/",
    )
    assert spec.images_style == "cloudflare"
    assert spec.fallback_image_models
    url = image_service._cloudflare_run_url(
        _cloudflare_settings(), spec, "@cf/black-forest-labs/flux-1-schnell"
    )
    assert url == (
        "https://api.cloudflare.com/client/v4/accounts/acct123/ai/run/"
        "@cf/black-forest-labs/flux-1-schnell"
    )


def test_custom_openai_provider_keeps_openrouter_image_contract() -> None:
    from app.provider_catalog import custom_spec

    spec = custom_spec("custom-foo", "Foo", "https://foo.test/v1")
    assert spec.images_style == "openrouter"
    assert spec.fallback_image_models == ()


def test_list_image_models_cloudflare_is_curated() -> None:
    models = image_service.asyncio.run(
        list_image_models(_cloudflare_settings(), FakeClient(), USER, "cloudflare")
    )
    ids = [model["id"] for model in models]
    assert "@cf/black-forest-labs/flux-1-schnell" in ids
    assert all("steps" in model["capabilities"] for model in models)
    assert all("seed" in model["capabilities"] for model in models)


def test_fetch_image_endpoints_cloudflare_empty() -> None:
    endpoints = image_service.asyncio.run(
        fetch_image_endpoints(
            _cloudflare_settings(),
            FakeClient(),
            USER,
            "cloudflare",
            "@cf/black-forest-labs/flux-1-schnell",
        )
    )
    assert endpoints == []


def test_get_credits_cloudflare_unavailable() -> None:
    result = image_service.asyncio.run(
        get_credits(_cloudflare_settings(), FakeClient(), USER, "cloudflare")
    )
    assert result["available"] is False


def test_generate_cloudflare_json_result(patched_httpx) -> None:
    patched_httpx.post_response = FakeResponse(
        200, {"result": {"image": "AAAA"}, "success": True}
    )
    result = image_service.asyncio.run(
        generate_image(
            _cloudflare_settings(),
            FakeClient(),
            USER,
            prompt="a cat",
            provider="cloudflare",
            model="@cf/black-forest-labs/flux-1-schnell",
            seed=5,
            steps=6,
        )
    )
    assert result["images"][0]["data_url"] == "data:image/jpeg;base64,AAAA"
    sent = patched_httpx.last_post
    assert sent is not None
    assert sent["prompt"] == "a cat"
    assert sent["seed"] == 5
    assert sent["steps"] == 6


def test_looks_english_heuristic() -> None:
    assert image_service._looks_english("a photo of a rabbit")
    assert image_service._looks_english("cute rabbit")
    assert not image_service._looks_english("hewan kelinci")
    assert not image_service._looks_english("gambar kelinci lucu")


def test_translate_prompt_falls_back_when_llm_unavailable() -> None:
    out = image_service.asyncio.run(
        image_service._translate_prompt(
            _cloudflare_settings(), FakeClient(), USER, "hewan kelinci"
        )
    )
    assert out == "hewan kelinci"


def test_translate_prompt_uses_groq_when_active_llm_fails(monkeypatch) -> None:
    async def boom(settings, client, user_id):
        raise RuntimeError("insufficient balance")

    class FakeLLM:
        async def complete(self, request):
            assert request.model
            return "a cute rabbit", {}

    monkeypatch.setattr(image_service, "resolve_active_llm", boom)
    monkeypatch.setattr(
        image_service, "OpenAICompatibleProvider", lambda **kwargs: FakeLLM()
    )
    out = image_service.asyncio.run(
        image_service._translate_prompt(
            _cloudflare_settings(groq_api_key="gsk-test"),
            FakeClient(),
            USER,
            "hewan kelinci",
        )
    )
    assert out == "a cute rabbit"


def test_generate_cloudflare_translates_prompt(patched_httpx, monkeypatch) -> None:
    patched_httpx.post_response = FakeResponse(
        200, {"result": {"image": "AAAA"}, "success": True}
    )

    async def fake_translate(settings, client, user_id, prompt):
        return "a cute brown rabbit"

    monkeypatch.setattr(image_service, "_translate_prompt", fake_translate)
    image_service.asyncio.run(
        generate_image(
            _cloudflare_settings(),
            FakeClient(),
            USER,
            prompt="hewan kelinci",
            provider="cloudflare",
            model="@cf/black-forest-labs/flux-1-schnell",
        )
    )
    sent = patched_httpx.last_post
    assert sent is not None
    assert sent["prompt"] == "a cute brown rabbit"


def test_generate_cloudflare_sdxl_uses_num_steps(patched_httpx) -> None:
    patched_httpx.post_response = FakeResponse(
        200, {"result": {"image": "BBBB"}, "success": True}
    )
    image_service.asyncio.run(
        generate_image(
            _cloudflare_settings(),
            FakeClient(),
            USER,
            prompt="a cat",
            provider="cloudflare",
            model="@cf/stabilityai/stable-diffusion-xl-base-1.0",
            steps=12,
        )
    )
    sent = patched_httpx.last_post
    assert sent is not None
    assert sent["num_steps"] == 12
    assert "steps" not in sent


def test_generate_cloudflare_binary_result(patched_httpx) -> None:
    patched_httpx.post_response = FakeResponse(
        200, None, content=b"\x89PNGdata", headers={"content-type": "image/png"}
    )
    result = image_service.asyncio.run(
        generate_image(
            _cloudflare_settings(),
            FakeClient(),
            USER,
            prompt="a cat",
            provider="cloudflare",
            model="@cf/stabilityai/stable-diffusion-xl-base-1.0",
        )
    )
    assert result["images"][0]["media_type"] == "image/png"
    assert result["images"][0]["data_url"].startswith("data:image/png;base64,")


def test_generate_cloudflare_error_shape(patched_httpx) -> None:
    patched_httpx.post_response = FakeResponse(
        400,
        {"result": None, "success": False, "errors": [{"code": 10000, "message": "Authentication error"}]},
    )
    with pytest.raises(ImageGenerationError) as exc:
        image_service.asyncio.run(
            generate_image(
                _cloudflare_settings(),
                FakeClient(),
                USER,
                prompt="a cat",
                provider="cloudflare",
                model="@cf/black-forest-labs/flux-1-schnell",
            )
        )
    assert "Authentication error" in str(exc.value)
    assert "10000" in str(exc.value)


def test_stream_image_cloudflare_emits_completed(patched_httpx) -> None:
    patched_httpx.post_response = FakeResponse(
        200, {"result": {"image": "CCCC"}, "success": True}
    )

    async def run() -> list[dict]:
        events = []
        async for event in stream_image(
            _cloudflare_settings(),
            FakeClient(),
            USER,
            prompt="a cat",
            provider="cloudflare",
            model="@cf/black-forest-labs/flux-1-schnell",
        ):
            events.append(event)
        return events

    events = image_service.asyncio.run(run())
    assert len(events) == 1
    assert events[0]["type"] == "completed"
    assert events[0]["images"][0]["data_url"] == "data:image/jpeg;base64,CCCC"

