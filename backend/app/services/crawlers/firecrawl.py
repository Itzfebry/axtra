"""Optional crawl provider backed by the Firecrawl API (``POST /v2/scrape``).

Only markdown is requested; the markdown is what the chat model sees, so the
provider reports ``CrawledPage.format == "markdown"``. Errors are classified so
the caller can fall back to the built-in parser without leaking raw upstream
messages:

- 401/403 -> ``FirecrawlAuthError`` (bad/absent key, or terms not accepted)
- 402/429 -> ``FirecrawlQuotaError`` (out of credits or rate limited)
- timeout / network / 5xx -> ``FirecrawlUnavailableError``
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import httpx

from app.config import Settings
from app.services.web_crawler import CrawledPage, CrawlError

_SCRAPE_PATH = "/v2/scrape"
_SEARCH_PATH = "/v2/search"


class FirecrawlError(CrawlError):
    """Base class for Firecrawl provider failures."""


class FirecrawlAuthError(FirecrawlError):
    """The API key is missing/invalid or the account is not allowed."""


class FirecrawlQuotaError(FirecrawlError):
    """Out of credits (402) or rate limited (429)."""


class FirecrawlUnavailableError(FirecrawlError):
    """Timeout, network error, or an upstream 5xx."""


@dataclass
class ScrapeResult:
    page: CrawledPage
    credits: int


@dataclass
class SearchResult:
    pages: list[CrawledPage]
    credits: int


def _coerce_text(value: Any) -> str:
    """Firecrawl ``title``/``description`` may be a string or list of strings."""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        return " ".join(str(item) for item in value if item).strip()
    return ""


def _error_message(payload: Any, fallback: str) -> str:
    if isinstance(payload, dict):
        message = payload.get("error") or payload.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()
    return fallback


async def scrape(
    url: str,
    *,
    settings: Settings,
    timeout_ms: int | None = None,
) -> ScrapeResult:
    """Scrape ``url`` via Firecrawl and return markdown as a ``CrawledPage``."""
    base = (settings.firecrawl_base_url or "").rstrip("/")
    if not base:
        raise FirecrawlUnavailableError("Firecrawl base URL tidak dikonfigurasi.")
    endpoint = base + _SCRAPE_PATH

    body: dict[str, Any] = {
        "url": url,
        "formats": ["markdown"],
        "onlyMainContent": True,
        # Do not persist third-party page content in Firecrawl's cache.
        "storeInCache": False,
        "timeout": timeout_ms or settings.firecrawl_timeout_ms,
    }
    if settings.firecrawl_check_prompt_injection:
        body["checkPromptInjection"] = True

    headers = {"Content-Type": "application/json"}
    if settings.firecrawl_api_key:
        headers["Authorization"] = f"Bearer {settings.firecrawl_api_key}"

    timeout = (timeout_ms or settings.firecrawl_timeout_ms) / 1000.0 + 5.0
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(endpoint, json=body, headers=headers)
    except httpx.HTTPError as exc:
        raise FirecrawlUnavailableError("Firecrawl tidak bisa dihubungi.") from exc

    try:
        payload = response.json()
    except ValueError:
        payload = None

    status = response.status_code
    if status == 200:
        data = (payload or {}).get("data") or {}
        markdown = data.get("markdown") or ""
        if not markdown.strip():
            raise FirecrawlUnavailableError(
                "Firecrawl tidak mengembalikan teks yang bisa dibaca."
            )
        meta = data.get("metadata") or {}
        final_url = _coerce_text(meta.get("url")) or _coerce_text(
            meta.get("sourceURL")
        ) or url
        site = urlparse(final_url).netloc
        title = _coerce_text(meta.get("title")) or site or final_url
        credits = 1
        for candidate in (
            (payload or {}).get("creditsUsed"),
            meta.get("creditsUsed"),
        ):
            if isinstance(candidate, (int, float)) and candidate > 0:
                credits = int(candidate)
                break
        return ScrapeResult(
            page=CrawledPage(
                url=final_url,
                title=title,
                site=site,
                text=markdown,
                format="markdown",
            ),
            credits=credits,
        )

    if status in (401, 403):
        raise FirecrawlAuthError(
            "Kunci Firecrawl tidak valid atau tidak diizinkan. "
            "Periksa FIRECRAWL_API_KEY di server."
        )
    if status in (402, 429):
        raise FirecrawlQuotaError(
            _error_message(payload, "Kuota Firecrawl habis atau sedang dibatasi.")
        )
    if status >= 500:
        raise FirecrawlUnavailableError(
            _error_message(payload, "Firecrawl sedang tidak tersedia.")
        )
    raise FirecrawlUnavailableError(
        _error_message(payload, f"Firecrawl mengembalikan status {status}.")
    )


def _search_items(payload: Any) -> list[dict[str, Any]]:
    """Normalise the ``/v2/search`` payload into a list of result dicts.

    Firecrawl returns ``{"data": {"web": [...]}}``; some versions return a bare
    list. Anything unexpected is treated as "no results".
    """
    data = payload.get("data") if isinstance(payload, dict) else payload
    if isinstance(data, dict):
        for key in ("web", "results"):
            value = data.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
        return []
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    return []


def _search_credits(payload: Any, fallback: int) -> int:
    if isinstance(payload, dict):
        value = payload.get("creditsUsed")
        if isinstance(value, (int, float)) and value > 0:
            return int(value)
    return fallback


async def search(
    query: str,
    *,
    settings: Settings,
    limit: int = 5,
    scrape: bool = True,
) -> SearchResult:
    """Run a Firecrawl web search and return the hits as ``CrawledPage``s.

    With ``scrape=True`` each result carries its page markdown; otherwise the
    search snippet (``description``) is used as the text so the result is still
    usable as context at a lower credit cost.
    """
    base = (settings.firecrawl_base_url or "").rstrip("/")
    if not base:
        raise FirecrawlUnavailableError("Firecrawl base URL tidak dikonfigurasi.")
    endpoint = base + _SEARCH_PATH

    body: dict[str, Any] = {
        "query": query,
        "limit": max(1, min(int(limit), 10)),
        "sources": ["web"],
        "timeout": settings.firecrawl_timeout_ms,
    }
    if scrape:
        body["scrapeOptions"] = {
            "formats": ["markdown"],
            "onlyMainContent": True,
            "storeInCache": False,
        }
    if settings.firecrawl_check_prompt_injection:
        body["checkPromptInjection"] = True

    headers = {"Content-Type": "application/json"}
    if settings.firecrawl_api_key:
        headers["Authorization"] = f"Bearer {settings.firecrawl_api_key}"

    timeout = settings.firecrawl_timeout_ms / 1000.0 + 5.0
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(endpoint, json=body, headers=headers)
    except httpx.HTTPError as exc:
        raise FirecrawlUnavailableError("Firecrawl tidak bisa dihubungi.") from exc

    try:
        payload = response.json()
    except ValueError:
        payload = None

    status = response.status_code
    if status == 200:
        pages: list[CrawledPage] = []
        for item in _search_items(payload):
            url = _coerce_text(item.get("url"))
            if not url:
                continue
            text = _coerce_text(item.get("markdown")) or _coerce_text(
                item.get("content")
            )
            description = _coerce_text(item.get("description"))
            if not text:
                text = description
            if not text:
                continue
            site = urlparse(url).netloc
            title = _coerce_text(item.get("title")) or site or url
            pages.append(
                CrawledPage(
                    url=url,
                    title=title,
                    site=site,
                    text=text,
                    format="markdown" if item.get("markdown") else "text",
                )
            )
        return SearchResult(
            pages=pages, credits=_search_credits(payload, max(len(pages), 1))
        )

    if status in (401, 403):
        raise FirecrawlAuthError(
            "Kunci Firecrawl tidak valid atau tidak diizinkan. "
            "Periksa FIRECRAWL_API_KEY di server."
        )
    if status in (402, 429):
        raise FirecrawlQuotaError(
            _error_message(payload, "Kuota Firecrawl habis atau sedang dibatasi.")
        )
    if status >= 500:
        raise FirecrawlUnavailableError(
            _error_message(payload, "Firecrawl sedang tidak tersedia.")
        )
    raise FirecrawlUnavailableError(
        _error_message(payload, f"Firecrawl mengembalikan status {status}.")
    )
