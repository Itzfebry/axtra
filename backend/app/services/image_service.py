"""Image generation through the OpenRouter-style Image API.

Image models are not chat models. They are called through ``{base}/images``
with a ``model`` and ``prompt`` and answer with base64 image bytes in
``data[].b64_json`` (see OpenRouter's Image API). Only providers that implement
that route can generate images; the built-in catalog enables it for OpenRouter.

The chosen image provider/model live in ``profiles.preferences['llm_image']``
and fall back to the server defaults (``image_provider`` / ``image_model``).

The same endpoint supports image-to-image (``input_references``), partial-image
streaming (``stream: true``), output format/seed, and per-model capability
descriptors (``supported_parameters``) that the UI uses to gate parameters.
"""

from __future__ import annotations

import asyncio
import base64
import json
import re
import time
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.config import Settings
from app.llm import ChatMessage, ChatRequest, LLMProvider, OpenAICompatibleProvider
from app.provider_catalog import (
    ProviderSpec,
    env_api_key,
    get_provider,
    provider_base_url,
)
from app.services.llm_router import resolve_active_llm
from app.services.provider_registry import resolve_api_key, resolve_provider_spec

# Transient provider failures worth a bounded retry (rate limit / server side).
_RETRY_STATUS = {429, 500, 502, 503, 504}

# In-process cache for the image-model catalog (it is provider-side metadata).
_MODEL_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_MODEL_CACHE_TTL = 300.0

# Style presets append a prompt fragment so results stay consistent without the
# user retyping descriptors. The id is what gets stored in preferences.
IMAGE_STYLES: tuple[dict[str, str], ...] = (
    {"id": "none", "label": "Tanpa style", "prompt": ""},
    {
        "id": "photorealistic",
        "label": "Fotorealistis",
        "prompt": "photorealistic, ultra detailed, natural lighting, 50mm photograph",
    },
    {
        "id": "cinematic",
        "label": "Sinematik",
        "prompt": "cinematic lighting, film still, dramatic composition, shallow depth of field",
    },
    {
        "id": "anime",
        "label": "Anime",
        "prompt": "anime style, cel shaded, vibrant colors, clean line art",
    },
    {
        "id": "3d",
        "label": "3D Render",
        "prompt": "3D render, octane render, soft studio lighting, high detail",
    },
    {
        "id": "watercolor",
        "label": "Cat air",
        "prompt": "watercolor painting, soft washes, textured paper",
    },
    {
        "id": "oil",
        "label": "Lukisan minyak",
        "prompt": "oil painting, visible brush strokes, rich texture",
    },
    {
        "id": "illustration",
        "label": "Ilustrasi digital",
        "prompt": "digital illustration, clean line art, flat colors",
    },
    {
        "id": "pixel",
        "label": "Pixel art",
        "prompt": "pixel art, 8-bit, crisp edges, limited palette",
    },
    {
        "id": "minimal",
        "label": "Minimalis",
        "prompt": "minimalist, clean composition, simple background, flat design",
    },
)
_DEFAULT_IMAGE_STYLE = "none"
_STYLE_PROMPTS = {item["id"]: item["prompt"] for item in IMAGE_STYLES}


def image_style_options() -> list[dict[str, str]]:
    """Return the selectable style presets (id + label only)."""
    return [{"id": item["id"], "label": item["label"]} for item in IMAGE_STYLES]


def normalize_image_style(style: str) -> str:
    """Coerce an unknown/empty style to the default preset."""
    value = (style or "").strip()
    return value if value in _STYLE_PROMPTS else _DEFAULT_IMAGE_STYLE


def image_style_entry(style: str) -> dict[str, str]:
    value = normalize_image_style(style)
    for item in IMAGE_STYLES:
        if item["id"] == value:
            return {"id": item["id"], "label": item["label"]}
    return {"id": _DEFAULT_IMAGE_STYLE, "label": ""}


def apply_image_style(prompt: str, style: str) -> str:
    """Append the preset's prompt fragment to a user prompt (best-effort)."""
    fragment = _STYLE_PROMPTS.get(normalize_image_style(style), "")
    text = (prompt or "").strip()
    if not fragment:
        return text
    return f"{text}, {fragment}"


class ImageGenerationError(RuntimeError):
    """Raised when an image request fails before/at the provider."""

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


async def load_image_preference(client: Any, user_id: str) -> tuple[str, str, str]:
    """Return ``(provider_id, model, style)`` for image generation, or blanks."""
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
        value = preferences.get("llm_image")
        if isinstance(value, dict):
            return (
                str(value.get("provider") or "").strip(),
                str(value.get("model") or "").strip(),
                normalize_image_style(str(value.get("style") or "")),
            )
    return "", "", _DEFAULT_IMAGE_STYLE


async def save_image_style(client: Any, user_id: str, style: str) -> str:
    """Persist the default style inside ``profiles.preferences['llm_image']``."""
    value = normalize_image_style(style)
    response = (
        await client.table("profiles")
        .select("preferences")
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    row = (response.data if response else None) or {}
    preferences = row.get("preferences")
    preferences = preferences if isinstance(preferences, dict) else {}
    current = preferences.get("llm_image")
    current = dict(current) if isinstance(current, dict) else {}
    current["style"] = value
    preferences = {**preferences, "llm_image": current}
    await client.table("profiles").update({"preferences": preferences}).eq(
        "id", user_id
    ).execute()
    return value


def _images_url(settings: Settings, spec: ProviderSpec) -> str:
    return f"{provider_base_url(settings, spec)}{spec.images_path}"


def _api_root(settings: Settings, spec: ProviderSpec) -> str:
    return provider_base_url(settings, spec)


# ---------------------------------------------------------------------------
# Cloudflare Workers AI image contract (``/ai/run/<model>``)
# ---------------------------------------------------------------------------
_WORKERS_AI_ROOT = re.compile(r"/accounts/[^/]+/ai", re.IGNORECASE)


def _cloudflare_run_url(settings: Settings, spec: ProviderSpec, model: str) -> str:
    """Build the account ``/ai/run/<model>`` URL from any Workers AI base.

    Accepts the OpenAI-compatible ``/ai/v1`` base and the native ``/ai/run``
    base (common when Workers AI is added as a custom provider).
    """
    base = provider_base_url(settings, spec).rstrip("/")
    match = _WORKERS_AI_ROOT.search(base)
    if match:
        base = base[: match.end()]
    elif base.endswith("/v1"):
        base = base[: -len("/v1")]
    return f"{base}/run/{model}"


def _cloudflare_steps_key(model: str) -> str:
    """Workers AI names the diffusion-steps field per model family."""
    return "steps" if "flux" in model.lower() else "num_steps"


def _cloudflare_media_type(model: str) -> str:
    # flux-1-schnell answers JPEG; the Stability/Leonardo builds answer PNG.
    return "image/jpeg" if "flux" in model.lower() else "image/png"


# Cloudflare image models only support prompt/seed/steps; the UI reads these
# capabilities and hides the OpenRouter-only controls accordingly.
_CLOUDFLARE_IMAGE_CAPABILITIES: dict[str, Any] = {
    "seed": {"type": "boolean"},
    "steps": {"type": "range", "min": 1, "max": 20},
}

# FLUX.2 models take multipart form input and support reference images. The
# two klein builds run a fixed 4-step process, so ``steps`` is not exposed.
CLOUDFLARE_FLUX2_MODELS: frozenset[str] = frozenset(
    {
        "@cf/black-forest-labs/flux-2-klein-4b",
        "@cf/black-forest-labs/flux-2-klein-9b",
        "@cf/black-forest-labs/flux-2-dev",
    }
)
CLOUDFLARE_FLUX2_FIXED_STEPS: frozenset[str] = frozenset(
    {
        "@cf/black-forest-labs/flux-2-klein-4b",
        "@cf/black-forest-labs/flux-2-klein-9b",
    }
)
_FLUX2_MAX_REFERENCES = 4


def _is_flux2(model: str) -> bool:
    return (model or "").strip() in CLOUDFLARE_FLUX2_MODELS


def _fallback_image_models(spec: ProviderSpec) -> list[dict[str, Any]]:
    """Curated image models for a provider with no ``/images/models`` listing."""
    models: list[dict[str, Any]] = []
    for model_id in spec.fallback_image_models:
        if _is_flux2(model_id):
            capabilities: dict[str, Any] = {
                "seed": {"type": "boolean"},
                "input_references": {"type": "range", "min": 0, "max": _FLUX2_MAX_REFERENCES},
            }
            if model_id not in CLOUDFLARE_FLUX2_FIXED_STEPS:
                capabilities["steps"] = {"type": "range", "min": 1, "max": 50}
            input_modalities = ["text", "image"]
        else:
            capabilities = dict(_CLOUDFLARE_IMAGE_CAPABILITIES)
            input_modalities = ["text"]
        models.append(
            {
                "id": model_id,
                "name": model_id,
                "capabilities": capabilities,
                "supports_streaming": False,
                "input_modalities": input_modalities,
                "output_modalities": ["image"],
            }
        )
    return models


def _cloudflare_results(response: httpx.Response, model: str) -> list[dict[str, str]]:
    """Parse a Workers AI run reply into data URLs (JSON or raw image bytes)."""
    content_type = str(response.headers.get("content-type") or "")
    if content_type.startswith("image/"):
        media_type = content_type.split(";")[0].strip() or _cloudflare_media_type(model)
        raw = response.content or b""
        if not raw:
            return []
        b64 = base64.b64encode(raw).decode("ascii")
        return [{"data_url": f"data:{media_type};base64,{b64}", "media_type": media_type}]
    try:
        data = response.json()
    except ValueError:
        return []
    b64 = ""
    if isinstance(data, dict):
        result = data.get("result")
        if isinstance(result, dict):
            b64 = str(result.get("image") or "")
        elif isinstance(result, str):
            b64 = result
    if not b64:
        return []
    media_type = _sniff_image_media_type(b64) or _cloudflare_media_type(model)
    return [{"data_url": f"data:{media_type};base64,{b64}", "media_type": media_type}]


def _sniff_image_media_type(b64: str) -> str:
    """Detect the image type from a base64 header (PNG/JPEG/WebP)."""
    head = (b64 or "")[:16]
    if head.startswith("iVBOR"):
        return "image/png"
    if head.startswith("/9j/"):
        return "image/jpeg"
    if head.startswith("UklGR"):
        return "image/webp"
    return ""


def _provider_detail(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return ""
    if not isinstance(body, dict):
        return ""
    error = body.get("error")
    if isinstance(error, dict):
        return str(error.get("message") or "").strip()
    if isinstance(error, str):
        return error.strip()
    # Cloudflare returns {"errors": [{"code": 10000, "message": "..."}]}.
    errors = body.get("errors")
    if isinstance(errors, list) and errors:
        first = errors[0]
        if isinstance(first, dict):
            message = str(first.get("message") or "").strip()
            code = first.get("code")
            if message and code is not None:
                return f"{message} (code {code})"
            return message
        if isinstance(first, str):
            return first.strip()
    return ""


def _error_message(response: httpx.Response) -> str:
    code = response.status_code
    detail = _provider_detail(response)
    if code == 401:
        return "API key ditolak (401). Periksa key provider gambar."
    if code == 402:
        return (
            "Kredit OpenRouter di bawah $1 (402). Image API butuh saldo; "
            "tidak ada model gambar gratis."
        )
    if code == 403:
        return detail or "Akses ditolak (403)."
    if code == 404:
        return detail or "Model gambar tidak ditemukan (404)."
    if code == 429:
        return "Provider membatasi laju (429). Coba lagi sebentar lagi."
    if code == 400:
        return detail or "Permintaan ditolak (400). Periksa model atau parameter."
    return detail or f"Provider membalas {code}."


def _headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _capabilities(raw: Any) -> dict[str, Any]:
    """Normalize a ``supported_parameters`` map into a safe dict."""
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    for key, descriptor in raw.items():
        name = str(key).strip()
        if not name:
            continue
        if isinstance(descriptor, dict):
            out[name] = descriptor
        else:
            out[name] = {"type": "boolean"}
    return out


def _parse_model(item: dict[str, Any]) -> dict[str, Any] | None:
    model_id = str(item.get("id") or "").strip()
    if not model_id:
        return None
    architecture = item.get("architecture")
    if not isinstance(architecture, dict):
        architecture = {}
    inputs = architecture.get("input_modalities")
    outputs = architecture.get("output_modalities")
    return {
        "id": model_id,
        "name": str(item.get("name") or model_id),
        "capabilities": _capabilities(item.get("supported_parameters")),
        "supports_streaming": bool(item.get("supports_streaming")),
        "input_modalities": [str(x) for x in inputs] if isinstance(inputs, list) else [],
        "output_modalities": [str(x) for x in outputs] if isinstance(outputs, list) else [],
    }


async def _resolve_target(
    settings: Settings, client: Any, user_id: str, provider: str, model: str
) -> tuple[ProviderSpec, str, str]:
    provider_id, stored_model, _ = await load_image_preference(client, user_id)
    provider_id = (provider or provider_id or settings.image_provider or "openrouter").strip()
    model = (model or stored_model or settings.image_model or "").strip()
    spec = await resolve_provider_spec(settings, client, user_id, provider_id)
    if spec is None:
        raise ImageGenerationError("Provider gambar tidak dikenal.")
    api_key, source = await resolve_api_key(settings, client, user_id, spec)
    if source == "none":
        raise ImageGenerationError(
            f"API key {spec.label} belum diatur. Buka Pengaturan → Provider."
        )
    if not model:
        raise ImageGenerationError(
            "Model gambar belum dipilih. Atur di Pengaturan → Provider."
        )
    return spec, api_key, model


async def fetch_image_models(
    settings: Settings,
    spec: ProviderSpec,
    api_key: str,
    *,
    force: bool = False,
) -> list[dict[str, Any]]:
    """Fetch (and cache) an image provider's model catalog with capabilities."""
    cache_key = f"{spec.id}:{len(api_key)}:{api_key[-4:] if api_key else 'none'}"
    now = time.monotonic()
    cached = _MODEL_CACHE.get(cache_key)
    if not force and cached and now - cached[0] < _MODEL_CACHE_TTL:
        return cached[1]
    if spec.images_style == "cloudflare":
        # Workers AI has no image-model listing; use the curated catalog.
        models = _fallback_image_models(spec)
        _MODEL_CACHE[cache_key] = (now, models)
        return models
    async with httpx.AsyncClient(timeout=settings.provider_ping_timeout) as http:
        try:
            response = await http.get(
                f"{_images_url(settings, spec)}/models", headers=_headers(api_key)
            )
        except httpx.HTTPError as exc:
            raise ImageGenerationError(
                f"Tidak bisa menghubungi {spec.label}: {exc}"
            ) from exc
    if response.status_code in (404, 405) and spec.fallback_image_models:
        models = _fallback_image_models(spec)
        _MODEL_CACHE[cache_key] = (now, models)
        return models
    if response.status_code >= 400:
        raise ImageGenerationError(
            _error_message(response), status_code=response.status_code
        )
    data = response.json()
    records = data.get("data") if isinstance(data, dict) else data
    if not isinstance(records, list):
        records = []
    models = [_parse_model(item) for item in records if isinstance(item, dict)]
    models = [model for model in models if model]
    models.sort(key=lambda item: item["id"])
    _MODEL_CACHE[cache_key] = (now, models)
    return models


async def list_image_models(
    settings: Settings, client: Any, user_id: str, provider: str
) -> list[dict[str, Any]]:
    """List the image models an image provider's Image API serves."""
    spec = await resolve_provider_spec(settings, client, user_id, provider)
    if spec is None:
        raise ImageGenerationError("Provider gambar tidak dikenal.")
    api_key, source = await resolve_api_key(settings, client, user_id, spec)
    if source == "none":
        raise ImageGenerationError(
            f"API key {spec.label} belum diatur. Buka Pengaturan → Provider."
        )
    return await fetch_image_models(settings, spec, api_key)


async def fetch_image_endpoints(
    settings: Settings, client: Any, user_id: str, provider: str, model: str
) -> list[dict[str, Any]]:
    """List per-endpoint records (providers/pricing) for one image model."""
    if not model:
        return []
    spec = await resolve_provider_spec(settings, client, user_id, provider)
    if spec is None:
        raise ImageGenerationError("Provider gambar tidak dikenal.")
    api_key, source = await resolve_api_key(settings, client, user_id, spec)
    if source == "none":
        raise ImageGenerationError(
            f"API key {spec.label} belum diatur. Buka Pengaturan → Provider."
        )
    if spec.images_style == "cloudflare":
        # Workers AI exposes no per-endpoint routing metadata.
        return []
    async with httpx.AsyncClient(timeout=settings.provider_ping_timeout) as http:
        try:
            response = await http.get(
                f"{_images_url(settings, spec)}/models/{model}/endpoints",
                headers=_headers(api_key),
            )
        except httpx.HTTPError as exc:
            raise ImageGenerationError(
                f"Tidak bisa menghubungi {spec.label}: {exc}"
            ) from exc
    if response.status_code >= 400:
        raise ImageGenerationError(
            _error_message(response), status_code=response.status_code
        )
    data = response.json()
    records = data.get("endpoints") if isinstance(data, dict) else data
    if not isinstance(records, list):
        records = []
    endpoints: list[dict[str, Any]] = []
    for item in records:
        if not isinstance(item, dict):
            continue
        pricing = item.get("pricing")
        endpoints.append(
            {
                "provider_name": str(item.get("provider_name") or ""),
                "provider_slug": str(item.get("provider_slug") or ""),
                "provider_tag": item.get("provider_tag"),
                "supports_streaming": bool(item.get("supports_streaming")),
                "supported_parameters": _capabilities(item.get("supported_parameters")),
                "pricing": [p for p in pricing if isinstance(p, dict)]
                if isinstance(pricing, list)
                else [],
            }
        )
    return endpoints


async def get_model_capabilities(
    settings: Settings, client: Any, user_id: str, provider: str, model: str
) -> dict[str, Any]:
    """Return ``supported_parameters`` for one model, or ``{}`` if unknown.

    Best-effort: a catalog or validation failure never blocks generation.
    """
    if not model:
        return {}
    try:
        models = await list_image_models(settings, client, user_id, provider)
    except ImageGenerationError:
        return {}
    for item in models:
        if item["id"] == model:
            return dict(item.get("capabilities") or {})
    return {}


async def validate_model(
    settings: Settings, client: Any, user_id: str, provider: str, model: str
) -> None:
    """Reject a slug that is not in the image catalog. Best-effort."""
    if not model:
        return
    try:
        models = await list_image_models(settings, client, user_id, provider)
    except ImageGenerationError:
        # Catalog unavailable (custom provider, transient failure): let the
        # provider decide rather than blocking a valid request.
        return
    if not models:
        return
    if all(item["id"] != model for item in models):
        raise ImageGenerationError(
            f"'{model}' bukan model gambar yang dikenali provider. "
            "Pilih dari daftar model gambar."
        )


async def get_credits(
    settings: Settings, client: Any, user_id: str, provider: str = ""
) -> dict[str, Any]:
    """Read the provider account balance. Normal keys cannot read this."""
    provider_id, _, _ = await load_image_preference(client, user_id)
    provider_id = (provider or provider_id or settings.image_provider or "openrouter").strip()
    spec = await resolve_provider_spec(settings, client, user_id, provider_id)
    if spec is None:
        return {"available": False, "detail": "Provider gambar tidak dikenal."}
    if spec.images_style == "cloudflare":
        return {
            "available": False,
            "detail": f"{spec.label} tidak menyediakan pembacaan saldo.",
        }
    api_key, source = await resolve_api_key(settings, client, user_id, spec)
    if source == "none":
        return {
            "available": False,
            "detail": f"API key {spec.label} belum diatur.",
        }
    url = f"{_api_root(settings, spec)}/credits"
    async with httpx.AsyncClient(timeout=settings.provider_ping_timeout) as http:
        try:
            response = await http.get(url, headers=_headers(api_key))
        except httpx.HTTPError as exc:
            return {"available": False, "detail": f"Tidak bisa menghubungi {spec.label}: {exc}"}
    if response.status_code >= 400:
        detail = _provider_detail(response)
        if response.status_code in (401, 403, 404):
            return {
                "available": False,
                "detail": detail
                or "Provider tidak mengizinkan pembacaan saldo (butuh management key).",
            }
        return {"available": False, "detail": _error_message(response)}
    data = response.json()
    payload = data.get("data") if isinstance(data, dict) else None
    if not isinstance(payload, dict):
        return {"available": False, "detail": "Format saldo tidak dikenali."}
    total = payload.get("total_credits")
    usage = payload.get("total_usage")
    remaining = None
    if isinstance(total, (int, float)) and isinstance(usage, (int, float)):
        remaining = float(total) - float(usage)
    return {
        "available": True,
        "total_credits": float(total) if isinstance(total, (int, float)) else None,
        "total_usage": float(usage) if isinstance(usage, (int, float)) else None,
        "remaining": remaining,
        "detail": "",
    }


# ---------------------------------------------------------------------------
# Usage telemetry
# ---------------------------------------------------------------------------
async def record_image_usage(
    client: Any,
    user_id: str,
    provider: str,
    model: str,
    usage: dict[str, Any] | None,
    images: int,
) -> None:
    """Persist one completed generation's cost/images. Best-effort."""
    cost = 0.0
    if isinstance(usage, dict) and isinstance(usage.get("cost"), (int, float)):
        cost = float(usage["cost"])
    try:
        await (
            client.table("image_usage_events")
            .insert(
                {
                    "user_id": user_id,
                    "provider": provider,
                    "model": model,
                    "cost": cost,
                    "images": max(int(images), 0),
                }
            )
            .execute()
        )
    except Exception:  # noqa: BLE001 - telemetry must never break a reply
        pass


async def get_image_usage(
    settings: Settings, client: Any, user_id: str
) -> dict[str, Any]:
    """Aggregate today's generated images and cost (WIB day)."""
    from app.services.usage_service import current_window

    window = current_window()
    row: dict[str, Any] = {}
    try:
        response = await client.rpc(
            "get_image_usage_day", {"p_day_since": window.day_since.isoformat()}
        ).execute()
        if isinstance(response.data, list) and response.data:
            row = response.data[0] or {}
        elif isinstance(response.data, dict):
            row = response.data
    except Exception:  # noqa: BLE001 - report zeros rather than fail the UI
        row = {}
    try:
        images = int(row.get("day_images") or 0)
    except (TypeError, ValueError):
        images = 0
    try:
        cost = float(row.get("day_cost") or 0)
    except (TypeError, ValueError):
        cost = 0.0
    return {
        "day_images": images,
        "day_cost": cost,
        "day_limit": max(settings.image_daily_limit, 0),
        "day_reset_at": window.day_reset_at,
    }


async def _check_daily_budget(settings: Settings, client: Any, user_id: str) -> None:
    """Block generation once the daily image cap is reached (0 disables)."""
    if settings.image_daily_limit <= 0:
        return
    usage = await get_image_usage(settings, client, user_id)
    if usage["day_images"] >= settings.image_daily_limit:
        raise ImageGenerationError(
            f"Batas harian {settings.image_daily_limit} gambar tercapai. "
            "Coba lagi besok atau ubah batas di server.",
            status_code=429,
        )


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------
def build_provider_routing(
    *,
    only: list[str] | None = None,
    order: list[str] | None = None,
    ignore: list[str] | None = None,
    sort: str = "",
    allow_fallbacks: bool | None = None,
) -> dict[str, Any]:
    """Build an OpenRouter ``provider`` routing object, omitting empties."""
    routing: dict[str, Any] = {}
    if only:
        routing["only"] = list(only)
    if order:
        routing["order"] = list(order)
    if ignore:
        routing["ignore"] = list(ignore)
    if sort:
        routing["sort"] = sort
    if allow_fallbacks is not None:
        routing["allow_fallbacks"] = allow_fallbacks
    return routing


def _build_payload(
    model: str,
    prompt: str,
    *,
    aspect_ratio: str = "",
    resolution: str = "",
    quality: str = "",
    output_format: str = "",
    background: str = "",
    output_compression: int | None = None,
    seed: int | None = None,
    input_references: list[str] | None = None,
    provider_routing: dict[str, Any] | None = None,
    n: int = 1,
    stream: bool = False,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"model": model, "prompt": prompt}
    if aspect_ratio:
        payload["aspect_ratio"] = aspect_ratio
    if resolution:
        payload["resolution"] = resolution
    if quality:
        payload["quality"] = quality
    if output_format:
        payload["output_format"] = output_format
    if background:
        payload["background"] = background
    if output_compression is not None:
        payload["output_compression"] = output_compression
    if seed is not None:
        payload["seed"] = seed
    refs = [ref for ref in (input_references or []) if ref]
    if refs:
        payload["input_references"] = [
            {"type": "image_url", "image_url": {"url": ref}} for ref in refs
        ]
    if provider_routing:
        payload["provider"] = provider_routing
    if n and n > 1:
        payload["n"] = n
    if stream:
        payload["stream"] = True
    return payload


def _to_results(items: Any) -> list[dict[str, str]]:
    images: list[dict[str, str]] = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        b64 = item.get("b64_json")
        if not b64:
            continue
        media_type = str(item.get("media_type") or "image/png")
        images.append(
            {"data_url": f"data:{media_type};base64,{b64}", "media_type": media_type}
        )
    return images


async def _post(
    http: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any],
    retries: int,
) -> httpx.Response:
    """POST with a bounded retry on transport errors and 429/5xx."""
    last_exc: httpx.HTTPError | None = None
    for attempt in range(max(retries, 0) + 1):
        try:
            response = await http.post(url, headers=headers, json=payload)
        except httpx.HTTPError as exc:  # transport error
            last_exc = exc
            if attempt < retries:
                await asyncio.sleep(0.8 * (attempt + 1))
                continue
            raise ImageGenerationError(f"Tidak bisa menghubungi provider: {exc}") from exc
        if response.status_code in _RETRY_STATUS and attempt < retries:
            await asyncio.sleep(0.8 * (attempt + 1))
            continue
        return response
    # Unreachable, but keeps type checkers happy.
    raise ImageGenerationError(f"Tidak bisa menghubungi provider: {last_exc}")


async def _post_multipart(
    http: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    data: dict[str, str],
    files: list[tuple[str, tuple[str, bytes, str]]],
    retries: int,
) -> httpx.Response:
    """POST multipart form data with the same bounded retry as ``_post``."""
    last_exc: httpx.HTTPError | None = None
    for attempt in range(max(retries, 0) + 1):
        try:
            response = await http.post(url, headers=headers, data=data, files=files)
        except httpx.HTTPError as exc:  # transport error
            last_exc = exc
            if attempt < retries:
                await asyncio.sleep(0.8 * (attempt + 1))
                continue
            raise ImageGenerationError(f"Tidak bisa menghubungi provider: {exc}") from exc
        if response.status_code in _RETRY_STATUS and attempt < retries:
            await asyncio.sleep(0.8 * (attempt + 1))
            continue
        return response
    raise ImageGenerationError(f"Tidak bisa menghubungi provider: {last_exc}")


_DATA_URL_RE = re.compile(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", re.DOTALL)


async def _reference_part(
    http: httpx.AsyncClient, ref: str
) -> tuple[str, bytes, str]:
    """Turn a data URL or HTTP(S) URL into an httpx multipart file triple."""
    match = _DATA_URL_RE.match((ref or "").strip())
    if match:
        media_type, b64 = match.group(1), match.group(2)
        try:
            raw = base64.b64decode(b64)
        except (ValueError, TypeError) as exc:
            raise ImageGenerationError("Gambar referensi tidak valid.") from exc
        ext = media_type.split("/")[-1] or "png"
        return (f"reference.{ext}", raw, media_type)
    url = (ref or "").strip()
    if not url.startswith(("http://", "https://")):
        raise ImageGenerationError("Gambar referensi harus berupa data URL atau URL HTTP.")
    try:
        response = await http.get(url)
    except httpx.HTTPError as exc:
        raise ImageGenerationError(f"Gagal mengunduh gambar referensi: {exc}") from exc
    if response.status_code >= 400:
        raise ImageGenerationError("Gagal mengunduh gambar referensi.")
    media_type = str(response.headers.get("content-type") or "image/png").split(";")[0]
    ext = media_type.split("/")[-1] or "png"
    return (f"reference.{ext}", response.content, media_type)


# ---------------------------------------------------------------------------
# Prompt translation (Workers AI diffusion models are English-only)
# ---------------------------------------------------------------------------
# flux-1-schnell and friends use an English text encoder. Non-English prompts
# (e.g. Indonesian) tokenize to near-noise and produce unrelated/abstract
# images, so translate them to English before hitting the model.
_ENGLISH_HINTS = frozenset(
    {
        "a", "an", "the", "of", "with", "and", "or", "in", "on", "at", "to",
        "for", "from", "by", "as", "is", "are", "photo", "photograph",
        "realistic", "photorealistic", "cute", "detailed", "highly", "portrait",
        "style", "background", "render", "image", "picture", "art", "drawing",
        "illustration", "painting", "light", "lighting", "color", "colour",
        "black", "white", "red", "blue", "green", "yellow", "cat", "dog",
        "rabbit", "bird", "horse", "woman", "man", "girl", "boy", "child",
        "sitting", "standing", "holding", "wearing", "closeup", "close-up",
        "wide", "shot", "view", "scene", "landscape", "city", "forest", "sky",
        "night", "day", "sunset", "sunrise", "water", "mountain",
    }
)

_TRANSLATE_SYSTEM = (
    "You prepare text-to-image prompts for a diffusion model that only "
    "understands English. Translate the user's prompt into natural, descriptive "
    "English suitable for image generation. If the prompt is already English, "
    "return it unchanged. Keep it under 60 words. Return ONLY the final prompt "
    "text, without quotes or explanation."
)


def _looks_english(prompt: str) -> bool:
    """Cheap heuristic: skip the translation call for obvious English prompts."""
    text = (prompt or "").strip()
    if not text:
        return True
    if any(ord(ch) > 127 for ch in text):
        return False
    tokens = re.findall(r"[a-z]+", text.lower())
    if not tokens:
        return True
    return any(token in _ENGLISH_HINTS for token in tokens)


async def _complete_translation(
    llm: LLMProvider, model: str, prompt: str
) -> str:
    text, _usage = await llm.complete(
        ChatRequest(
            messages=[
                ChatMessage(role="system", content=_TRANSLATE_SYSTEM),
                ChatMessage(role="user", content=prompt),
            ],
            model=model,
            temperature=0.2,
            max_tokens=200,
            stream=False,
        )
    )
    return (text or "").strip().strip('"').strip("'").strip()


async def _translate_prompt(
    settings: Settings, client: Any, user_id: str, prompt: str
) -> str:
    """Return an English version of ``prompt`` (best-effort).

    Skips the round-trip for prompts that already look English. Tries the
    user's active LLM first, then the server-side Groq key. Any failure (no key,
    provider error, quota) falls back to the original prompt so image generation
    is never blocked.
    """
    if _looks_english(prompt):
        return prompt

    try:
        llm, model = await resolve_active_llm(settings, client, user_id)
        cleaned = await _complete_translation(llm, model, prompt)
        if cleaned:
            return cleaned
    except Exception:  # noqa: BLE001 - fall through to the Groq backup
        pass

    groq = get_provider("groq")
    groq_key = env_api_key(settings, groq) if groq else ""
    if groq and groq_key:
        try:
            llm = OpenAICompatibleProvider(
                api_key=groq_key,
                base_url=provider_base_url(settings, groq),
                name=groq.id,
            )
            cleaned = await _complete_translation(
                llm, settings.default_chat_model, prompt
            )
            if cleaned:
                return cleaned
        except Exception:  # noqa: BLE001 - best-effort only
            pass

    return prompt


async def _generate_cloudflare(
    settings: Settings,
    client: Any,
    user_id: str,
    spec: ProviderSpec,
    api_key: str,
    model: str,
    prompt: str,
    *,
    style: str = "",
    seed: int | None = None,
    steps: int | None = None,
    input_references: list[str] | None = None,
) -> dict[str, Any]:
    """Generate via the Workers AI ``/ai/run/<model>`` route.

    Plain models take a JSON body ``{prompt, seed?, steps?}``. FLUX.2 models
    require multipart form data and accept up to four ``input_image_N``
    reference images (image-to-image / multi-reference editing).
    """
    prompt = await _translate_prompt(settings, client, user_id, prompt)
    prompt = apply_image_style(prompt, style)
    url = _cloudflare_run_url(settings, spec, model)

    if _is_flux2(model):
        refs = [ref for ref in (input_references or []) if ref][:_FLUX2_MAX_REFERENCES]
        data: dict[str, str] = {"prompt": prompt}
        if seed is not None:
            data["seed"] = str(seed)
        if steps is not None and model not in CLOUDFLARE_FLUX2_FIXED_STEPS:
            data["steps"] = str(steps)
        async with httpx.AsyncClient(timeout=settings.image_timeout) as http:
            files: list[tuple[str, tuple[str, bytes, str]]] = []
            for index, ref in enumerate(refs):
                files.append((f"input_image_{index}", await _reference_part(http, ref)))
            response = await _post_multipart(
                http,
                url,
                {"Authorization": f"Bearer {api_key}"},
                data,
                files,
                settings.image_max_retries,
            )
    else:
        payload: dict[str, Any] = {"prompt": prompt}
        if seed is not None:
            payload["seed"] = seed
        if steps is not None:
            payload[_cloudflare_steps_key(model)] = steps
        async with httpx.AsyncClient(timeout=settings.image_timeout) as http:
            response = await _post(
                http, url, _headers(api_key), payload, settings.image_max_retries
            )

    if response.status_code >= 400:
        raise ImageGenerationError(
            _error_message(response), status_code=response.status_code
        )
    images = _cloudflare_results(response, model)
    if not images:
        raise ImageGenerationError("Provider tidak mengembalikan gambar.")

    # Free-tier Neurons are not billed per image, so no cost is recorded.
    await record_image_usage(client, user_id, spec.id, model, {}, len(images))
    return {"provider": spec.id, "model": model, "images": images, "usage": {}}


async def generate_image(
    settings: Settings,
    client: Any,
    user_id: str,
    *,
    prompt: str,
    provider: str = "",
    model: str = "",
    aspect_ratio: str = "",
    resolution: str = "",
    quality: str = "",
    output_format: str = "",
    background: str = "",
    output_compression: int | None = None,
    seed: int | None = None,
    steps: int | None = None,
    style: str = "",
    input_references: list[str] | None = None,
    provider_routing: dict[str, Any] | None = None,
    n: int = 1,
) -> dict[str, Any]:
    """Generate one or more images and return them as base64 data URLs."""
    await _check_daily_budget(settings, client, user_id)
    spec, api_key, model = await _resolve_target(settings, client, user_id, provider, model)
    await validate_model(settings, client, user_id, spec.id, model)

    if spec.images_style == "cloudflare":
        return await _generate_cloudflare(
            settings,
            client,
            user_id,
            spec,
            api_key,
            model,
            prompt,
            style=style,
            seed=seed,
            steps=steps,
            input_references=input_references,
        )

    prompt = apply_image_style(prompt, style)
    payload = _build_payload(
        model,
        prompt,
        aspect_ratio=aspect_ratio,
        resolution=resolution,
        quality=quality,
        output_format=output_format,
        background=background,
        output_compression=output_compression,
        seed=seed,
        input_references=input_references,
        provider_routing=provider_routing,
        n=n,
    )

    async with httpx.AsyncClient(timeout=settings.image_timeout) as http:
        response = await _post(
            http,
            _images_url(settings, spec),
            _headers(api_key),
            payload,
            settings.image_max_retries,
        )

    if response.status_code >= 400:
        raise ImageGenerationError(
            _error_message(response), status_code=response.status_code
        )

    data = response.json()
    images = _to_results(data.get("data") if isinstance(data, dict) else None)
    if not images:
        raise ImageGenerationError("Provider tidak mengembalikan gambar.")

    usage = data.get("usage") if isinstance(data, dict) else None
    usage = usage if isinstance(usage, dict) else {}
    await record_image_usage(client, user_id, spec.id, model, usage, len(images))
    return {
        "provider": spec.id,
        "model": model,
        "images": images,
        "usage": usage,
    }


async def stream_image(
    settings: Settings,
    client: Any,
    user_id: str,
    *,
    prompt: str,
    provider: str = "",
    model: str = "",
    aspect_ratio: str = "",
    resolution: str = "",
    quality: str = "",
    output_format: str = "",
    background: str = "",
    seed: int | None = None,
    steps: int | None = None,
    style: str = "",
    input_references: list[str] | None = None,
    provider_routing: dict[str, Any] | None = None,
    n: int = 1,
) -> AsyncIterator[dict[str, Any]]:
    """Stream a generation as typed events.

    Yields ``{"type": "partial", "data_url", "index"}`` for each preview,
    then one ``{"type": "completed", "provider", "model", "images", "usage"}``
    or ``{"type": "error", "detail", "status"}``.
    """
    try:
        await _check_daily_budget(settings, client, user_id)
        spec, api_key, model = await _resolve_target(
            settings, client, user_id, provider, model
        )
        await validate_model(settings, client, user_id, spec.id, model)
    except ImageGenerationError as exc:
        yield {"type": "error", "detail": str(exc), "status": exc.status_code}
        return

    if spec.images_style == "cloudflare":
        # Workers AI has no partial-image stream; emit one completed event.
        try:
            result = await _generate_cloudflare(
                settings,
                client,
                user_id,
                spec,
                api_key,
                model,
                prompt,
                style=style,
                seed=seed,
                steps=steps,
                input_references=input_references,
            )
        except ImageGenerationError as exc:
            yield {"type": "error", "detail": str(exc), "status": exc.status_code}
            return
        yield {"type": "completed", **result}
        return

    payload = _build_payload(
        model,
        apply_image_style(prompt, style),
        aspect_ratio=aspect_ratio,
        resolution=resolution,
        quality=quality,
        output_format=output_format,
        background=background,
        seed=seed,
        input_references=input_references,
        provider_routing=provider_routing,
        n=n,
        stream=True,
    )

    headers = _headers(api_key)
    url = _images_url(settings, spec)
    retries = max(settings.image_max_retries, 0)

    for attempt in range(retries + 1):
        try:
            async with httpx.AsyncClient(timeout=settings.image_timeout) as http:
                async with http.stream("POST", url, headers=headers, json=payload) as response:
                    if response.status_code in _RETRY_STATUS and attempt < retries:
                        await response.aread()
                        await asyncio.sleep(0.8 * (attempt + 1))
                        continue
                    if response.status_code >= 400:
                        await response.aread()
                        yield {
                            "type": "error",
                            "detail": _error_message(response),
                            "status": response.status_code,
                        }
                        return
                    async for line in response.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        raw = line[5:].strip()
                        if raw == "[DONE]":
                            break
                        try:
                            event = json.loads(raw)
                        except ValueError:
                            continue
                        if not isinstance(event, dict):
                            continue
                        event_type = event.get("type")
                        if event_type == "image_generation.partial_image":
                            b64 = event.get("b64_json")
                            if not b64:
                                continue
                            media_type = str(event.get("media_type") or "image/png")
                            yield {
                                "type": "partial",
                                "data_url": f"data:{media_type};base64,{b64}",
                                "index": event.get("partial_image_index", 0),
                            }
                        elif event_type == "image_generation.completed":
                            b64 = event.get("b64_json")
                            if not b64:
                                continue
                            media_type = str(event.get("media_type") or "image/png")
                            usage = event.get("usage") if isinstance(event.get("usage"), dict) else {}
                            await record_image_usage(client, user_id, spec.id, model, usage, 1)
                            yield {
                                "type": "completed",
                                "provider": spec.id,
                                "model": model,
                                "images": [
                                    {
                                        "data_url": f"data:{media_type};base64,{b64}",
                                        "media_type": media_type,
                                    }
                                ],
                                "usage": usage,
                            }
                        elif event_type == "error":
                            error = event.get("error")
                            detail = ""
                            if isinstance(error, dict):
                                detail = str(error.get("message") or "").strip()
                            elif isinstance(error, str):
                                detail = error.strip()
                            yield {
                                "type": "error",
                                "detail": detail or "Generasi gagal di tengah stream.",
                                "status": None,
                            }
                    return
        except httpx.HTTPError as exc:
            if attempt < retries:
                await asyncio.sleep(0.8 * (attempt + 1))
                continue
            yield {
                "type": "error",
                "detail": f"Tidak bisa menghubungi {spec.label}: {exc}",
                "status": None,
            }
            return
