"""Per-feature roles, skills & instruction settings (Settings page).

Exposes the full feature catalog (preset roles/skills as suggestions + current
free-text selections) and persists selections into ``profiles.preferences``.

Storage layout in ``profiles.preferences``:
- chat modes: ``chat_modes[mode] = {roles, skills, instruction, behavior}``
- other features: ``feature_settings[feature] = {roles, skills, instruction, behavior}``
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.chat_modes import catalog as chat_catalog
from app.config import Settings, get_settings
from app.deps import CurrentUser, rate_limit, read_rate_limit
from app.feature_catalog import (
    ALL_FEATURES,
    catalog_for_ui,
    chat_mode_of,
    get_spec,
    is_chat_feature,
    resolve_feature_settings,
)
from app.schemas import FeatureSettingsUpdate, SkillSummary
from app.services.crawl_provider import (
    crawl_settings_snapshot,
    provider_from_preferences,
)
from app.services.skill_service import (
    SkillValidationError,
    all_feature_skill_ids,
    feature_skill_counts,
    list_skills,
    set_feature_skills,
)

router = APIRouter(prefix="/api/feature-settings", tags=["feature-settings"])


def _require_feature(feature: str) -> None:
    if feature not in ALL_FEATURES:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Fitur tidak dikenal.")


async def _load_preferences(client: Any, user_id: str) -> dict[str, Any]:
    response = (
        await client.table("profiles")
        .select("preferences")
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    preferences = (response.data if response else None) or {}
    value = preferences.get("preferences")
    return value if isinstance(value, dict) else {}


async def _save_preferences(client: Any, user_id: str, preferences: dict[str, Any]) -> None:
    await (
        client.table("profiles")
        .update({"preferences": preferences})
        .eq("id", user_id)
        .execute()
    )


@router.get("")
async def get_feature_settings(
    user: CurrentUser = Depends(read_rate_limit),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    preferences = await _load_preferences(user.client, user.id)
    selected = {
        feature: resolve_feature_settings(preferences, feature)
        for feature in ALL_FEATURES
    }
    skills = await list_skills(user.client, user.id)
    assignments = await all_feature_skill_ids(user.client, user.id)
    counts = await feature_skill_counts(user.client, user.id)
    return {
        "features": catalog_for_ui(selected),
        "commands": chat_catalog().get("commands", {}),
        "skills": [SkillSummary(**row) for row in skills],
        "assignments": assignments,
        "skill_counts": counts,
        "crawl": await crawl_settings_snapshot(
            settings, user.client, provider_from_preferences(preferences)
        ),
    }


@router.put("/{feature}")
async def update_feature_settings(
    feature: str,
    payload: FeatureSettingsUpdate,
    user: CurrentUser = Depends(rate_limit),
) -> dict[str, Any]:
    _require_feature(feature)
    spec = get_spec(feature) or {}

    behavior = payload.behavior.strip()
    valid_behaviors = {str(item["id"]) for item in spec.get("behaviors") or []}
    if behavior and behavior not in valid_behaviors:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Alur perilaku tidak dikenal.")

    values = {
        "roles": payload.roles.strip(),
        # Legacy free-text skills are kept for backward compatibility but the new
        # UI writes assignments to feature_skills instead.
        "skills": payload.skills.strip(),
        "instruction": payload.instruction.strip(),
        "behavior": behavior,
    }

    # Validate + persist assignments before touching preferences so a bad skill id
    # never leaves the feature in a half-saved state.
    try:
        skill_ids = await set_feature_skills(
            user.client, user.id, feature, payload.skill_ids
        )
    except SkillValidationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    preferences = await _load_preferences(user.client, user.id)
    if is_chat_feature(feature):
        mode = chat_mode_of(feature)
        chat_modes = preferences.get("chat_modes")
        if not isinstance(chat_modes, dict):
            chat_modes = {}
        chat_modes[mode] = values
        preferences["chat_modes"] = chat_modes
    else:
        container = preferences.get("feature_settings")
        if not isinstance(container, dict):
            container = {}
        container[feature] = values
        preferences["feature_settings"] = container

    await _save_preferences(user.client, user.id, preferences)
    return {
        "feature": feature,
        "selected": resolve_feature_settings(preferences, feature),
        "skill_ids": skill_ids,
    }