"""Tests for the JSON parser used by Cari Kerja AI responses."""

from __future__ import annotations

from app.services.job_service import _parse_json


def test_parse_plain_object() -> None:
    assert _parse_json('{"match_score": 80}') == {"match_score": 80}


def test_parse_fenced_block() -> None:
    raw = 'Berikut hasilnya:\n```json\n{"match_score": 70}\n```\n'
    assert _parse_json(raw) == {"match_score": 70}


def test_parse_with_trailing_commentary() -> None:
    raw = 'Hasil: {"a": {"b": 1}} Semoga membantu.'
    assert _parse_json(raw) == {"a": {"b": 1}}


def test_parse_ignores_braces_inside_strings() -> None:
    raw = '{"note": "pakai } penutup", "ok": true}'
    assert _parse_json(raw) == {"note": "pakai } penutup", "ok": True}


def test_parse_returns_none_for_invalid() -> None:
    assert _parse_json("bukan json sama sekali") is None
    assert _parse_json('{"unclosed": true') is None


def test_parse_returns_none_for_non_object() -> None:
    assert _parse_json("[1, 2, 3]") is None