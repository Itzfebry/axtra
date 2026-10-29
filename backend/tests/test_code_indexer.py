"""Tests for repo indexing helpers (chunking + repo URL parsing)."""

from __future__ import annotations

import pytest

from app.services.code_indexer import chunk_text
from app.services.github_client import parse_repo_url


def test_chunk_text_without_overlap_reproduces_content() -> None:
    content = "\n".join(f"line {index}" for index in range(200))
    chunks = chunk_text(content, 200, 0)
    assert len(chunks) > 1
    assert "\n".join(chunks) == content


def test_chunk_text_short_input_single_chunk() -> None:
    assert chunk_text("a\nb", 1000, 0) == ["a\nb"]


def test_chunk_text_all_chunks_non_empty() -> None:
    content = "\n".join(["x" * 100 for _ in range(20)])
    assert all(chunk.strip() for chunk in chunk_text(content, 250, 20))


@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://github.com/owner/repo", ("owner", "repo")),
        ("https://github.com/owner/repo.git", ("owner", "repo")),
        ("git@github.com:owner/repo.git", ("owner", "repo")),
    ],
)
def test_parse_repo_url_valid(url: str, expected: tuple[str, str]) -> None:
    assert parse_repo_url(url) == expected


@pytest.mark.parametrize("url", ["", "bukan url", "https://gitlab.com/owner/repo"])
def test_parse_repo_url_invalid(url: str) -> None:
    assert parse_repo_url(url) is None