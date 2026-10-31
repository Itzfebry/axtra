"""Unit tests for skill block composition (caps, dedupe)."""

from __future__ import annotations

from app.services.skill_service import compose_skill_block

CAPS = {"max_chars": 6000, "max_total": 12000, "max_count": 6}


def _skill(skill_id: str, name: str, content: str) -> dict[str, str]:
    return {"id": skill_id, "name": name, "content": content}


def test_empty_list_returns_empty_block() -> None:
    assert compose_skill_block([], **CAPS) == ""


def test_header_and_names_present() -> None:
    block = compose_skill_block([_skill("1", "Alpha", "Do alpha.")], **CAPS)
    assert block.startswith("SKILL AKTIF")
    assert "### Alpha" in block
    assert "Do alpha." in block


def test_duplicate_ids_are_deduped() -> None:
    block = compose_skill_block(
        [_skill("1", "Alpha", "A."), _skill("1", "Alpha", "A.")], **CAPS
    )
    assert block.count("### Alpha") == 1


def test_empty_content_skipped() -> None:
    block = compose_skill_block(
        [_skill("1", "Empty", "   "), _skill("2", "Real", "R.")], **CAPS
    )
    assert "### Empty" not in block
    assert "### Real" in block


def test_skill_is_truncated_at_per_skill_cap() -> None:
    long = "x" * 100
    block = compose_skill_block(
        [_skill("1", "Long", long)], max_chars=10, max_total=12000, max_count=6
    )
    assert "... (dipotong)" in block


def test_count_cap_applied() -> None:
    skills = [_skill(str(i), f"S{i}", "body") for i in range(10)]
    block = compose_skill_block(skills, max_chars=6000, max_total=12000, max_count=3)
    assert block.count("###") == 3


def test_total_cap_applied() -> None:
    skills = [_skill(str(i), f"S{i}", "y" * 5000) for i in range(6)]
    block = compose_skill_block(skills, max_chars=6000, max_total=8000, max_count=6)
    # Only the first skill fits inside the total cap.
    assert block.count("###") == 1


def test_none_when_no_usable_skill() -> None:
    assert compose_skill_block([_skill("", "NoId", "x")], **CAPS) == ""
