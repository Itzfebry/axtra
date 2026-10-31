"""Tests for persona composition order and legacy fallback."""

from __future__ import annotations

from app.feature_catalog import persona_from_settings


def test_order_role_skill_instruction() -> None:
    text = persona_from_settings(
        "projects:health",
        {"roles": "Reviewer", "instruction": "Tetap ringkas."},
        skill_block="SKILL AKTIF:\n### Alpha\nDo alpha.",
    )
    assert text.index("Peran yang harus kamu jalankan") < text.index("SKILL AKTIF")
    assert text.index("SKILL AKTIF") < text.index("Instruksi khusus")


def test_legacy_skill_field_used_when_no_block() -> None:
    text = persona_from_settings(
        "projects:health",
        {"roles": "Reviewer", "skills": "Risk radar, Next-step"},
    )
    assert "Skill yang harus kamu terapkan:" in text
    assert "- Risk radar" in text
    assert "- Next-step" in text


def test_empty_settings_returns_empty() -> None:
    assert persona_from_settings("projects:health", {}) == ""


def test_skill_block_without_legacy_skills() -> None:
    text = persona_from_settings(
        "projects:health",
        {"roles": "Reviewer", "skills": ""},
        skill_block="SKILL AKTIF:\n### Alpha\nbody",
    )
    assert "Skill yang harus kamu terapkan:" not in text
    assert "### Alpha" in text
