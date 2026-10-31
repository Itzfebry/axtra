"""Unit tests for the SKILL.md frontmatter parser (no DB, no network)."""

from __future__ import annotations

import pytest

from app.services.skill_parser import (
    SkillParseError,
    parse_skill_md,
    slugify,
)


def test_parse_full_frontmatter() -> None:
    raw = """---
name: Risk Radar
description: Detects delivery risks early.
license: MIT
metadata:
  author: axtra
  version: 2
---

# Ringkasan

Pantau risiko.
"""
    parsed = parse_skill_md(raw)
    assert parsed.name == "Risk Radar"
    assert parsed.description == "Detects delivery risks early."
    assert parsed.license == "MIT"
    assert parsed.metadata == {"author": "axtra", "version": "2"}
    assert parsed.content.startswith("# Ringkasan")
    assert "---" not in parsed.content


def test_parse_without_frontmatter_uses_fallback_name() -> None:
    parsed = parse_skill_md("# Judul\n\nIsi.", fallback_name="Manual Skill")
    assert parsed.name == "Manual Skill"
    assert parsed.content.startswith("# Judul")


def test_parse_without_frontmatter_and_no_name_errors() -> None:
    with pytest.raises(SkillParseError):
        parse_skill_md("Isi tanpa nama.")


def test_unterminated_frontmatter_errors() -> None:
    with pytest.raises(SkillParseError):
        parse_skill_md("---\nname: X\nno closing marker")


def test_invalid_frontmatter_line_reports_line_number() -> None:
    with pytest.raises(SkillParseError) as exc:
        parse_skill_md("---\nname: X\nbogus line\n---\nBody")
    assert "Baris 3" in str(exc.value)


def test_duplicate_scalar_key_errors() -> None:
    with pytest.raises(SkillParseError):
        parse_skill_md("---\nname: A\nname: B\n---\nBody")


def test_unknown_top_level_key_ignored() -> None:
    parsed = parse_skill_md("---\nname: A\nweird: value\n---\nBody")
    assert parsed.name == "A"
    assert parsed.content == "Body"


def test_quoted_values_are_unquoted() -> None:
    parsed = parse_skill_md('---\nname: "Quoted Name"\n---\nBody')
    assert parsed.name == "Quoted Name"


def test_empty_document_errors() -> None:
    with pytest.raises(SkillParseError):
        parse_skill_md("   ")


def test_empty_body_errors() -> None:
    with pytest.raises(SkillParseError):
        parse_skill_md("---\nname: A\n---\n")


def test_slugify_normalizes() -> None:
    assert slugify("Risk Radar!!") == "risk-radar"
    assert slugify("  MixEd Case  ") == "mixed-case"
    assert slugify("Crème brûlée") == "cr-me-br-l-e"
    assert slugify("") == "skill"
    assert slugify("---") == "skill"
