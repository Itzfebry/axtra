"""Built-in crawl provider: fetch a page with httpx and parse it locally.

No external HTML/readability dependency is required; the extracted plain text
is what the chat model sees as context. This is the default provider and the
automatic fallback whenever Firecrawl is unavailable.
"""

from __future__ import annotations

from urllib.parse import urljoin, urlparse

import httpx

from app.services.web_crawler import (
    CrawledPage,
    CrawlError,
    _assert_public_host,
    html_to_text,
    normalize_url,
)

_USER_AGENT = (
    "Mozilla/5.0 (compatible; AxtraResearchBot/0.1; +https://example.local)"
)
_MAX_REDIRECTS = 5


async def fetch_page(
    url: str,
    *,
    timeout: float = 15.0,
    max_bytes: int = 2 * 1024 * 1024,
) -> CrawledPage:
    """Fetch a URL and return its readable text (title, site, body).

    Redirects are followed manually so every hop is re-validated against the
    SSRF guard. The body is streamed and capped at ``max_bytes`` instead of
    being downloaded whole first.
    """
    current = normalize_url(url)
    headers = {"User-Agent": _USER_AGENT, "Accept": "text/html,application/xhtml+xml"}

    body = b""
    final_url = current
    encoding = "utf-8"
    redirects = 0

    try:
        async with httpx.AsyncClient(
            timeout=timeout, follow_redirects=False, headers=headers
        ) as client:
            while True:
                await _assert_public_host(urlparse(current).hostname)
                async with client.stream("GET", current) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise CrawlError("Redirect tanpa tujuan.")
                        current = normalize_url(
                            urljoin(str(response.url), location)
                        )
                        redirects += 1
                        if redirects > _MAX_REDIRECTS:
                            raise CrawlError("Terlalu banyak redirect.")
                        continue

                    if response.status_code >= 400:
                        raise CrawlError(
                            f"Halaman mengembalikan status {response.status_code}."
                        )

                    content_type = response.headers.get("content-type", "")
                    if "html" not in content_type and "text" not in content_type:
                        raise CrawlError(
                            "Konten bukan halaman teks/HTML yang bisa dibaca."
                        )

                    buffer = bytearray()
                    async for chunk in response.aiter_bytes():
                        buffer.extend(chunk)
                        if len(buffer) >= max_bytes:
                            break
                    body = bytes(buffer[:max_bytes])
                    final_url = str(response.url)
                    encoding = response.encoding or "utf-8"
                    break
    except httpx.HTTPError as exc:
        raise CrawlError(f"Gagal membuka halaman: {exc}") from exc

    if not body:
        raise CrawlError("Halaman kosong.")

    try:
        html = body.decode(encoding, errors="replace")
    except LookupError:
        html = body.decode("utf-8", errors="replace")

    title, text = html_to_text(html)
    if not text:
        raise CrawlError("Tidak ada teks yang bisa dibaca dari halaman ini.")

    site = urlparse(final_url).netloc
    return CrawledPage(
        url=final_url,
        title=title or site or final_url,
        site=site,
        text=text,
        format="text",
    )
