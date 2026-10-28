"""Profile management (personal identity context)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app.deps import CurrentUser, rate_limit, read_rate_limit
from app.schemas import ProfileOut, ProfileUpdate

router = APIRouter(prefix="/api/profile", tags=["profile"])


def _to_out(row: dict[str, Any]) -> ProfileOut:
    return ProfileOut(
        id=row.get("id"),
        display_name=row.get("display_name"),
        timezone=row.get("timezone", "Asia/Jakarta"),
        locale=row.get("locale", "id"),
        communication_style=row.get("communication_style"),
        preferences=row.get("preferences") or {},
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


@router.get("", response_model=ProfileOut)
async def get_profile(user: CurrentUser = Depends(read_rate_limit)) -> ProfileOut:
    client = user.client
    response = (
        await client.table("profiles").select("*").eq("id", user.id).maybe_single().execute()
    )
    if not response or not response.data:
        # Trigger usually creates this; create lazily if missing.
        await client.table("profiles").insert({"id": user.id}).execute()
        response = (
            await client.table("profiles").select("*").eq("id", user.id).maybe_single().execute()
        )
    return _to_out((response.data if response else None) or {})


@router.patch("", response_model=ProfileOut)
async def update_profile(
    payload: ProfileUpdate, user: CurrentUser = Depends(rate_limit)
) -> ProfileOut:
    patch = payload.model_dump(exclude_unset=True, exclude_none=True)
    if patch:
        await (
            user.client.table("profiles").update(patch).eq("id", user.id).execute()
        )
    response = (
        await user.client.table("profiles").select("*").eq("id", user.id).maybe_single().execute()
    )
    return _to_out((response.data if response else None) or {})
