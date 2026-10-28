"""Supabase client for the single owner.

The app runs in single-user mode. RLS stays enabled but all ``auth.uid()``
policies are dropped (see ``20260101000004_single_user.sql``), so the anon role
is denied while the backend service role has full access. Every row belongs to
one fixed owner id, so the backend uses the service-role client directly.
"""

from __future__ import annotations

from functools import lru_cache

from supabase import AsyncClient, acreate_client

from app.config import get_settings


@lru_cache
def _settings():
    return get_settings()


# Module-level cache: one shared service-role client for the process.
_client: AsyncClient | None = None


async def get_owner_client() -> AsyncClient:
    """Return the cached service-role Supabase client used for all user data."""
    global _client
    if _client is None:
        settings = _settings()
        _client = await acreate_client(
            settings.supabase_url, settings.supabase_service_role_key
        )
    return _client
