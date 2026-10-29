"""Minimal read-only GitHub REST client for repository indexing.

Public repos work without a token (60 requests/hour per IP). Setting
``GITHUB_TOKEN`` (read-only) raises the limit and enables private repos.
"""

from __future__ import annotations

import asyncio
import base64
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx

# Directories never worth indexing: dependencies, build output, VCS metadata.
_SKIP_DIRS = {
    "node_modules",
    ".git",
    ".github",
    "dist",
    "build",
    ".next",
    "out",
    "vendor",
    "coverage",
    "__pycache__",
    ".venv",
    "venv",
    "env",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    "target",
    ".idea",
    ".vscode",
    "site-packages",
    "migrations",
}

# Extensions that are binary, generated, or otherwise low-value for analysis.
_SKIP_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".bmp", ".tiff",
    ".pdf", ".zip", ".tar", ".gz", ".7z", ".rar", ".jar", ".war", ".exe", ".dll",
    ".so", ".dylib", ".bin", ".class", ".pyc", ".pyo", ".o", ".a", ".woff",
    ".woff2", ".ttf", ".eot", ".otf", ".mp3", ".mp4", ".mov", ".avi", ".webm",
    ".lock", ".map", ".min.js", ".min.css", ".snap", ".csv", ".parquet", ".db",
    ".sqlite", ".ipynb", ".DS_Store",
}

_SKIP_FILES = {
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock",
    "Pipfile.lock", "composer.lock", "Cargo.lock", "Gemfile.lock",
}

_LANGUAGE_BY_EXT = {
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".java": "java",
    ".kt": "kotlin",
    ".go": "go",
    ".rs": "rust",
    ".rb": "ruby",
    ".php": "php",
    ".cs": "csharp",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".hpp": "cpp",
    ".swift": "swift",
    ".dart": "dart",
    ".sql": "sql",
    ".sh": "shell",
    ".bash": "shell",
    ".ps1": "powershell",
    ".html": "html",
    ".css": "css",
    ".scss": "scss",
    ".vue": "vue",
    ".svelte": "svelte",
    ".md": "markdown",
    ".json": "json",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".toml": "toml",
    ".ini": "ini",
    ".env": "dotenv",
    ".dockerfile": "dockerfile",
}

_REPO_URL = re.compile(
    r"(?:https?://)?(?:www\.)?github\.com[:/]+(?P<owner>[^/\s]+)/(?P<repo>[^/\s#?]+)",
    re.IGNORECASE,
)


class GitHubError(RuntimeError):
    """Raised when the GitHub API cannot satisfy a request."""


@dataclass
class RepoFile:
    path: str
    size: int
    language: str


def parse_repo_url(url: str) -> tuple[str, str] | None:
    """Return ``(owner, repo)`` from a GitHub URL, or None when invalid."""
    if not url:
        return None
    match = _REPO_URL.search(url.strip())
    if not match:
        return None
    owner = match.group("owner")
    repo = match.group("repo")
    if repo.endswith(".git"):
        repo = repo[: -len(".git")]
    if not owner or not repo:
        return None
    return owner, repo


def _language_for(path: str) -> str:
    lower = path.lower()
    if lower.endswith("dockerfile") or lower.split("/")[-1] == "dockerfile":
        return "dockerfile"
    ext = "." + lower.rsplit(".", 1)[-1] if "." in lower else ""
    return _LANGUAGE_BY_EXT.get(ext, "text")


def is_indexable(path: str) -> bool:
    parts = path.split("/")
    if any(part in _SKIP_DIRS for part in parts[:-1]):
        return False
    filename = parts[-1]
    if filename in _SKIP_FILES:
        return False
    lower = filename.lower()
    if lower.endswith(".min.js") or lower.endswith(".min.css"):
        return False
    if "." in lower:
        ext = "." + lower.rsplit(".", 1)[-1]
        if ext in _SKIP_EXT:
            return False
    if lower.startswith(".") and lower not in {".env.example", ".gitignore"}:
        return False
    return True


class GitHubClient:
    def __init__(
        self,
        token: str = "",
        base_url: str = "https://api.github.com",
        raw_base_url: str = "https://raw.githubusercontent.com",
    ) -> None:
        self._base = base_url.rstrip("/")
        self._raw_base = raw_base_url.rstrip("/")
        self._token = token
        self._headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "axtra-repo-indexer",
        }
        if token:
            self._headers["Authorization"] = f"Bearer {token}"

    async def _get(self, client: httpx.AsyncClient, path: str, params: dict | None = None):
        response = await client.get(
            f"{self._base}{path}", headers=self._headers, params=params
        )
        if response.status_code == 404:
            raise GitHubError("Repository atau file tidak ditemukan (404).")
        if response.status_code == 403:
            remaining = response.headers.get("x-ratelimit-remaining")
            if remaining == "0":
                raise GitHubError(
                    "Kuota GitHub API habis (60/jam tanpa token). "
                    "Setel GITHUB_TOKEN untuk batas 5000/jam."
                )
            raise GitHubError(
                "Akses GitHub ditolak (403). Repo mungkin privat — setel GITHUB_TOKEN."
            )
        if response.status_code >= 400:
            raise GitHubError(f"GitHub API gagal ({response.status_code}).")
        return response

    async def repo_meta(self, owner: str, repo: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await self._get(client, f"/repos/{owner}/{repo}")
            return response.json()

    async def list_files(self, owner: str, repo: str, branch: str) -> list[RepoFile]:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await self._get(
                client,
                f"/repos/{owner}/{repo}/git/trees/{branch}",
                params={"recursive": "1"},
            )
            data = response.json()
        files: list[RepoFile] = []
        for item in data.get("tree", []):
            if item.get("type") != "blob":
                continue
            path = item.get("path", "")
            size = int(item.get("size") or 0)
            if not path or not is_indexable(path):
                continue
            files.append(RepoFile(path=path, size=size, language=_language_for(path)))
        return files

    async def get_file(
        self, owner: str, repo: str, path: str, ref: str
    ) -> str | None:
        # Raw CDN first: fetching file contents does not consume the API quota.
        # Falls back to the contents API for private repos (needs a token).
        raw_url = f"{self._raw_base}/{owner}/{repo}/{ref}/{path}"
        raw_headers = {}
        if self._token:
            raw_headers["Authorization"] = f"Bearer {self._token}"
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                raw = await client.get(raw_url, headers=raw_headers)
            if raw.status_code == 200:
                return raw.text
            if not self._token:
                return None
        except httpx.HTTPError:
            if not self._token:
                return None

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await self._get(
                client,
                f"/repos/{owner}/{repo}/contents/{path}",
                params={"ref": ref},
            )
            data = response.json()
        if isinstance(data, list):
            return None
        if data.get("encoding") == "base64" and data.get("content"):
            try:
                raw_bytes = base64.b64decode(data["content"])
            except Exception:
                return None
            return raw_bytes.decode("utf-8", errors="replace")
        return None

    async def get_many(
        self,
        owner: str,
        repo: str,
        ref: str,
        files: list[RepoFile],
        concurrency: int = 5,
        on_progress: Callable[[int, int], Awaitable[None]] | None = None,
    ) -> list[tuple[RepoFile, str]]:
        """Fetch file contents with bounded concurrency, skipping failures."""
        semaphore = asyncio.Semaphore(concurrency)
        results: list[tuple[RepoFile, str]] = []
        completed = 0
        total = len(files)

        async def one(file: RepoFile) -> None:
            nonlocal completed
            async with semaphore:
                try:
                    content = await self.get_file(owner, repo, file.path, ref)
                except GitHubError:
                    content = None
                if content:
                    results.append((file, content))
            completed += 1
            if on_progress:
                try:
                    await on_progress(completed, total)
                except Exception:  # noqa: BLE001 - progress is best-effort
                    pass

        await asyncio.gather(*(one(file) for file in files))
        results.sort(key=lambda pair: pair[0].path)
        return results
