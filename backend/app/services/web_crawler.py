"""Web crawler helpers shared by every crawl provider.

Holds the provider-agnostic pieces: the URL/SSRF guard, the HTTP fetch with
manual redirects, and the standard-library HTML-to-text extractor. The built-in
``httpx`` provider lives in ``crawlers/httpx_crawler.py``; the optional Firecrawl
provider lives in ``crawlers/firecrawl.py``. Both return a ``CrawledPage``.
"""

from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urlparse, urlunparse

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
    # "text" for the built-in HTML extractor, "markdown" for Firecrawl.
    format: str = "text"


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

