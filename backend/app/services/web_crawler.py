"""Minimal web crawler for the Riset Web chat mode.

Fetches a single page with httpx and converts the HTML to readable plain text
using the standard library parser. No external HTML/readability dependency is
required; the extracted text is what the chat model sees as context.
"""

from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse, urlunparse

import httpx

# Tags whose text content is never useful to the model.
_SKIP_TAGS = {"script", "style", "noscript", "template", "svg", "head", "iframe"}
# Block-level tags that should introduce a line break in the extracted text.
_BLOCK_TAGS = {
    "p",
    "div",
    "section",
    "article",
    "header",
    "footer",
    "main",
    "aside",
    "br",
    "li",
    "ul",
    "ol",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "tr",
    "table",
    "blockquote",
    "pre",
}
_WS = re.compile(r"[ \t\r\f\v]+")
_BLANK_LINES = re.compile(r"\n\s*\n\s*\n+")

_USER_AGENT = (
    "Mozilla/5.0 (compatible; AxtraResearchBot/0.1; +https://example.local)"
)
_MAX_REDIRECTS = 5


class CrawlError(Exception):
    """Raised when a page cannot be fetched or yields no readable text."""


def _is_blocked_ip(value: str) -> bool:
    """True for addresses that must never be reached from the server (SSRF)."""
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return False
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def _assert_host_literal(host: str | None) -> None:
    if not host:
        raise CrawlError("URL tidak memiliki host.")
    if _is_blocked_ip(host):
        raise CrawlError("Alamat tujuan tidak diizinkan.")


async def _assert_public_host(host: str | None) -> None:
    """Reject hosts that resolve to private/loopback/link-local addresses.

    The literal check catches obvious targets; the DNS check prevents a public
    hostname from resolving to an internal address (SSRF via DNS).
    """
    if not host:
        raise CrawlError("URL tidak memiliki host.")
    if _is_blocked_ip(host):
        raise CrawlError("Alamat tujuan tidak diizinkan.")
    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise CrawlError(f"Host tidak bisa di-resolve: {host}") from exc
    for info in infos:
        address = info[4][0]
        if _is_blocked_ip(address):
            raise CrawlError("Alamat tujuan tidak diizinkan.")


def normalize_url(raw: str) -> str:
    """Validate and normalize a user-supplied URL.

    A missing scheme is assumed to be ``https``. Only http/https are accepted.
    """
    value = (raw or "").strip()
    if not value:
        raise CrawlError("URL tidak boleh kosong.")
    if "://" not in value:
        value = "https://" + value
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise CrawlError("URL tidak valid. Contoh: https://contoh.com/artikel")
    _assert_host_literal(parsed.hostname)
    # Drop the fragment; it never changes the served document.
    return urlunparse(parsed._replace(fragment=""))


@dataclass
class CrawledPage:
    url: str
    title: str
    site: str
    text: str


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._skip_depth = 0
        self._in_title = False
        self._title_parts: list[str] = []
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIP_TAGS:
            self._skip_depth += 1
            return
        if tag == "title":
            self._in_title = True
        if tag in _BLOCK_TAGS:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP_TAGS:
            if self._skip_depth:
                self._skip_depth -= 1
            return
        if tag == "title":
            self._in_title = False
        if tag in _BLOCK_TAGS:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self._title_parts.append(data)
        if self._skip_depth:
            return
        text = data.strip()
        if text:
            self._parts.append(text + " ")

    @property
    def title(self) -> str:
        return unescape(" ".join(self._title_parts)).strip()

    @property
    def text(self) -> str:
        raw = "".join(self._parts)
        lines = [_WS.sub(" ", line).strip() for line in raw.split("\n")]
        cleaned = "\n".join(line for line in lines if line)
        return _BLANK_LINES.sub("\n\n", cleaned).strip()


def html_to_text(html: str) -> tuple[str, str]:
    """Return ``(title, text)`` extracted from an HTML document."""
    parser = _TextExtractor()
    try:
        parser.feed(html)
        parser.close()
    except Exception:  # noqa: BLE001 - malformed HTML must not crash a crawl
        pass
    return parser.title, parser.text


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
    )
