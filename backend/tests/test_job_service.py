"""Tests for the JSON parser used by Cari Kerja AI responses."""

from __future__ import annotations

import pytest

from app.schemas import JobApplicationOut
from app.routers.jobs import _EMPTY_DESCRIPTION, _require_description
from app.services.job_service import (
    _ANALYZE_SYSTEM,
    _CHARS_PER_TOKEN,
    _application_context,
    _clamp_score,
    _context_char_budget,
    _parse_json,
    _plain_cover_letter,
    _salvage_json,
    JobCoach,
)


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


def test_salvage_recovers_fields_from_truncated_json() -> None:
    raw = (
        '{"predicted_jobdesk": ["Bangun API", "Review kode"], '
        '"match_score": 72, "match_analysis": "### Ringkasan\\nKandidat kuat", '
        '"success_score": 65, "success_analysis": "### Dasar estimasi\\nPersaingan'
    )
    assert _parse_json(raw) is None
    salvaged = _salvage_json(raw)
    assert salvaged["predicted_jobdesk"] == ["Bangun API", "Review kode"]
    assert salvaged["match_score"] == 72
    assert salvaged["success_score"] == 65
    assert "Kandidat kuat" in salvaged["match_analysis"]
    assert salvaged["success_analysis"].startswith("### Dasar estimasi")


def test_clamp_score_accepts_percent_string() -> None:
    assert _clamp_score("78%") == 78
    assert _clamp_score("not a number") is None


def _application() -> JobApplicationOut:
    return JobApplicationOut(id="1", company="Acme", role="Engineer")


def test_context_cv_only_by_default() -> None:
    text = _application_context(_application(), "CV isi")
    assert "CV PELAMAR" in text
    assert "PORTFOLIO PELAMAR" not in text
    assert "LINKEDIN PELAMAR" not in text


def test_context_includes_selected_sources() -> None:
    text = _application_context(
        _application(),
        "CV isi",
        include_cv=False,
        include_portfolio=True,
        portfolio_url="https://porto.test",
        portfolio_text="Proyek A",
        include_linkedin=True,
        linkedin_url="https://linkedin.test/in/x",
        linkedin_text="About me",
    )
    assert "CV PELAMAR" not in text
    assert "PORTFOLIO PELAMAR" in text
    assert "https://porto.test" in text
    assert "Proyek A" in text
    assert "LINKEDIN PELAMAR" in text
    assert "About me" in text


def test_context_mentions_missing_snapshot() -> None:
    text = _application_context(
        _application(),
        "",
        include_cv=False,
        include_portfolio=True,
        portfolio_url="https://porto.test",
    )
    assert "belum ditarik" in text


def test_context_respects_character_budget() -> None:
    application = JobApplicationOut(
        id="1", company="Acme", role="Engineer", job_description="j" * 50000
    )
    text = _application_context(
        application,
        "c" * 50000,
        include_cv=True,
        max_chars=4000,
    )
    # Small per-section minimums add separators, so allow a small overshoot.
    assert len(text) < 8000


def test_output_budget_fits_tpm_window() -> None:
    coach = JobCoach(None, "test-model", tpm_limit=8000)
    output = coach._output_budget(2200)
    budget = _context_char_budget(_ANALYZE_SYSTEM, 8000, output)
    assert output == 3360
    assert budget > 0
    assert output + (len(_ANALYZE_SYSTEM) + budget) / _CHARS_PER_TOKEN <= 8000


def test_plain_cover_letter_strips_markdown_and_long_dashes() -> None:
    raw = (
        "### Surat Lamaran\n\n"
        "**Hormat saya,**\n\n"
        "- Saya berpengalaman — 5 tahun.\n"
        "* Fokus pada backend.\n\n"
        "Kerja sama tim – andalan saya.\n\n"
        "```json\n{\"a\": 1}\n```\n"
    )
    result = _plain_cover_letter(raw)
    assert "#" not in result
    assert "**" not in result
    assert "```" not in result
    assert "—" not in result
    assert "–" not in result
    # Bullet markers at line start are removed.
    assert not any(line.lstrip().startswith(("-", "*")) for line in result.splitlines())
    assert "Hormat saya," in result
    assert "5 tahun" in result


def test_require_description_rejects_empty() -> None:
    application = JobApplicationOut(id="1", company="Acme", role="Engineer")
    with pytest.raises(Exception) as exc:
        _require_description(application)
    assert getattr(exc.value, "status_code", None) == 400
    assert getattr(exc.value, "detail", "") == _EMPTY_DESCRIPTION


def test_require_description_accepts_filled() -> None:
    application = JobApplicationOut(
        id="1", company="Acme", role="Engineer", job_description="Tanggung jawab X"
    )
    _require_description(application)