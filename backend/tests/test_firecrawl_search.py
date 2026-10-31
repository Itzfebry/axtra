"""Tests for Firecrawl ``/v2/search`` payload normalisation."""

from __future__ import annotations

from app.services.crawlers.firecrawl import _search_credits, _search_items


def test_items_from_web_object() -> None:
    payload = {"data": {"web": [{"url": "https://a.test"}]}}
    assert _search_items(payload) == [{"url": "https://a.test"}]


def test_items_from_results_object() -> None:
    payload = {"data": {"results": [{"url": "https://b.test"}]}}
    assert _search_items(payload) == [{"url": "https://b.test"}]


def test_items_from_bare_list() -> None:
    payload = {"data": [{"url": "https://c.test"}]}
    assert _search_items(payload) == [{"url": "https://c.test"}]


def test_items_ignore_non_dict_entries() -> None:
    payload = {"data": {"web": [{"url": "https://a.test"}, "nope", None]}}
    assert _search_items(payload) == [{"url": "https://a.test"}]


def test_items_unknown_shape_is_empty() -> None:
    assert _search_items({"data": {"news": []}}) == []
    assert _search_items(None) == []


def test_credits_prefers_payload_value() -> None:
    assert _search_credits({"creditsUsed": 4}, 2) == 4


def test_credits_falls_back_when_missing() -> None:
    assert _search_credits({}, 3) == 3
    assert _search_credits({"creditsUsed": 0}, 3) == 3