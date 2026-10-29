"""Crawl provider orchestration.

Picks the provider for a crawl, enforces the Firecrawl credit cap, and falls
back to the built-in httpx parser when Firecrawl is unavailable. URL validation
and the SSRF guard run before any provider call (in the route, via
``normalize_url``); Firecrawl errors never surface raw to the user.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from supabase import AsyncClient

from app.config import Settings
from app.services.crawl_usage_service import get_crawl_usage, record_crawl
from app.services.crawlers import firecrawl, httpx_crawler
from app.services.web_crawler import CrawledPage, CrawlError

FALLBACK_NOTICE = "Firecrawl tidak tersedia, memakai parser bawaan."
QUOTA_NOTICE = "Batas kuota Firecrawl tercapai, memakai parser bawaan."
UNCONFIGURED_NOTICE = (
    "Firecrawl belum dikonfigurasi di server, memakai parser bawaan."
)

VALID_PROVIDERS = ("httpx", "firecrawl")


@dataclass
class CrawlOutcome:
    page: CrawledPage
    provider: str
    fallback_used: bool = False
    notice: str | None = None
    credits: int = 0


def resolve_provider(settings: Settings, override: str | None = None) -> str:
    """Return the effective provider, clamped to a known value."""
    chosen = (override or settings.crawl_provider or "httpx").strip().lower()
    return chosen if chosen in VALID_PROVIDERS else "httpx"


def provider_from_preferences(preferences: Any) -> str | None:
    """Read the per-user crawl provider from ``profiles.preferences``."""
    if isinstance(preferences, dict):
        crawl_pref = preferences.get("crawl")
        if isinstance(crawl_pref, dict):
            value = str(crawl_pref.get("provider") or "").strip().lower()
            if value in VALID_PROVIDERS:
                return value
    return None


async def resolve_user_provider(
    client: AsyncClient, user_id: str, settings: Settings
) -> str:
    """Effective provider for a user: their preference, else the server default."""
    try:
        response = (
            await client.table("profiles")
            .select("preferences")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
    except Exception:  # noqa: BLE001 - fall back to the server default
        return resolve_provider(settings)
    row = (response.data if response else None) or {}
    override = provider_from_preferences(row.get("preferences"))
    return resolve_provider(settings, override)


def firecrawl_ready(settings: Settings) -> bool:
    """True when Firecrawl can be called with the current configuration.

    Cloud requires a key. Self-host may run without auth, but only when
    ``firecrawl_allow_empty_key`` is set explicitly.
    """
    if not (settings.firecrawl_base_url or "").strip():
        return False
    if settings.firecrawl_api_key:
        return True
    return settings.firecrawl_allow_empty_key


async def _crawl_httpx(url: str, *, settings: Settings) -> CrawlOutcome:
    page = await httpx_crawler.fetch_page(
        url,
        timeout=settings.research_fetch_timeout,
        max_bytes=settings.research_max_bytes,
    )
    return CrawlOutcome(page=page, provider="httpx")


async def _fallback(
    url: str, *, settings: Settings, notice: str
) -> CrawlOutcome:
    page = await httpx_crawler.fetch_page(
        url,
        timeout=settings.research_fetch_timeout,
        max_bytes=settings.research_max_bytes,
    )
    return CrawlOutcome(
        page=page,
        provider="httpx",
        fallback_used=True,
        notice=notice,
    )


async def crawl(
    url: str,
    *,
    settings: Settings,
    client: AsyncClient | None = None,
    user_id: str | None = None,
    provider: str | None = None,
) -> CrawlOutcome:
    """Crawl ``url`` with the resolved provider and return a ``CrawlOutcome``."""
    chosen = resolve_provider(settings, provider)
    if chosen != "firecrawl":
        return await _crawl_httpx(url, settings=settings)

    if not firecrawl_ready(settings):
        return await _fallback(url, settings=settings, notice=UNCONFIGURED_NOTICE)

    if client is not None:
        usage = await get_crawl_usage(client)
        if (
            usage.day_credits >= settings.firecrawl_daily_credits
            or usage.month_credits >= settings.firecrawl_monthly_credits
        ):
            return await _fallback(url, settings=settings, notice=QUOTA_NOTICE)

    async def _record(*, credits: int, status: str, code: str) -> None:
        if client is not None and user_id is not None:
            await record_crawl(
                client,
                user_id,
                provider="firecrawl",
                url=url,
                credits=credits,
                status=status,
                code=code,
            )

    try:
        result = await firecrawl.scrape(url, settings=settings)
    except firecrawl.FirecrawlAuthError as exc:
        # Bad key / terms: surface a clear message, do not silently fall back.
        await _record(credits=0, status="error", code="auth")
        raise CrawlError(str(exc)) from exc
    except firecrawl.FirecrawlQuotaError as exc:
        await _record(credits=0, status="error", code="quota")
        return await _fallback(url, settings=settings, notice=FALLBACK_NOTICE)
    except firecrawl.FirecrawlUnavailableError as exc:
        await _record(credits=0, status="error", code="unavailable")
        return await _fallback(url, settings=settings, notice=FALLBACK_NOTICE)

    await _record(credits=result.credits, status="success", code="")
    return CrawlOutcome(
        page=result.page,
        provider="firecrawl",
        credits=result.credits,
    )


async def crawl_settings_snapshot(
    settings: Settings,
    client: AsyncClient | None = None,
    provider_override: str | None = None,
) -> dict[str, Any]:
    """Status payload for the settings UI (effective provider + quota usage)."""
    snapshot: dict[str, Any] = {
        "provider": resolve_provider(settings, provider_override),
        "firecrawl_ready": firecrawl_ready(settings),
        "firecrawl_key_configured": bool(settings.firecrawl_api_key),
        "firecrawl_base_url": settings.firecrawl_base_url,
        "daily_limit": settings.firecrawl_daily_credits,
        "monthly_limit": settings.firecrawl_monthly_credits,
        "daily_used": 0,
        "monthly_used": 0,
    }
    if client is not None:
        usage = await get_crawl_usage(client)
        snapshot["daily_used"] = usage.day_credits
        snapshot["monthly_used"] = usage.month_credits
    return snapshot
