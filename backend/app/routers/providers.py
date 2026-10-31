"""LLM provider settings: key management, live models, ping, quota, picks.

Keys entered in the UI are encrypted at rest and never returned; only a masked
form is sent back. The active provider/model lives in
``profiles.preferences['llm']``. Model metadata comes live from the provider and
is cached briefly in-process (see ``services.provider_registry``).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.config import Settings, get_settings
from app.deps import CurrentUser, rate_limit, read_rate_limit
from app.llm import get_rate_limits
from app.provider_catalog import (
    PROVIDERS,
    ProviderSpec,
    custom_spec,
    env_api_key,
    provider_base_url,
)
from app.schemas import (
    LLMQuotaOut,
    ProviderCreate,
    ProviderImageSelectionUpdate,
    ProviderKeyUpdate,
    ProviderModelOut,
    ProviderModelsOut,
    ProviderOut,
    ProviderPingOut,
    ProviderRecommendationOut,
    ProviderRecommendationsOut,
    ProviderSelectionUpdate,
)
from app.services.provider_crypto import (
    encrypt_secret,
    encryption_available,
    mask_key,
)
from app.services.image_service import load_image_preference
from app.services.provider_registry import (
    ProviderRequestError,
    delete_user_key,
    fetch_models,
    load_custom_specs,
    load_user_key_map,
    make_custom_id,
    ping,
    recommend_models,
    resolve_api_key,
    resolve_provider_spec,
    save_user_key,
)
from app.services.usage_service import get_usage

router = APIRouter(prefix="/api/providers", tags=["providers"])


# ---------------------------------------------------------------------------
# Preferences helpers (profiles.preferences['llm'])
# ---------------------------------------------------------------------------
async def _load_preferences(client: Any, user_id: str) -> dict[str, Any]:
    response = (
        await client.table("profiles")
        .select("preferences")
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    row = (response.data if response else None) or {}
    value = row.get("preferences")
    return value if isinstance(value, dict) else {}


async def _save_llm_pref(
    client: Any, user_id: str, *, provider: str, model: str
) -> None:
    preferences = await _load_preferences(client, user_id)
    preferences["llm"] = {"provider": provider, "model": model}
    await client.table("profiles").update({"preferences": preferences}).eq(
        "id", user_id
    ).execute()


async def _save_image_pref(
    client: Any, user_id: str, *, provider: str, model: str
) -> None:
    preferences = await _load_preferences(client, user_id)
    preferences["llm_image"] = {"provider": provider, "model": model}
    await client.table("profiles").update({"preferences": preferences}).eq(
        "id", user_id
    ).execute()


def _image_selection(
    preferences: dict[str, Any], settings: Settings
) -> tuple[str, str]:
    value = preferences.get("llm_image")
    if isinstance(value, dict):
        provider = str(value.get("provider") or "").strip()
        model = str(value.get("model") or "").strip()
        if provider:
            return provider, model
    return (settings.image_provider or "openrouter"), (settings.image_model or "")


def _custom_rows(preferences: dict[str, Any]) -> list[dict[str, Any]]:
    rows = preferences.get("custom_providers")
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


async def _save_custom_rows(
    client: Any, user_id: str, rows: list[dict[str, Any]]
) -> None:
    preferences = await _load_preferences(client, user_id)
    preferences["custom_providers"] = rows
    await client.table("profiles").update({"preferences": preferences}).eq(
        "id", user_id
    ).execute()


def _active_selection(
    preferences: dict[str, Any], settings: Settings
) -> tuple[str, str]:
    llm = preferences.get("llm")
    if isinstance(llm, dict):
        provider = str(llm.get("provider") or "").strip()
        model = str(llm.get("model") or "").strip()
        if provider:
            return provider, model
    return (settings.llm_provider or "groq"), (settings.llm_model or "")


def _to_out(
    spec: ProviderSpec,
    settings: Settings,
    *,
    user_row: dict[str, Any] | None,
    active: bool,
    selected_model: str,
    image_active: bool = False,
    image_model: str = "",
) -> ProviderOut:
    env_ok = bool(env_api_key(settings, spec))
    user_ok = bool(user_row)
    key_source = "user" if user_ok else ("env" if env_ok else "none")
    return ProviderOut(
        id=spec.id,
        label=spec.label,
        base_url=provider_base_url(settings, spec),
        docs_url=spec.docs_url,
        notes=spec.notes,
        env_key=env_ok,
        user_key=user_ok,
        key_source=key_source,
        key_masked=(user_row or {}).get("masked", "") if user_ok else "",
        rich_metadata=spec.rich_metadata,
        active=active,
        selected_model=selected_model if active else "",
        custom=spec.id not in {item.id for item in PROVIDERS},
        active_image=image_active,
        selected_image_model=image_model if image_active else "",
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("", response_model=list[ProviderOut])
async def list_providers(
    user: CurrentUser = Depends(read_rate_limit),
    settings: Settings = Depends(get_settings),
) -> list[ProviderOut]:
    key_map = await load_user_key_map(user.client, user.id)
    preferences = await _load_preferences(user.client, user.id)
    active_id, active_model = _active_selection(preferences, settings)
    image_id, image_model = _image_selection(preferences, settings)
    custom_specs = await load_custom_specs(user.client, user.id)
    specs = [*PROVIDERS, *custom_specs.values()]
    return [
        _to_out(
            spec,
            settings,
            user_row=key_map.get(spec.id),
            active=spec.id == active_id,
            selected_model=active_model,
            image_active=spec.id == image_id,
            image_model=image_model,
        )
        for spec in specs
    ]


@router.put("/image-selection", response_model=ProviderOut)
async def update_image_selection(
    payload: ProviderImageSelectionUpdate,
    user: CurrentUser = Depends(rate_limit),
    settings: Settings = Depends(get_settings),
) -> ProviderOut:
    """Set the provider/model used for image generation."""
    spec = await resolve_provider_spec(
        settings, user.client, user.id, payload.provider
    )
    if spec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Provider tidak dikenal.")
    await _save_image_pref(
        user.client, user.id, provider=spec.id, model=payload.model.strip()
    )
    key_map = await load_user_key_map(user.client, user.id)
    preferences = await _load_preferences(user.client, user.id)
    active_id, active_model = _active_selection(preferences, settings)
    return _to_out(
        spec,
        settings,
        user_row=key_map.get(spec.id),
        active=spec.id == active_id,
        selected_model=active_model,
        image_active=True,
        image_model=payload.model.strip(),
    )


@router.post("", response_model=ProviderOut, status_code=status.HTTP_201_CREATED)
async def create_provider(
    payload: ProviderCreate,
    user: CurrentUser = Depends(rate_limit),
    settings: Settings = Depends(get_settings),
) -> ProviderOut:
    """Add a user-defined OpenAI-compatible provider (custom base URL)."""
    preferences = await _load_preferences(user.client, user.id)
    rows = _custom_rows(preferences)
    existing = {item.id for item in PROVIDERS} | {
        str(row.get("id") or "").strip().lower() for row in rows
    }
    provider_id = make_custom_id(payload.label, existing)
    base_url = payload.base_url.strip()
    if not base_url.startswith(("http://", "https://")):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Base URL harus diawali http:// atau https://.",
        )
    rows.append(
        {"id": provider_id, "label": payload.label.strip(), "base_url": base_url}
    )
    await _save_custom_rows(user.client, user.id, rows)

    api_key = payload.api_key.strip()
    if api_key:
        if not encryption_available(settings):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="APP_ENCRYPTION_KEY belum diatur, jadi API key tidak bisa disimpan.",
            )
        await save_user_key(
            user.client,
            user.id,
            provider_id,
            encrypt_secret(settings, api_key),
            mask_key(api_key),
        )
    await _save_llm_pref(
        user.client, user.id, provider=provider_id, model=payload.model.strip()
    )
    key_map = await load_user_key_map(user.client, user.id)
    spec = custom_spec(provider_id, payload.label.strip(), base_url)
    return _to_out(
        spec,
        settings,
        user_row=key_map.get(provider_id),
        active=True,
        selected_model=payload.model.strip(),
    )


@router.delete("/{provider_id}", response_model=dict)
async def delete_provider(
    provider_id: str,
    user: CurrentUser = Depends(rate_limit),
) -> dict[str, bool]:
    """Delete a user-defined provider and its stored key."""
    preferences = await _load_preferences(user.client, user.id)
    rows = _custom_rows(preferences)
    target = provider_id.strip().lower()
    remaining = [row for row in rows if str(row.get("id") or "").strip().lower() != target]
    if len(remaining) == len(rows):
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="Provider custom tidak ditemukan atau bukan milikmu.",
        )
    await _save_custom_rows(user.client, user.id, remaining)
    await delete_user_key(user.client, user.id, target)
    return {"ok": True}


@router.put("/selection", response_model=ProviderOut)
async def update_selection(
    payload: ProviderSelectionUpdate,
    user: CurrentUser = Depends(rate_limit),
    settings: Settings = Depends(get_settings),
) -> ProviderOut:
    spec = await resolve_provider_spec(settings, user.client, user.id, payload.provider)
    if spec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Provider tidak dikenal.")
    await _save_llm_pref(
        user.client, user.id, provider=spec.id, model=payload.model.strip()
    )
    key_map = await load_user_key_map(user.client, user.id)
    return _to_out(
        spec,
        settings,
        user_row=key_map.get(spec.id),
        active=True,
        selected_model=payload.model.strip(),
    )


@router.put("/{provider_id}/key", response_model=ProviderOut)
async def set_provider_key(
    provider_id: str,
    payload: ProviderKeyUpdate,
    user: CurrentUser = Depends(rate_limit),
    settings: Settings = Depends(get_settings),
) -> ProviderOut:
    spec = await resolve_provider_spec(settings, user.client, user.id, provider_id)
    if spec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Provider tidak dikenal.")
    if not encryption_available(settings):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="APP_ENCRYPTION_KEY belum diatur di server, jadi API key tidak bisa disimpan aman.",
        )
    token = encrypt_secret(settings, payload.api_key.strip())
    await save_user_key(
        user.client, user.id, spec.id, token, mask_key(payload.api_key.strip())
    )
    # Entering a key implies this is the provider the user wants to use.
    await _save_llm_pref(
        user.client, user.id, provider=spec.id, model=payload.model.strip()
    )
    key_map = await load_user_key_map(user.client, user.id)
    return _to_out(
        spec,
        settings,
        user_row=key_map.get(spec.id),
        active=True,
        selected_model=payload.model.strip(),
    )


@router.delete("/{provider_id}/key", response_model=ProviderOut)
async def remove_provider_key(
    provider_id: str,
    user: CurrentUser = Depends(rate_limit),
    settings: Settings = Depends(get_settings),
) -> ProviderOut:
    spec = await resolve_provider_spec(settings, user.client, user.id, provider_id)
    if spec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Provider tidak dikenal.")
    await delete_user_key(user.client, user.id, spec.id)
    preferences = await _load_preferences(user.client, user.id)
    active_id, active_model = _active_selection(preferences, settings)
    return _to_out(
        spec,
        settings,
        user_row=None,
        active=spec.id == active_id,
        selected_model=active_model,
    )


@router.get("/{provider_id}/models", response_model=ProviderModelsOut)
async def list_provider_models(
    provider_id: str,
    user: CurrentUser = Depends(read_rate_limit),
    settings: Settings = Depends(get_settings),
    force: bool = Query(default=False),
) -> ProviderModelsOut:
    spec = await resolve_provider_spec(settings, user.client, user.id, provider_id)
    if spec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Provider tidak dikenal.")
    api_key, source = await resolve_api_key(settings, user.client, user.id, spec)
    if source == "none":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"API key {spec.label} belum diatur. Isi di tab Provider.",
        )
    try:
        models, cached = await fetch_models(settings, spec, api_key, force=force)
    except ProviderRequestError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, detail=str(exc)
        ) from exc
    return ProviderModelsOut(
        provider=spec.id,
        label=spec.label,
        cached=cached,
        count=len(models),
        models=[ProviderModelOut(**model) for model in models],
    )


@router.get("/{provider_id}/recommendations", response_model=ProviderRecommendationsOut)
async def provider_recommendations(
    provider_id: str,
    user: CurrentUser = Depends(read_rate_limit),
    settings: Settings = Depends(get_settings),
) -> ProviderRecommendationsOut:
    spec = await resolve_provider_spec(settings, user.client, user.id, provider_id)
    if spec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Provider tidak dikenal.")
    api_key, source = await resolve_api_key(settings, user.client, user.id, spec)
    if source == "none":
        return ProviderRecommendationsOut(provider=spec.id, label=spec.label)
    try:
        models, _ = await fetch_models(settings, spec, api_key)
    except ProviderRequestError:
        return ProviderRecommendationsOut(provider=spec.id, label=spec.label)
    picks = recommend_models(models)
    return ProviderRecommendationsOut(
        provider=spec.id,
        label=spec.label,
        recommendations=[ProviderRecommendationOut(**pick) for pick in picks],
    )


@router.post("/{provider_id}/ping", response_model=ProviderPingOut)
async def ping_provider(
    provider_id: str,
    user: CurrentUser = Depends(rate_limit),
    settings: Settings = Depends(get_settings),
) -> ProviderPingOut:
    spec = await resolve_provider_spec(settings, user.client, user.id, provider_id)
    if spec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Provider tidak dikenal.")
    api_key, _ = await resolve_api_key(settings, user.client, user.id, spec)
    result = await ping(settings, spec, api_key)
    return ProviderPingOut(**result)


@router.get("/{provider_id}/quota", response_model=LLMQuotaOut)
async def provider_quota(
    provider_id: str,
    user: CurrentUser = Depends(read_rate_limit),
    settings: Settings = Depends(get_settings),
) -> LLMQuotaOut:
    spec = await resolve_provider_spec(settings, user.client, user.id, provider_id)
    if spec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Provider tidak dikenal.")
    window = await get_usage(user.client)
    preferences = await _load_preferences(user.client, user.id)
    _, active_model = _active_selection(preferences, settings)
    return LLMQuotaOut(
        provider=spec.id,
        model=active_model,
        minute_tokens=window.minute_tokens,
        minute_limit=max(settings.model_tpm_limit, 0),
        day_tokens=window.day_tokens,
        day_limit=max(settings.model_daily_token_limit, 0),
        day_reset_at=window.day_reset_at,
        rate_limit=get_rate_limits(spec.id),
    )
