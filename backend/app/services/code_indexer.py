"""RAG index over a project's GitHub repository.

Pipeline: fetch tree -> read files -> chunk -> embed (optional) -> store in
``project_code_chunks``. Retrieval uses pgvector when embeddings exist and a
full-text fallback otherwise. Question answering answers from retrieved chunks.
"""

from __future__ import annotations

import logging
import re
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any

from supabase import AsyncClient

from app.config import Settings
from app.embeddings import EmbeddingProvider
from app.llm import ChatMessage, ChatRequest, LLMProvider, LLMProviderError
from app.schemas import CodeSourceOut, RepoAskOut
from app.services.github_client import GitHubClient, GitHubError, RepoFile, parse_repo_url

logger = logging.getLogger("axtra.code_indexer")

_CODE_QA_SYSTEM = """\
Kamu adalah Axtra, asisten analisa kode. Jawab pertanyaan pengguna HANYA \
berdasarkan potongan kode repo di bawah. Jika tidak ada di konteks, katakan \
tidak ditemukan dan jangan mengarang. Bahasa Indonesia, ringkas, rujuk path file \
relevan. Sertakan potongan kode singkat bila membantu.

Format jawaban: Markdown murni. JANGAN pernah tulis tag HTML, termasuk <br>, \
<br/>, <p>, <ul>. Untuk memisahkan item pada sel tabel atau baris, gunakan daftar \
Markdown biasa (tanda "-" per baris) atau pemisah " · ", bukan <br>. Utamakan \
daftar bernomor/peluru yang pendek daripada tabel; bila memakai tabel, isi tiap \
sel harus singkat (satu frasa) tanpa baris baru. Bungkus path file dan simbol kode \
dengan backtick, mis. `backend/app/main.py`. Pastikan jawaban utuh dan tidak \
terpotong di tengah kata.
"""

_REPO_SUMMARY_SYSTEM = """\
Kamu menganalisa sebuah repository GitHub berdasarkan daftar file dan isi \
sebagian file. Tulis ringkasan analisa berbahasa Indonesia,format Markdown, \
maksimal 12 baris. Cakup: tujuan proyek, stack utama, struktur, status/kualitas \
kode, dan 2-3 risiko atau TODO yang terlihat. Jangan mengarang fitur yang tidak \
ada bukti di file.
"""

_PROJECT_QA_SYSTEM = """\
Kamu adalah Axtra, asisten proyek. Jawab pertanyaan pengguna tentang PROYEK \
(ide, tujuan, stack, catatan, dokumen, tugas, atau ringkasan repo) berdasarkan \
konteks proyek di bawah. Repository bersifat opsional: pertanyaan tidak harus \
soal kode. Jika informasi tidak ada di konteks, katakan tidak ada dan jangan \
mengarang; sarankan melengkapi catatan/dokumen atau meng-index repo bila perlu.

Format jawaban: Markdown murni. JANGAN tulis tag HTML (mis. <br>, <p>, <ul>). \
Gunakan daftar Markdown pendek atau pemisah " · ". Bungkus path/simbol kode \
dengan backtick. Bahasa Indonesia, ringkas, jawaban utuh.
"""


def _vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{value:.6f}" for value in vector) + "]"


def chunk_text(content: str, size: int, overlap: int) -> list[str]:
    """Split text into ~size-char chunks on line boundaries, with overlap."""
    size = max(size, 200)
    overlap = max(0, min(overlap, size // 2))
    lines = content.splitlines()
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for line in lines:
        line_len = len(line) + 1
        if current_len + line_len > size and current:
            chunks.append("\n".join(current))
            # Keep a small tail for context overlap.
            tail: list[str] = []
            tail_len = 0
            for prev in reversed(current):
                tail_len += len(prev) + 1
                if tail_len > overlap:
                    break
                tail.insert(0, prev)
            current = tail
            current_len = sum(len(item) + 1 for item in current)
        current.append(line)
        current_len += line_len
    if current:
        chunks.append("\n".join(current))
    return [chunk for chunk in chunks if chunk.strip()]


class CodeIndexer:
    def __init__(
        self,
        client: AsyncClient,
        settings: Settings,
        embedding_provider: EmbeddingProvider,
        llm: LLMProvider | None,
    ) -> None:
        self._client = client
        self._settings = settings
        self._embeddings = embedding_provider
        self._llm = llm
        self._github = GitHubClient(
            settings.github_token, settings.github_api_base, settings.github_raw_base
        )

    @property
    def embeddings_available(self) -> bool:
        return self._embeddings.available and self._embeddings.dim == 384

    # --------------------------------------------------------------- indexing
    async def _set_status(self, project_id: str, patch: dict[str, Any]) -> None:
        try:
            await (
                self._client.table("projects")
                .update(patch)
                .eq("id", project_id)
                .execute()
            )
        except Exception:  # noqa: BLE001 - status is best-effort telemetry
            logger.warning("Failed to update repo status for %s", project_id)

    async def _progress(self, project_id: str, progress: int, stage: str) -> None:
        await self._set_status(
            project_id,
            {"repo_index_progress": max(0, min(100, progress)), "repo_index_stage": stage},
        )

    async def index_project(
        self, project_id: str, user_id: str, repo_url: str
    ) -> None:
        parsed = parse_repo_url(repo_url)
        if not parsed:
            await self._set_status(
                project_id,
                {
                    "repo_index_status": "error",
                    "repo_index_error": "URL repo tidak valid.",
                    "repo_index_progress": 0,
                    "repo_index_stage": None,
                },
            )
            return
        owner, repo = parsed
        await self._set_status(
            project_id,
            {
                "repo_index_status": "indexing",
                "repo_index_error": None,
                "repo_full_name": f"{owner}/{repo}",
                "repo_index_progress": 0,
                "repo_index_stage": "menyiapkan",
            },
        )
        try:
            await self._progress(project_id, 3, "mengambil metadata repo")
            meta = await self._github.repo_meta(owner, repo)
            branch = meta.get("default_branch") or "main"
            await self._progress(project_id, 8, "membaca struktur repo")
            files = await self._github.list_files(owner, repo, branch)
            files = [f for f in files if f.size <= self._settings.repo_index_max_file_bytes]
            files = files[: self._settings.repo_index_max_files]
            await self._progress(
                project_id, 15, f"mengunduh {len(files)} file"
            )

            last_pct = {"value": 15}

            async def on_download(done: int, total: int) -> None:
                pct = 15 + int(40 * done / max(total, 1))
                if pct > last_pct["value"]:
                    last_pct["value"] = pct
                    await self._progress(
                        project_id, pct, f"mengunduh {done}/{total} file"
                    )

            fetched = await self._github.get_many(
                owner, repo, branch, files, on_progress=on_download
            )
            await self._progress(project_id, 55, "memecah kode menjadi chunk")

            rows: list[dict[str, Any]] = []
            for file, content in fetched:
                if len(rows) >= self._settings.repo_index_max_chunks:
                    break
                for index, chunk in enumerate(
                    chunk_text(
                        content,
                        self._settings.repo_index_chunk_chars,
                        self._settings.repo_index_chunk_overlap,
                    )
                ):
                    if len(rows) >= self._settings.repo_index_max_chunks:
                        break
                    rows.append(
                        {
                            "project_id": project_id,
                            "user_id": user_id,
                            "repo": f"{owner}/{repo}",
                            "path": file.path,
                            "language": file.language,
                            "chunk_index": index,
                            "content": chunk[:8000],
                        }
                    )

            await (
                self._client.table("project_code_chunks")
                .delete()
                .eq("project_id", project_id)
                .execute()
            )

            await self._embed_rows(project_id, rows)
            await self._progress(project_id, 90, "menyimpan index")

            for start in range(0, len(rows), 200):
                await (
                    self._client.table("project_code_chunks")
                    .insert(rows[start : start + 200])
                    .execute()
                )

            await self._progress(project_id, 95, "menyusun ringkasan")
            summary = await self._summarize(f"{owner}/{repo}", files, fetched)
            await self._set_status(
                project_id,
                {
                    "repo_index_status": "ready",
                    "repo_branch": branch,
                    "repo_file_count": len(fetched),
                    "repo_chunk_count": len(rows),
                    "repo_summary": summary,
                    "repo_index_error": None,
                    "repo_index_progress": 100,
                    "repo_index_stage": "selesai",
                    "repo_indexed_at": datetime.now(timezone.utc).isoformat(),
                },
            )
        except GitHubError as exc:
            await self._set_status(
                project_id,
                {
                    "repo_index_status": "error",
                    "repo_index_error": str(exc),
                    "repo_index_progress": 0,
                    "repo_index_stage": None,
                },
            )
        except Exception as exc:  # noqa: BLE001 - background worker must not crash
            logger.exception("Repo indexing failed for %s", project_id)
            await self._set_status(
                project_id,
                {
                    "repo_index_status": "error",
                    "repo_index_error": str(exc)[:500],
                    "repo_index_progress": 0,
                    "repo_index_stage": None,
                },
            )

    async def _embed_rows(self, project_id: str, rows: list[dict[str, Any]]) -> None:
        if not rows or not self.embeddings_available:
            return
        try:
            batch = 16
            total = len(rows)
            for start in range(0, total, batch):
                slice_ = rows[start : start + batch]
                vectors = await self._embeddings.embed(
                    [row["content"] for row in slice_]
                )
                for row, vector in zip(slice_, vectors):
                    if len(vector) == 384:
                        row["embedding"] = _vector_literal(vector)
                        row["model"] = self._embeddings.name
                done = min(start + batch, total)
                await self._progress(
                    project_id,
                    55 + int(30 * done / max(total, 1)),
                    f"membuat embedding {done}/{total}",
                )
        except Exception:  # noqa: BLE001 - index still usable via keyword search
            logger.warning("Code embedding failed; storing chunks without vectors.")

    async def _summarize(
        self, repo: str, files: list[RepoFile], fetched: list[tuple[RepoFile, str]]
    ) -> str | None:
        if not self._llm:
            return None
        tree = "\n".join(file.path for file in files[:300])
        samples: list[str] = []
        remaining = 6000
        for file, content in fetched:
            if remaining <= 0:
                break
            snippet = content[:600]
            remaining -= len(snippet)
            samples.append(f"--- {file.path} ---\n{snippet}")
        prompt = (
            f"Repository: {repo}\n\nDAFTAR FILE:\n{tree}\n\n"
            f"CONTOH ISI FILE:\n" + "\n\n".join(samples)
        )
        try:
            answer, _ = await self._llm.complete(
                ChatRequest(
                    messages=[
                        ChatMessage(role="system", content=_REPO_SUMMARY_SYSTEM),
                        ChatMessage(role="user", content=prompt),
                    ],
                    model=self._settings.default_chat_model,
                    temperature=0.3,
                    max_tokens=900,
                    stream=False,
                )
            )
            return answer.strip() or None
        except LLMProviderError:
            return None
        except Exception:  # noqa: BLE001
            return None

    # -------------------------------------------------------------- retrieval
    async def _retrieve(self, project_id: str, query: str, limit: int) -> list[CodeSourceOut]:
        if self.embeddings_available:
            try:
                vectors = await self._embeddings.embed([query])
                if vectors and len(vectors[0]) == 384:
                    result = await self._client.rpc(
                        "match_code_chunks_semantic",
                        {
                            "query_embedding": _vector_literal(vectors[0]),
                            "filter_project": project_id,
                            "match_count": limit,
                            "min_similarity": 0.2,
                        },
                    ).execute()
                    rows = result.data or []
                    if rows:
                        return [
                            CodeSourceOut(
                                path=row["path"],
                                language=row.get("language", "text"),
                                snippet=row.get("content", ""),
                                score=float(row.get("similarity") or 0.0) or None,
                            )
                            for row in rows
                        ]
            except Exception:  # noqa: BLE001 - fall through to keyword search
                pass

        sources = await self._keyword_search(project_id, query, limit)
        if sources:
            return sources

        # Last resort: retry with the longest token. This catches identifiers
        # and file names when the full sentence is too noisy for FTS.
        tokens = sorted(
            {
                token
                for token in re.split(r"[^0-9A-Za-z_]+", query)
                if len(token) >= 4
            },
            key=len,
            reverse=True,
        )
        if tokens:
            return await self._keyword_search(project_id, tokens[0], limit)
        return []

    async def _keyword_search(
        self, project_id: str, query: str, limit: int
    ) -> list[CodeSourceOut]:
        result = await self._client.rpc(
            "search_code_chunks_keyword",
            {
                "query_text": query,
                "filter_project": project_id,
                "match_count": limit,
            },
        ).execute()
        return [
            CodeSourceOut(
                path=row["path"],
                language=row.get("language", "text"),
                snippet=row.get("content", ""),
                score=float(row.get("rank") or 0.0) or None,
            )
            for row in result.data or []
        ]

    async def _prepare_answer(
        self, project_id: str, question: str, persona: str = ""
    ) -> tuple[list[ChatMessage], list[CodeSourceOut], str | None, int]:
        """Build the chat messages + sources for a repo/project question.

        Returns ``(messages, sources, fallback_answer, max_tokens)``. When
        ``fallback_answer`` is set there is no context to ask the model with and
        the caller should return it verbatim.
        """
        chunks = await self._retrieve(
            project_id, question, self._settings.repo_qa_context_chunks
        )
        if not chunks:
            # No repo code to draw on: answer from the project itself so the
            # "Tanya proyek" feature works without a repository too.
            context = await self._project_context(project_id)
            if not context:
                return (
                    [],
                    [],
                    (
                        "Belum ada cukup konteks proyek untuk dijawab. Isi deskripsi/"
                        "catatan proyek, tambahkan dokumen, atau index repo lalu coba lagi."
                    ),
                    1500,
                )
            return (
                [
                    ChatMessage(
                        role="system",
                        content=(
                            f"{_PROJECT_QA_SYSTEM}\n\n{persona}"
                            if persona
                            else _PROJECT_QA_SYSTEM
                        ),
                    ),
                    ChatMessage(
                        role="user",
                        content=f"PERTANYAAN:\n{question}\n\nKONTEKS PROYEK:\n{context}",
                    ),
                ],
                [],
                None,
                1500,
            )

        context = "\n\n".join(
            f"--- {chunk.path} ---\n{chunk.snippet[:1200]}" for chunk in chunks
        )
        sources = [
            CodeSourceOut(
                path=chunk.path,
                language=chunk.language,
                snippet=chunk.snippet[:600],
                score=chunk.score,
            )
            for chunk in chunks
        ]
        return (
            [
                ChatMessage(
                    role="system",
                    content=(
                        f"{_CODE_QA_SYSTEM}\n\n{persona}" if persona else _CODE_QA_SYSTEM
                    ),
                ),
                ChatMessage(
                    role="user",
                    content=f"PERTANYAAN:\n{question}\n\nKONTEKS KODE:\n{context}",
                ),
            ],
            sources,
            None,
            1200,
        )

    async def answer(self, project_id: str, question: str, persona: str = "") -> RepoAskOut:
        messages, sources, fallback, max_tokens = await self._prepare_answer(
            project_id, question, persona
        )
        if fallback is not None:
            return RepoAskOut(answer=fallback, sources=[])
        if not self._llm:
            raise LLMProviderError("LLM tidak dikonfigurasi.")
        answer, _ = await self._llm.complete(
            ChatRequest(
                messages=messages,
                model=self._settings.default_chat_model,
                temperature=0.3,
                max_tokens=max_tokens,
                stream=False,
            )
        )
        return RepoAskOut(answer=answer.strip(), sources=sources)

    async def answer_stream(
        self, project_id: str, question: str, persona: str = ""
    ) -> AsyncIterator[tuple[str, Any]]:
        """Stream a repo/project answer as ``(kind, payload)`` tuples.

        Yields ``("token", str)`` for each delta, then a final
        ``("sources", list[CodeSourceOut])``. Raises :class:`LLMProviderError`
        when the provider is unavailable.
        """
        messages, sources, fallback, max_tokens = await self._prepare_answer(
            project_id, question, persona
        )
        if fallback is not None:
            yield ("token", fallback)
            yield ("sources", [])
            return
        if not self._llm:
            raise LLMProviderError("LLM tidak dikonfigurasi.")
        async for chunk in self._llm.stream_chat(
            ChatRequest(
                messages=messages,
                model=self._settings.default_chat_model,
                temperature=0.3,
                max_tokens=max_tokens,
                stream=True,
            )
        ):
            if chunk.delta:
                yield ("token", chunk.delta)
        yield ("sources", sources)


    async def _project_context(self, project_id: str, limit: int = 6000) -> str:
        """Project-level context (metadata, notes, documents, tasks, repo summary)."""
        try:
            response = (
                await self._client.table("projects")
                .select("*")
                .eq("id", project_id)
                .single()
                .execute()
            )
        except Exception:  # noqa: BLE001
            return ""
        project = response.data or {}
        lines = [
            f"- Nama: {project.get('name') or '(tanpa nama)'}",
            f"- Status: {project.get('status') or '-'}",
            f"- Deskripsi: {project.get('description') or '(kosong)'}",
            f"- Tech stack: {', '.join(project.get('tech_stack') or []) or '(kosong)'}",
            f"- Repo: {project.get('repo_full_name') or project.get('repo_url') or '(belum ada)'}",
            f"- Catatan: {project.get('notes') or '(kosong)'}",
        ]
        if project.get("repo_summary"):
            lines.append(f"- Ringkasan repo: {project['repo_summary']}")

        try:
            documents = (
                await self._client.table("project_documents")
                .select("*")
                .eq("project_id", project_id)
                .limit(20)
                .execute()
            ).data or []
        except Exception:  # noqa: BLE001
            documents = []
        for document in documents:
            body = document.get("url") if document.get("kind") == "link" else (document.get("content") or "")
            lines.append(
                f"- Dokumen [{document.get('kind')}] {document.get('title') or '(tanpa judul)'}: "
                f"{(body or '')[:500]}"
            )

        try:
            tasks = (
                await self._client.table("project_tasks")
                .select("title,status,priority")
                .eq("project_id", project_id)
                .limit(30)
                .execute()
            ).data or []
        except Exception:  # noqa: BLE001
            tasks = []
        for task in tasks:
            lines.append(
                f"- Tugas [{task.get('status')}] {task.get('title') or '(tanpa judul)'}"
            )

        text = "\n".join(lines)
        return text[:limit]
