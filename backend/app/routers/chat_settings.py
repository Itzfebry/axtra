"""Per-mode persona settings (role, behavior, note) for the chat modes.

The catalog gives the UI its presets and slash commands; the PUT merges the
owner's selection into ``profiles.preferences['chat_modes']``.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.chat_modes import (
    MODE_BEHAVIOR_PRESETS,
    MODE_ROLE_PRESETS,
    VALID_MODES,
    catalog,
    resolve_mode_settings,
)
from app.deps import CurrentUser, rate_limit, read_rate_limit
from app.schemas import ChatModeSettingsUpdate

router = APIRouter(prefix="/api/chat-settings", tags=["chat-settings"])


def _selected(preferences: Any) -> dict[str, dict[str, Any]]:
    return {
        mode: resolve_mode_settings(preferences, mode) for mode in VALID_MODES
    }


@router.get("")
async def get_chat_settings(user: CurrentUser = Depends(read_rate_limit)) -> dict[str, Any]:
    response = (
        await user.client.table("profiles")
        .select("preferences")
        .eq("id", user.id)
        .single()
        .execute()
    )
    preferences = (response.data or {}).get("preferences") or {}
    data = catalog()
    data["selected"] = _selected(preferences)
    return data


@router.put("")
async def update_chat_settings(
    payload: ChatModeSettingsUpdate,
    user: CurrentUser = Depends(rate_limit),
) -> dict[str, Any]:
    mode = payload.mode
    valid_roles = {item["id"] for item in MODE_ROLE_PRESETS.get(mode, [])}
    roles = list(dict.fromkeys(str(role) for role in payload.roles))
    if not roles or any(role not in valid_roles for role in roles):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Role tidak dikenal.")
    if payload.behavior not in {
        item["id"] for item in MODE_BEHAVIOR_PRESETS.get(mode, [])
    }:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Perilaku tidak dikenal.")

    response = (
        await user.client.table("profiles")
        .select("preferences")
        .eq("id", user.id)
        .single()
        .execute()
    )
    preferences = (response.data or {}).get("preferences") or {}
    if not isinstance(preferences, dict):
        preferences = {}
    chat_modes = preferences.get("chat_modes")
    if not isinstance(chat_modes, dict):
        chat_modes = {}
    chat_modes[mode] = {
        "roles": roles,
        "role_note": payload.role_note.strip(),
        "behavior": payload.behavior,
    }
    preferences["chat_modes"] = chat_modes

    await (
        user.client.table("profiles")
        .update({"preferences": preferences})
        .eq("id", user.id)
        .execute()
    )

    data = catalog()
    data["selected"] = _selected(preferences)
    return data
