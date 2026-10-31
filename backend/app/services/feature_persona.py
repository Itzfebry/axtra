"""Load per-feature persona blocks (role + active skills + instruction).

Preset roles/skills live in :mod:`app.feature_catalog` (suggestions only); the
owner's role/instruction selections are free-text fields in
``profiles.preferences`` and skills are structured rows assigned through
``feature_skills``. This module is the single read path used by every AI
feature so the Settings page stays authoritative.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from supabase import AsyncClient

from app.config import get_settings
from app.feature_catalog import persona_from_settings, resolve_feature_settings
from app.services.skill_service import compose_skill_block, load_active_skills

logger = logging.getLogger("axtra.skills")


async def _load_preferences(
    client: AsyncClient, user_id: str
) -> dict[str, Any]:
    try:
        response = (
            await client.table("profiles")
            .select("preferences")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
    except Exception:  # noqa: BLE001
        return {}
    if not response or not response.data:
        return {}
    preferences = response.data.get("preferences")
    return preferences if isinstance(preferences, dict) else {}


async def _load_skills(
    client: AsyncClient, user_id: str, feature: str
) -> list[dict[str, Any]]:
    try:
        return await load_active_skills(client, user_id, feature)
    except Exception as exc:  # noqa: BLE001 - persona must never break a request
        logger.warning("Gagal memuat skill untuk %s: %s", feature, exc)
        return []


async def load_feature_persona(
    client: AsyncClient,
    feature: str,
    *,
    user_id: str | None = None,
    preferences: dict[str, Any] | None = None,
) -> str:
    """Build the persona block for ``feature`` (empty string when unset)."""
    settings = get_settings()
    owner = user_id or settings.owner_user_id

    if preferences is None:
        preferences, skills = await asyncio.gather(
            _load_preferences(client, owner),
            _load_skills(client, owner, feature),
        )
    else:
        skills = await _load_skills(client, owner, feature)

    resolved = resolve_feature_settings(preferences, feature)
    block = compose_skill_block(
        skills,
        max_chars=settings.skill_max_chars,
        max_total=settings.skills_max_total_chars,
        max_count=settings.skills_max_per_feature,
    )
    if block:
        # Structured skills supersede the legacy free-text skill field.
        resolved["skills"] = ""
    return persona_from_settings(feature, resolved, block)