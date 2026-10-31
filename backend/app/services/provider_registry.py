"""Provider connection helpers: live model listings, key resolution, ping.

Everything here is provider-agnostic and speaks the OpenAI-compatible shape.
Model listings are cached in-process for a short window (metadata lives on the
provider side, so a long cache would go stale). Per-user keys are decrypted on
demand and never leave the server.
"""

from __future__ import annotations

import re
import time
from typing import Any

import httpx

from app.config import Settings
from app.provider_catalog import (
    ProviderSpec,
    custom_spec,
    env_api_key,
    get_provider,
    provider_base_url,
)
from app.services.provider_crypto import decrypt_secret


# ---------------------------------------------------------------------------
# Per-user key storage
# ---------------------------------------------------------------------------
async def load_user_key_row(
    client: Any, user_id: str, provider_id: str
) -> dict[str, Any] | None:
    response = (
        await client.table("provider_keys")
        .select("secret, masked, updated_at")
        .eq("user_id", user_id)
        .eq("provider_id", provider_id)
        .maybe_single()
        .execute()
    )
    return (response.data if response else None) or None


async def load_user_key_map(client: Any, user_id: str) -> dict[str, dict[str, Any]]:
    """All stored provider keys for a user, keyed by provider id (no decrypt)."""
    response = (
        await client.table("provider_keys")
        .select("provider_id, masked, updated_at")
        .eq("user_id", user_id)
        .execute()
    )
    rows = response.data if response else []
    return {row["provider_id"]: row for row in (rows or [])}


async def save_user_key(
    client: Any, user_id: str, provider_id: str, encrypted: str, masked: str
) -> None:
    await (
        client.table("provider_keys")
        .upsert(
            {
                "user_id": user_id,
                "provider_id": provider_id,
                "secret": encrypted,
                "masked": masked,
            },
            on_conflict="user_id,provider_id",
        )
        .execute()
    )


async def delete_user_key(client: Any, user_id: str, provider_id: str) -> None:
    await (
        client.table("provider_keys")
        .delete()
        .eq("user_id", user_id)
        .eq("provider_id", provider_id)
        .execute()
    )


# ---------------------------------------------------------------------------
# User-defined providers (profiles.preferences['custom_providers'])
# ---------------------------------------------------------------------------
_SLUG_RE = re.compile(r"[^a-z0-9]+")


def make_custom_id(label: str, existing: set[str]) -> str:
    """Slugify a label into a unique ``custom-*`` provider id."""
    slug = _SLUG_RE.sub("-", (label or "").strip().lower()).strip("-") or "provider"
    candidate = f"custom-{slug}"
    suffix = 2
    while candidate in existing:
        candidate = f"custom-{slug}-{suffix}"
        suffix += 1
    return candidate


def _custom_spec_from_raw(raw: Any) -> ProviderSpec | None:
    if not isinstance(raw, dict):
        return None
    provider_id = str(raw.get("id") or "").strip().lower()
    base_url = str(raw.get("base_url") or "").strip()
    if not provider_id or not base_url:
        return None
    return custom_spec(
        provider_id,
        str(raw.get("label") or provider_id),
        base_url,
        models_path=str(raw.get("models_path") or "/models"),
    )


async def load_custom_specs(client: Any, user_id: str) -> dict[str, ProviderSpec]:
    """Return the user's saved custom providers keyed by id."""
    response = (
        await client.table("profiles")
        .select("preferences")
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    row = (response.data if response else None) or {}
    preferences = row.get("preferences")
    if not isinstance(preferences, dict):
        return {}
    specs: dict[str, ProviderSpec] = {}
    for raw in preferences.get("custom_providers") or []:
        spec = _custom_spec_from_raw(raw)
        if spec is not None:
            specs[spec.id] = spec
    return specs


async def resolve_provider_spec(
    settings: Settings, client: Any, user_id: str, provider_id: str
) -> ProviderSpec | None:
    """Resolve a provider id against the built-in catalog, then user providers."""
    spec = get_provider(provider_id)
    if spec is not None:
        return spec
    custom = await load_custom_specs(client, user_id)
    return custom.get((provider_id or "").strip().lower())


async def resolve_api_key(
    settings: Settings, client: Any, user_id: str, spec: ProviderSpec
) -> tuple[str, str]:
    """Return ``(api_key, source)`` where source is ``user`` / ``env`` / ``none``.

    A per-user key always wins over the server env key so a user can point a
    provider at their own account without redeploying.
    """
    row = await load_user_key_row(client, user_id, spec.id)
    if row and row.get("secret"):
        try:
            return decrypt_secret(settings, row["secret"]), "user"
        except Exception:  # noqa: BLE001 - fall through to env on decrypt failure
            pass
    env_key = env_api_key(settings, spec)
    if env_key:
        return env_key, "env"
    return "", "none"


# ---------------------------------------------------------------------------
# Live model listings (short in-process cache)
# ---------------------------------------------------------------------------
_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}


def _fingerprint(api_key: str) -> str:
    return f"{len(api_key)}:{api_key[-4:]}" if api_key else "none"


def _coerce_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_pricing(raw: Any) -> dict[str, float] | None:
    if not isinstance(raw, dict):
        return None
    pricing: dict[str, float] = {}
    for key in ("prompt", "completion", "request", "image"):
        number = _coerce_float(raw.get(key))
        if number is not None:
            pricing[key] = number
    return pricing or None


def normalize_model(spec: ProviderSpec, raw: dict[str, Any]) -> dict[str, Any]:
    """Map a provider model record into the UI's uniform shape."""
    model_id = str(raw.get("id") or raw.get("name") or "").strip()
    name = str(raw.get("name") or model_id)
    context = (
        raw.get("context_length")
        or raw.get("context_window")
        or (raw.get("top_provider") or {}).get("context_length")
    )
    try:
        context_window = int(context) if context else None
    except (TypeError, ValueError):
        context_window = None

    architecture = raw.get("architecture") or {}
    modalities = architecture.get("input_modalities")
    if not isinstance(modalities, list) or not modalities:
        modalities = raw.get("input_modalities")
    modalities = [str(item) for item in modalities] if isinstance(modalities, list) else []
    if not modalities:
        modalities = ["text"]

    pricing = _normalize_pricing(raw.get("pricing"))
    free = bool(pricing) and all(value == 0 for value in pricing.values())

    tags: list[str] = []
    if free:
        tags.append("free")
    lowered = model_id.lower()
    if "vision" in lowered or "image" in modalities:
        tags.append("vision")
    if "audio" in modalities or "voice" in lowered:
        tags.append("audio")

    return {
        "id": model_id,
        "name": name,
        "context_window": context_window,
        "modalities": modalities,
        "pricing": pricing,
        "free": free,
        "tags": tags,
    }


class ProviderRequestError(RuntimeError):
    """Raised when the provider rejects a models/ping request."""

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


def provider_ready(settings: Settings, spec: ProviderSpec) -> str | None:
    """Return an error message when a provider is not fully configured."""
    if spec.templated_base_url and "{account_id}" in provider_base_url(settings, spec):
        return (
            f"{spec.label} butuh {spec.id.upper()}_ACCOUNT_ID diatur di env server."
        )
    return None


def _fallback_models(spec: ProviderSpec) -> list[dict[str, Any]]:
    """Curated models for a provider with no ``/models`` listing.

    Marked free (zero pricing) because they fall under the provider's free
    allocation; over-quota usage is billed by the provider.
    """
    return [
        normalize_model(
            spec,
            {
                "id": model_id,
                "name": model_id,
                "pricing": {"prompt": 0, "completion": 0},
            },
        )
        for model_id in spec.fallback_models
    ]


async def fetch_models(
    settings: Settings,
    spec: ProviderSpec,
    api_key: str,
    *,
    force: bool = False,
) -> tuple[list[dict[str, Any]], bool]:
    """Fetch and normalize a provider's models. Returns ``(models, cached)``."""
    not_ready = provider_ready(settings, spec)
    if not_ready:
        raise ProviderRequestError(not_ready)
    base = provider_base_url(settings, spec)
    cache_key = f"{spec.id}:{base}:{_fingerprint(api_key)}"
    now = time.monotonic()
    cached = _cache.get(cache_key)
    if (
        not force
        and cached
        and now - cached[0] < max(settings.provider_models_cache_seconds, 0)
    ):
        return cached[1], True

    headers = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        async with httpx.AsyncClient(timeout=settings.provider_ping_timeout) as client:
            response = await client.get(f"{base}{spec.models_path}", headers=headers)
    except httpx.HTTPError as exc:
        raise ProviderRequestError(f"Tidak bisa menghubungi {spec.label}: {exc}") from exc
    if response.status_code in (404, 405) and spec.fallback_models:
        models = _fallback_models(spec)
        _cache[cache_key] = (now, models)
        return models, False
    if response.status_code >= 400:
        raise ProviderRequestError(
            f"{spec.label} menolak permintaan model ({response.status_code}). "
            "Periksa API key.",
            status_code=response.status_code,
        )
    data = response.json()
    records = data.get("data") if isinstance(data, dict) else data
    if not isinstance(records, list):
        records = []
    models = [normalize_model(spec, item) for item in records if isinstance(item, dict)]
    models = [model for model in models if model["id"]]
    models.sort(key=lambda model: (not model["free"], model["id"]))
    _cache[cache_key] = (now, models)
    return models, False


async def ping(
    settings: Settings, spec: ProviderSpec, api_key: str
) -> dict[str, Any]:
    """Lightweight connectivity/auth check against the models endpoint."""
    base = provider_base_url(settings, spec)
    headers = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    not_ready = provider_ready(settings, spec)
    if not_ready:
        return {"ok": False, "detail": not_ready}
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=settings.provider_ping_timeout) as client:
            response = await client.get(f"{base}{spec.models_path}", headers=headers)
    except httpx.HTTPError as exc:
        return {"ok": False, "detail": f"Tidak bisa menghubungi {spec.label}: {exc}"}
    latency_ms = int((time.perf_counter() - started) * 1000)
    if response.status_code in (404, 405) and spec.fallback_models:
        return {
            "ok": True,
            "status": response.status_code,
            "latency_ms": latency_ms,
            "detail": "Terhubung (listing model tak tersedia; memakai daftar tetap).",
        }
    if response.status_code in (401, 403):
        return {
            "ok": False,
            "status": response.status_code,
            "latency_ms": latency_ms,
            "detail": "Terhubung, tapi API key ditolak. Periksa key.",
        }
    if response.status_code >= 400:
        return {
            "ok": False,
            "status": response.status_code,
            "latency_ms": latency_ms,
            "detail": f"Provider membalas {response.status_code}.",
        }
    return {
        "ok": True,
        "status": response.status_code,
        "latency_ms": latency_ms,
        "detail": "Terhubung.",
    }


# ---------------------------------------------------------------------------
# Recommendations (heuristic, provider-agnostic)
# ---------------------------------------------------------------------------
_PREFERRED_HINTS = (
    "gpt-oss",
    "llama",
    "qwen",
    "deepseek",
    "gpt-4o",
    "claude",
    "gemini",
    "mistral",
)


def recommend_models(
    models: list[dict[str, Any]], limit: int = 6
) -> list[dict[str, Any]]:
    """Rank models for chat: prefer free + large context + known-good families."""

    def score(model: dict[str, Any]) -> tuple:
        name = model["id"].lower()
        family = any(hint in name for hint in _PREFERRED_HINTS)
        context = model.get("context_window") or 0
        return (
            0 if model.get("free") else 1,
            0 if family else 1,
            -context,
        )

    ranked = sorted(models, key=score)
    picks: list[dict[str, Any]] = []
    for model in ranked[:limit]:
        reasons: list[str] = []
        if model.get("free"):
            reasons.append("gratis")
        if (model.get("context_window") or 0) >= 100_000:
            reasons.append("konteks besar")
        if any(hint in model["id"].lower() for hint in _PREFERRED_HINTS):
            reasons.append("keluarga model populer")
        if "vision" in model.get("tags", []):
            reasons.append("dukung gambar")
        picks.append(
            {
                "model": model["id"],
                "reason": ", ".join(reasons) or "serbaguna",
                "tags": model.get("tags", []),
                "free": model.get("free", False),
            }
        )
    return picks
