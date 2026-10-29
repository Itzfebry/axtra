"""Tests for the web crawler helpers and the SSRF guard."""

from __future__ import annotations

import pytest

from app.services.web_crawler import (
    CrawlError,
    _assert_public_host,
    html_to_text,
    normalize_url,
)


def test_normalize_adds_https_scheme() -> None:
    assert normalize_url("example.com") == "https://example.com"


def test_normalize_drops_fragment() -> None:
    assert normalize_url("https://example.com/a#section") == "https://example.com/a"


def test_normalize_rejects_empty() -> None:
    with pytest.raises(CrawlError):
        normalize_url("   ")


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/x",
        "http://10.0.0.5/",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/",
        "http://192.168.1.1/",
    ],
)
def test_normalize_blocks_private_literal_ips(url: str) -> None:
    with pytest.raises(CrawlError):
        normalize_url(url)


async def test_public_host_blocks_localhost() -> None:
    with pytest.raises(CrawlError):
        await _assert_public_host("localhost")


async def test_public_host_blocks_loopback_literal() -> None:
    with pytest.raises(CrawlError):
        await _assert_public_host("127.0.0.1")


def test_html_to_text_strips_scripts_and_keeps_content() -> None:
    html = (
        "<html><head><title>Judul</title><script>evil()</script></head>"
        "<body><p>Halo</p><p>Dunia</p></body></html>"
    )
    title, text = html_to_text(html)
    assert title == "Judul"
    assert "Halo" in text
    assert "Dunia" in text
    assert "evil" not in text