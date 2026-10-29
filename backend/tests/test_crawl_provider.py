"""Tests for crawl provider selection and the httpx fallback paths."""

from __future__ import annotations

import pytest

from app.config import Settings
from app.services import crawl_provider
from app.services.crawl_provider import (
    FALLBACK_NOTICE,
    QUOTA_NOTICE,
    UNCONFIGURED_NOTICE,
    crawl,
)
from app.services.crawlers import firecrawl, httpx_crawler
from app.services.web_crawler import CrawledPage, CrawlError

_FAKE_PAGE = CrawledPage(
    url="https://example.com/a",
    title="Contoh",
    site="example.com",
    text="isi",
    format="text",
)


def _settings(**overrides: object) -> Settings:
    base: dict[str, object] = {
        "crawl_provider": "firecrawl",
        "firecrawl_api_key": "test-key",
        "firecrawl_base_url": "https://api.firecrawl.dev",
    }
    base.update(overrides)
    return Settings(_env_file=None, **base)  # type: ignore[arg-type]


def _patch_httpx(monkeypatch: pytest.MonkeyPatch) -> dict[str, int]:
    calls = {"n": 0}

    async def fake_fetch_page(url: str, **_kwargs: object) -> CrawledPage:
        calls["n"] += 1
        return _FAKE_PAGE

    monkeypatch.setattr(httpx_crawler, "fetch_page", fake_fetch_page)
    return calls


async def test_httpx_provider_uses_builtin(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _patch_httpx(monkeypatch)
    outcome = await crawl(
        "https://example.com/a", settings=_settings(crawl_provider="httpx")
    )
    assert outcome.provider == "httpx"
    assert outcome.fallback_used is False
    assert calls["n"] == 1


async def test_firecrawl_auth_error_is_surfaced(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _patch_httpx(monkeypatch)

    async def fake_scrape(*_args: object, **_kwargs: object) -> object:
        raise firecrawl.FirecrawlAuthError("Kunci Firecrawl tidak valid.")

    monkeypatch.setattr(firecrawl, "scrape", fake_scrape)

    with pytest.raises(CrawlError) as excinfo:
        await crawl("https://example.com/a", settings=_settings())

    assert "Firecrawl" in str(excinfo.value)
    # Auth failures must not silently fall back to the built-in parser.
    assert calls["n"] == 0


async def test_firecrawl_quota_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _patch_httpx(monkeypatch)

    async def fake_scrape(*_args: object, **_kwargs: object) -> object:
        raise firecrawl.FirecrawlQuotaError("insufficient_credits")

    monkeypatch.setattr(firecrawl, "scrape", fake_scrape)

    outcome = await crawl("https://example.com/a", settings=_settings())
    assert outcome.provider == "httpx"
    assert outcome.fallback_used is True
    assert outcome.notice == FALLBACK_NOTICE
    assert calls["n"] == 1


async def test_firecrawl_timeout_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _patch_httpx(monkeypatch)

    async def fake_scrape(*_args: object, **_kwargs: object) -> object:
        raise firecrawl.FirecrawlUnavailableError("timeout")

    monkeypatch.setattr(firecrawl, "scrape", fake_scrape)

    outcome = await crawl("https://example.com/a", settings=_settings())
    assert outcome.provider == "httpx"
    assert outcome.fallback_used is True
    assert outcome.notice == FALLBACK_NOTICE
    assert calls["n"] == 1


async def test_firecrawl_unconfigured_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _patch_httpx(monkeypatch)

    async def fake_scrape(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("scrape must not be called when unconfigured")

    monkeypatch.setattr(firecrawl, "scrape", fake_scrape)

    outcome = await crawl(
        "https://example.com/a",
        settings=_settings(firecrawl_api_key=""),
    )
    assert outcome.provider == "httpx"
    assert outcome.fallback_used is True
    assert outcome.notice == UNCONFIGURED_NOTICE
    assert calls["n"] == 1


async def test_firecrawl_daily_quota_blocks_before_calling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = _patch_httpx(monkeypatch)

    async def fake_scrape(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("scrape must not run when the local cap is hit")

    monkeypatch.setattr(firecrawl, "scrape", fake_scrape)

    # Patch get_crawl_usage with a stub returning an exhausted window.
    from app.services.crawl_usage_service import CrawlUsage

    async def fake_get_usage(_client: object) -> CrawlUsage:
        from datetime import datetime, timezone

        return CrawlUsage(
            day_credits=999,
            month_credits=999,
            day_since=datetime.now(timezone.utc),
            month_since=datetime.now(timezone.utc),
            day_reset_at=datetime.now(timezone.utc),
        )

    monkeypatch.setattr(crawl_provider, "get_crawl_usage", fake_get_usage)

    outcome = await crawl(
        "https://example.com/a",
        settings=_settings(),
        client=object(),  # type: ignore[arg-type]
        user_id="user-1",
    )
    assert outcome.provider == "httpx"
    assert outcome.fallback_used is True
    assert outcome.notice == QUOTA_NOTICE
    assert calls["n"] == 1
