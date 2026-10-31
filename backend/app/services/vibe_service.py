"""Vibe Coding workspace service.

Owns the idea -> discovery -> specification -> planning -> verification
workflow. All rows are scoped by the owner id and by the parent project; the
router verifies project ownership before calling into this service.

Generated model output is treated as untrusted: discovery/task JSON is parsed
and validated with Pydantic before it is persisted, and artifacts are only
stored as Markdown text. LLM provider failures bubble up as
``LLMProviderError`` so the router can return a clean 503.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field, ValidationError
from supabase import AsyncClient

from app.llm import ChatMessage, ChatRequest, LLMProvider, LLMProviderError
from app.schemas import (
    ProjectDocumentOut,
    ProjectOut,
    ProjectTaskOut,
    VibeArtifactKind,
    VibeArtifactOut,
    VibeArtifactStatus,
    VibeArtifactVersionOut,
    VibeDecisionOut,
    VibeDecisionStatus,
    VibeMessageOut,
    VibeQuestion,
    VibeSessionOut,
    VibeVerificationStatus,
)
from app.services.project_service import _row_to_project, _row_to_task

logger = logging.getLogger("axtra.vibe")

ARTIFACT_KINDS: tuple[VibeArtifactKind, ...] = (
    "PRD",
    "ARCHITECTURE",
    "ACCEPTANCE_TEST_PLAN",
    "UI_UX_SPEC",
    "AGENT_INSTRUCTIONS",
    "IMPLEMENTATION_PLAN",
    "DEFINITION_OF_DONE",
)

ARTIFACT_TITLES: dict[VibeArtifactKind, str] = {
    "PRD": "Product Requirements Document",
    "ARCHITECTURE": "Arsitektur & Desain Teknis",
    "ACCEPTANCE_TEST_PLAN": "Rencana Pengujian & Acceptance",
    "UI_UX_SPEC": "Spesifikasi UI/UX",
    "AGENT_INSTRUCTIONS": "Instruksi Agen Coding",
    "IMPLEMENTATION_PLAN": "Rencana Implementasi",
    "DEFINITION_OF_DONE": "Definition of Done",
}

_ARTIFACT_GUIDE: dict[VibeArtifactKind, str] = {
    "PRD": (
        "Tulis PRD Markdown: tujuan produk, problem statement, target pengguna, "
        "functional & non-functional requirements bernomor, scope in/out, "
        "business rules, constraints, assumptions, dan risks. Tandai asumsi "
        "dengan jelas."
    ),
    "ARCHITECTURE": (
        "Tulis spesifikasi arsitektur Markdown: technology stack, komponen/sistem, "
        "modul, data model, API contracts, security, integrations, deployment, "
        "dan technical trade-offs. Sebutkan alternatif yang ditolak bila relevan."
    ),
    "ACCEPTANCE_TEST_PLAN": (
        "Tulis rencana pengujian Markdown yang ditautkan ke requirement: acceptance "
        "criteria, happy path, negative cases, edge cases, integration tests, "
        "regression tests, dan perintah verifikasi konkret."
    ),
    "UI_UX_SPEC": (
        "Tulis spesifikasi UI/UX Markdown: information architecture, daftar layar, "
        "interaksi, design system, responsive behavior, accessibility, loading, "
        "error, empty, dan success states."
    ),
    "AGENT_INSTRUCTIONS": (
        "Tulis instruksi untuk agen coding eksternal: coding conventions, aturan "
        "repository, perubahan yang diizinkan/dilarang, kebijakan dependency, "
        "batasan keamanan, aturan testing, dan format laporan penyelesaian."
    ),
    "IMPLEMENTATION_PLAN": (
        "Tulis rencana implementasi Markdown: task berurutan dengan ID, goal, "
        "scope, modul terdampak, dependencies, acceptance criteria, prioritas, "
        "dan status. Dukung eksekusi inkremental/prototype lebih dulu."
    ),
    "DEFINITION_OF_DONE": (
        "Tulis Definition of Done Markdown: quality checks wajib, code review, "
        "test relevan, lint, type checking, build validation, security checks, "
        "documentation updates, dan pelaporan berbasis bukti."
    ),
}

_DISCOVERY_SYSTEM = """\
Kamu adalah product engineer senior yang memandu discovery produk. Tugasmu \
membantu pengguna mengubah ide mentah menjadi spesifikasi yang jelas tanpa \
menanyakan hal yang sudah ada di konteks proyek/repo. Bahasa: Bahasa Indonesia, \
kecuali pengguna memakai bahasa lain.

Balas HANYA JSON valid dengan bentuk:
{
  "reply": "Markdown ringkas: ringkasan pemahaman, hal yang sudah jelas, dan alasan pertanyaan berikutnya",
  "questions": [
    {"question": "...", "options": ["...", "..."], "recommended": "..."}
  ],
  "decisions": [
    {"category": "product|users|features|data|architecture|security|uiux|testing|performance|deployment|cost|business",
     "statement": "...", "status": "CONFIRMED|ASSUMED|RESEARCH|NEEDS_DECISION|VALIDATION_REQUIRED",
     "rationale": "..."}
  ]
}

Aturan:
- Maksimal 3 pertanyaan per turn, pilih yang paling berdampak. Sertakan opsi \
jawaban praktis dan rekomendasi bila pengguna ragu.
- Jangan mengulang pertanyaan yang sudah dijawab. Jangan menanyakan hal yang \
sudah terlihat dari konteks proyek/repo/dokumen.
- Jangan mengubah asumsi menjadi CONFIRMED tanpa pernyataan eksplisit pengguna. \
Gunakan ASSUMED / NEEDS_DECISION / VALIDATION_REQUIRED bila belum pasti.
- Evaluasi hanya kategori yang relevan. Jika ide sudah cukup matang, questions \
boleh kosong dan decisions berisi keputusan yang perlu dikonfirmasi.
- Jangan pernah meminta secret, API key, atau data sensitif.
- "reply" harus ringkas (maksimal 180 kata), tanpa basa-basi.
"""

_TASK_SYSTEM = """\
Kamu adalah technical lead yang memecah spesifikasi menjadi task implementasi \
kecil dan dapat dieksekusi agen coding. Bahasa: Bahasa Indonesia.

Balas HANYA JSON valid dengan bentuk:
{
  "tasks": [
    {
      "key": "T-001",
      "title": "...",
      "goal": "hasil yang diharapkan",
      "scope": "batasan pekerjaan",
      "affected_modules": ["path/atau modul"],
      "dependencies": ["T-000"],
      "acceptance_criteria": ["kriteria terukur"],
      "testing": "perintah/strategi verifikasi",
      "risky_operations": "operasi berisiko atau kosong",
      "priority": "low|medium|high"
    }
  ]
}

Aturan:
- Task harus inkremental: task pertama boleh berupa prototype yang tidak \
membutuhkan seluruh spesifikasi selesai.
- Jangan mengarang file yang tidak diketahui; isi affected_modules hanya bila \
didukung konteks.
- Maksimal task sesuai permintaan. Dependencies hanya merujuk key dalam daftar.
- Jangan menyertakan rahasia atau kredensial.
"""

_ARTIFACT_COMMON = """\
Gunakan hanya fakta dari konteks di bawah. Jangan mengarang fitur atau bukti. \
Tandai asumsi dengan kata "Asumsi:" dan hal yang perlu diverifikasi dengan \
"Perlu validasi:". Output hanya Markdown dokumen, tanpa pagar kode pembungkus. \
Jangan menyertakan API key, token, atau data pribadi sensitif.
"""

_JSON_BLOCK = re.compile(r"```(?:json)?\s*(.*?)```", re.IGNORECASE | re.DOTALL)


class VibeOutputError(ValueError):
    """Raised when the model returns malformed structured data."""


# ---------------------------------------------------------------------------
# Internal validation models (model output is untrusted)
# ---------------------------------------------------------------------------
class _QuestionPayload(BaseModel):
    question: str = Field(default="", max_length=1000)
    options: list[str] = Field(default_factory=list, max_length=6)
    recommended: str | None = Field(default=None, max_length=1000)


class _DecisionPayload(BaseModel):
    category: str = Field(default="general", max_length=60)
    statement: str = Field(min_length=1, max_length=2000)
    status: VibeDecisionStatus = "ASSUMED"
    rationale: str = Field(default="", max_length=2000)


class _DiscoveryPayload(BaseModel):
    reply: str = Field(min_length=1, max_length=12000)
    questions: list[_QuestionPayload] = Field(default_factory=list, max_length=3)
    decisions: list[_DecisionPayload] = Field(default_factory=list, max_length=20)


class _TaskPayload(BaseModel):
    key: str = Field(default="", max_length=40)
    title: str = Field(min_length=1, max_length=300)
    goal: str = Field(default="", max_length=4000)
    scope: str = Field(default="", max_length=4000)
    affected_modules: list[str] = Field(default_factory=list, max_length=30)
    dependencies: list[str] = Field(default_factory=list, max_length=30)
    acceptance_criteria: list[str] = Field(default_factory=list, max_length=20)
    testing: str = Field(default="", max_length=4000)
    risky_operations: str = Field(default="", max_length=2000)
    priority: str = Field(default="medium", max_length=20)


class _TaskListPayload(BaseModel):
    tasks: list[_TaskPayload] = Field(default_factory=list, max_length=20)


def _balanced_object(text: str) -> str | None:
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def _parse_json(raw: str) -> dict[str, Any] | None:
    text = (raw or "").strip()
    fence = _JSON_BLOCK.search(text)
    if fence:
        text = fence.group(1).strip()
    candidate = _balanced_object(text) or text
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _clip(text: str | None, limit: int) -> str:
    value = (text or "").strip()
    if len(value) <= limit:
        return value
    return value[:limit] + "..."


def _join_context(parts: list[str], limit: int) -> str:
    """Join context sections and cap the total size.

    Groq's free tier caps tokens per minute, and the request reserves
    ``max_tokens`` on top of the prompt. Budgeting the prompt keeps a single
    generation under the ceiling so it does not 429 regardless of waiting.
    """
    return _clip("\n\n".join(part for part in parts if part), limit)


def _strip_fence(raw: str) -> str:
    text = (raw or "").strip()
    fence = re.match(r"^```(?:markdown|md)?\s*(.*?)```$", text, re.DOTALL | re.IGNORECASE)
    if fence:
        return fence.group(1).strip()
    return text


_RETRY_AFTER = re.compile(r"try again in\s+([0-9]+(?:\.[0-9]+)?)\s*s", re.IGNORECASE)


def _rate_limit_delay(error_text: str) -> float | None:
    """Seconds Groq asks us to wait, or None when the error is not a 429."""
    lowered = error_text.lower()
    if "429" not in error_text and "rate_limit" not in lowered and "tpm" not in lowered:
        return None
    match = _RETRY_AFTER.search(error_text)
    if match:
        return min(float(match.group(1)) + 1.0, 30.0)
    return 5.0


def _string_list(value: Any, limit: int = 30) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip()[:500] for item in value if str(item).strip()][:limit]


def _row_to_session(row: dict[str, Any]) -> VibeSessionOut:
    raw = row.get("raw_idea")
    return VibeSessionOut(
        id=row["id"],
        project_id=row["project_id"],
        title=row.get("title", "") or "",
        raw_idea=raw if isinstance(raw, dict) else {},
        stage=row.get("stage", "discovery") or "discovery",
        summary=row.get("summary", "") or "",
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


def _row_to_message(row: dict[str, Any]) -> VibeMessageOut:
    metadata = row.get("metadata")
    return VibeMessageOut(
        id=row["id"],
        session_id=row["session_id"],
        role=row.get("role", "assistant"),
        content=row.get("content", "") or "",
        metadata=metadata if isinstance(metadata, dict) else {},
        created_at=row.get("created_at"),
    )


def _row_to_decision(row: dict[str, Any]) -> VibeDecisionOut:
    return VibeDecisionOut(
        id=row["id"],
        session_id=row["session_id"],
        category=row.get("category", "general") or "general",
        statement=row.get("statement", "") or "",
        status=row.get("status", "ASSUMED") or "ASSUMED",
        rationale=row.get("rationale", "") or "",
        source=row.get("source", "ai") or "ai",
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


def _row_to_artifact(row: dict[str, Any]) -> VibeArtifactOut:
    return VibeArtifactOut(
        id=row["id"],
        session_id=row["session_id"],
        project_id=row["project_id"],
        kind=row.get("kind", "PRD"),
        title=row.get("title", "") or "",
        content=row.get("content", "") or "",
        status=row.get("status", "DRAFT") or "DRAFT",
        version=int(row.get("version") or 1),
        generated_by=row.get("generated_by", "ai") or "ai",
        reviewed_at=row.get("reviewed_at"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


def _row_to_version(row: dict[str, Any]) -> VibeArtifactVersionOut:
    return VibeArtifactVersionOut(
        id=row["id"],
        artifact_id=row["artifact_id"],
        version=int(row.get("version") or 1),
        content=row.get("content", "") or "",
        status=row.get("status", "DRAFT") or "DRAFT",
        note=row.get("note", "") or "",
        created_at=row.get("created_at"),
    )


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class VibeService:
    def __init__(
        self,
        client: AsyncClient,
        llm: LLMProvider | None,
        model: str,
        persona: str = "",
    ) -> None:
        self._client = client
        self._llm = llm
        self._model = model
        self._persona = persona

    def _system(self, base: str) -> str:
        return f"{base}\n\n{self._persona}" if self._persona else base

    async def _complete(self, request: ChatRequest) -> tuple[str, dict | None]:
        if self._llm is None:
            raise LLMProviderError("GROQ_API_KEY is not configured.")
        # Groq enforces a per-minute token budget; a 429 tells us exactly how
        # long to wait. Retry a couple of times so a transient window passes
        # instead of surfacing a hard failure to the user.
        for attempt in range(3):
            try:
                return await self._llm.complete(request)
            except LLMProviderError as exc:
                delay = _rate_limit_delay(str(exc))
                if delay is None or attempt == 2:
                    raise
                logger.info(
                    "LLM rate limited (attempt %s); retrying in %.1fs", attempt + 1, delay
                )
                await asyncio.sleep(delay)
        raise LLMProviderError("LLM request failed.")

    # --------------------------------------------------------------- projects
    async def _load_project(self, user_id: str, project_id: str) -> ProjectOut:
        response = (
            await self._client.table("projects")
            .select("*")
            .eq("id", project_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        return _row_to_project(response.data)

    async def _load_documents(self, project_id: str) -> list[ProjectDocumentOut]:
        response = (
            await self._client.table("project_documents")
            .select("*")
            .eq("project_id", project_id)
            .order("created_at", desc=True)
            .limit(12)
            .execute()
        )
        documents: list[ProjectDocumentOut] = []
        for row in response.data or []:
            documents.append(
                ProjectDocumentOut(
                    id=row["id"],
                    project_id=row["project_id"],
                    title=row.get("title", "") or "",
                    kind=row.get("kind", "note") or "note",
                    url=row.get("url"),
                    content=row.get("content", "") or "",
                    source=row.get("source", "manual") or "manual",
                    created_at=row.get("created_at"),
                    updated_at=row.get("updated_at"),
                )
            )
        return documents

    # --------------------------------------------------------------- sessions
    async def list_sessions(
        self, user_id: str, project_id: str
    ) -> list[VibeSessionOut]:
        response = (
            await self._client.table("vibe_sessions")
            .select("*")
            .eq("project_id", project_id)
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .execute()
        )
        return [_row_to_session(row) for row in response.data or []]

    async def get_session(
        self, user_id: str, project_id: str, session_id: str
    ) -> VibeSessionOut:
        response = (
            await self._client.table("vibe_sessions")
            .select("*")
            .eq("id", session_id)
            .eq("project_id", project_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        return _row_to_session(response.data)

    async def create_session(
        self,
        user_id: str,
        project_id: str,
        *,
        title: str,
        idea: str,
        problem: str,
        target_users: str,
        constraints: str,
    ) -> VibeSessionOut:
        payload = {
            "project_id": project_id,
            "user_id": user_id,
            "title": (title or idea.strip()[:80] or "Ide baru")[:200],
            "raw_idea": {
                "idea": idea.strip(),
                "problem": problem.strip(),
                "target_users": target_users.strip(),
                "constraints": constraints.strip(),
            },
            "stage": "discovery",
        }
        response = (
            await self._client.table("vibe_sessions").insert(payload).execute()
        )
        return _row_to_session(response.data[0])

    async def update_session(
        self, user_id: str, project_id: str, session_id: str, patch: dict[str, Any]
    ) -> VibeSessionOut:
        current = await self.get_session(user_id, project_id, session_id)
        clean: dict[str, Any] = {}
        for key in ("title", "idea", "problem", "target_users", "constraints"):
            value = patch.get(key)
            if value is None:
                continue
            if key == "title":
                clean["title"] = str(value).strip()[:200]
            else:
                raw = dict(current.raw_idea)
                raw[key] = str(value).strip()
                clean["raw_idea"] = raw
        if patch.get("summary") is not None:
            clean["summary"] = str(patch["summary"]).strip()[:8000]
        if patch.get("stage") is not None:
            clean["stage"] = patch["stage"]
        if not clean:
            return current
        response = (
            await self._client.table("vibe_sessions")
            .update(clean)
            .eq("id", session_id)
            .eq("project_id", project_id)
            .eq("user_id", user_id)
            .execute()
        )
        if not response.data:
            raise KeyError("session_not_found")
        return _row_to_session(response.data[0])

    async def delete_session(
        self, user_id: str, project_id: str, session_id: str
    ) -> None:
        await (
            self._client.table("vibe_sessions")
            .delete()
            .eq("id", session_id)
            .eq("project_id", project_id)
            .eq("user_id", user_id)
            .execute()
        )

    # --------------------------------------------------------------- messages
    async def list_messages(
        self, session_id: str, limit: int = 200
    ) -> list[VibeMessageOut]:
        response = (
            await self._client.table("vibe_messages")
            .select("*")
            .eq("session_id", session_id)
            .order("created_at")
            .limit(max(1, min(limit, 500)))
            .execute()
        )
        return [_row_to_message(row) for row in response.data or []]

    async def _insert_message(
        self,
        session_id: str,
        user_id: str,
        role: str,
        content: str,
        metadata: dict[str, Any] | None = None,
    ) -> VibeMessageOut:
        response = (
            await self._client.table("vibe_messages")
            .insert(
                {
                    "session_id": session_id,
                    "user_id": user_id,
                    "role": role,
                    "content": content,
                    "metadata": metadata or {},
                }
            )
            .execute()
        )
        return _row_to_message(response.data[0])

    # -------------------------------------------------------------- decisions
    async def list_decisions(self, session_id: str) -> list[VibeDecisionOut]:
        response = (
            await self._client.table("vibe_decisions")
            .select("*")
            .eq("session_id", session_id)
            .order("created_at")
            .execute()
        )
        return [_row_to_decision(row) for row in response.data or []]

    async def create_decision(
        self,
        user_id: str,
        session_id: str,
        *,
        category: str,
        statement: str,
        status: VibeDecisionStatus,
        rationale: str,
        source: str = "manual",
    ) -> VibeDecisionOut:
        response = (
            await self._client.table("vibe_decisions")
            .insert(
                {
                    "session_id": session_id,
                    "user_id": user_id,
                    "category": category[:60] or "general",
                    "statement": statement.strip()[:2000],
                    "status": status,
                    "rationale": rationale.strip()[:2000],
                    "source": source[:40],
                }
            )
            .execute()
        )
        return _row_to_decision(response.data[0])

    async def update_decision(
        self,
        session_id: str,
        decision_id: str,
        patch: dict[str, Any],
    ) -> VibeDecisionOut:
        current = (
            await self._client.table("vibe_decisions")
            .select("*")
            .eq("id", decision_id)
            .eq("session_id", session_id)
            .single()
            .execute()
        )
        previous_status = current.data.get("status") if current.data else None
        clean = {key: value for key, value in patch.items() if value is not None}
        if not clean:
            return _row_to_decision(current.data)
        response = (
            await self._client.table("vibe_decisions")
            .update(clean)
            .eq("id", decision_id)
            .eq("session_id", session_id)
            .execute()
        )
        if not response.data:
            raise KeyError("decision_not_found")
        # A changed decision invalidates approved documents that may depend on it.
        if (
            "status" in clean
            and previous_status
            and clean["status"] != previous_status
        ):
            await self._mark_session_artifacts_stale(session_id)
        return _row_to_decision(response.data[0])

    async def delete_decision(self, session_id: str, decision_id: str) -> None:
        await (
            self._client.table("vibe_decisions")
            .delete()
            .eq("id", decision_id)
            .eq("session_id", session_id)
            .execute()
        )

    async def _mark_session_artifacts_stale(self, session_id: str) -> None:
        try:
            await (
                self._client.table("vibe_artifacts")
                .update({"status": "STALE"})
                .eq("session_id", session_id)
                .in_("status", ["APPROVED", "NEEDS_REVIEW"])
                .execute()
            )
        except Exception:  # noqa: BLE001 - staleness is best-effort
            logger.warning("Failed to mark vibe artifacts stale for %s", session_id)

    # -------------------------------------------------------------- discovery
    async def discovery(
        self,
        user_id: str,
        project_id: str,
        session_id: str,
        content: str,
    ) -> tuple[VibeMessageOut, list[VibeDecisionOut], list[VibeQuestion]]:
        session = await self.get_session(user_id, project_id, session_id)
        project = await self._load_project(user_id, project_id)
        documents = await self._load_documents(project_id)
        decisions = await self.list_decisions(session_id)
        history = await self.list_messages(session_id, limit=20)

        await self._insert_message(session_id, user_id, "user", content.strip())

        prompt = self._discovery_context(session, project, documents, decisions, history)
        answer, _ = await self._complete(
            ChatRequest(
                messages=[
                    ChatMessage(role="system", content=self._system(_DISCOVERY_SYSTEM)),
                    ChatMessage(role="user", content=_join_context([prompt], 9000)),
                ],
                model=self._model,
                temperature=0.4,
                max_tokens=2200,
                stream=False,
            )
        )
        if not (answer or "").strip():
            raise VibeOutputError("Model mengembalikan jawaban kosong.")
        parsed = _parse_json(answer)
        if parsed is None:
            raise VibeOutputError("Model tidak mengembalikan JSON discovery yang valid.")
        try:
            payload = _DiscoveryPayload.model_validate(parsed)
        except ValidationError as exc:
            raise VibeOutputError(
                "Struktur JSON discovery tidak valid."
            ) from exc

        created: list[VibeDecisionOut] = []
        existing = {(item.category.lower(), item.statement.strip().lower()) for item in decisions}
        for item in payload.decisions:
            key = (item.category.lower(), item.statement.strip().lower())
            if key in existing:
                continue
            created.append(
                await self.create_decision(
                    user_id,
                    session_id,
                    category=item.category,
                    statement=item.statement,
                    status=item.status,
                    rationale=item.rationale,
                    source="ai",
                )
            )
            existing.add(key)

        questions = [
            VibeQuestion(
                question=item.question.strip(),
                options=[option.strip() for option in item.options if option.strip()][:6],
                recommended=item.recommended,
            )
            for item in payload.questions
            if item.question.strip()
        ]
        message = await self._insert_message(
            session_id,
            user_id,
            "assistant",
            _strip_fence(payload.reply),
            {
                "questions": [question.model_dump() for question in questions],
                "decision_ids": [item.id for item in created],
            },
        )
        await self.update_session(
            user_id, project_id, session_id, {"stage": "discovery"}
        )
        return message, created, questions

    # -------------------------------------------------------------- artifacts
    async def list_artifacts(self, session_id: str) -> list[VibeArtifactOut]:
        response = (
            await self._client.table("vibe_artifacts")
            .select("*")
            .eq("session_id", session_id)
            .order("kind")
            .execute()
        )
        return [_row_to_artifact(row) for row in response.data or []]

    async def get_artifact(
        self, session_id: str, kind: VibeArtifactKind
    ) -> VibeArtifactOut:
        response = (
            await self._client.table("vibe_artifacts")
            .select("*")
            .eq("session_id", session_id)
            .eq("kind", kind)
            .single()
            .execute()
        )
        return _row_to_artifact(response.data)

    async def list_versions(
        self, artifact_id: str
    ) -> list[VibeArtifactVersionOut]:
        response = (
            await self._client.table("vibe_artifact_versions")
            .select("*")
            .eq("artifact_id", artifact_id)
            .order("version", desc=True)
            .execute()
        )
        return [_row_to_version(row) for row in response.data or []]

    async def generate_artifact(
        self,
        user_id: str,
        project_id: str,
        session_id: str,
        kind: VibeArtifactKind,
        instructions: str = "",
    ) -> VibeArtifactOut:
        session = await self.get_session(user_id, project_id, session_id)
        project = await self._load_project(user_id, project_id)
        decisions = await self.list_decisions(session_id)
        documents = await self._load_documents(project_id)
        artifacts = await self.list_artifacts(session_id)

        context = [
            self._project_context(project, documents),
            self._idea_context(session),
            self._decision_context(decisions),
            self._artifact_context(artifacts, exclude=kind),
        ]
        if instructions.strip():
            context.append(f"INSTRUKSI TAMBAHAN DARI PENGGUNA:\n{_clip(instructions, 4000)}")
        user_prompt = _join_context(context, 9000)

        # Documents need far more room than a single 3k response; oversized
        # requests get cut mid-section (finish_reason="length"). Allow a large
        # per-call budget and continue the document until the model reports a
        # natural stop instead of storing a truncated draft.
        token_budget = 8000
        continuation_cap = 3
        system_msg = ChatMessage(
            role="system",
            content=(
                f"{_ARTIFACT_COMMON}\n\nDOKUMEN YANG DIMINTA: "
                f"{ARTIFACT_TITLES[kind]}\n{_ARTIFACT_GUIDE[kind]}"
                + (f"\n\n{self._persona}" if self._persona else "")
            ),
        )
        user_msg = ChatMessage(role="user", content=user_prompt)

        chunks: list[str] = []
        finish_reason: str | None = "length"
        messages = [system_msg, user_msg]
        for _ in range(continuation_cap + 1):
            answer, meta = await self._complete(
                ChatRequest(
                    messages=messages,
                    model=self._model,
                    temperature=0.35,
                    max_tokens=token_budget,
                    stream=False,
                )
            )
            if not answer:
                break
            chunks.append(answer)
            finish_reason = (meta or {}).get("finish_reason") or "stop"
            if finish_reason != "length":
                break
            messages = [
                system_msg,
                user_msg,
                ChatMessage(role="assistant", content="\n".join(chunks)),
                ChatMessage(
                    role="user",
                    content=(
                        "Dokumen di atas terpotong karena batas panjang. Lanjutkan "
                        "persis dari bagian setelah potongan terakhir. Jangan "
                        "mengulang, meringkas, atau memperkenalkan ulang dokumen."
                    ),
                ),
            ]

        content = _strip_fence("\n".join(chunks).strip())
        if not content:
            raise VibeOutputError("Model mengembalikan dokumen kosong.")
        if len(content) > 100000:
            content = content[:100000]

        artifact = await self._save_new_version(
            user_id,
            project_id,
            session_id,
            kind,
            content,
            generated_by="ai",
            note="Dihasilkan AI",
        )
        await self.update_session(
            user_id, project_id, session_id, {"stage": "specification"}
        )
        return artifact

    async def save_artifact_edit(
        self,
        user_id: str,
        project_id: str,
        session_id: str,
        kind: VibeArtifactKind,
        content: str,
        note: str = "",
    ) -> VibeArtifactOut:
        await self.get_session(user_id, project_id, session_id)
        content = (content or "").strip()
        if not content:
            raise ValueError("Isi dokumen tidak boleh kosong.")
        return await self._save_new_version(
            user_id,
            project_id,
            session_id,
            kind,
            content,
            generated_by="manual",
            note=(note or "Diedit manual")[:500],
        )

    async def _save_new_version(
        self,
        user_id: str,
        project_id: str,
        session_id: str,
        kind: VibeArtifactKind,
        content: str,
        *,
        generated_by: str,
        note: str,
    ) -> VibeArtifactOut:
        existing_rows = (
            await self._client.table("vibe_artifacts")
            .select("*")
            .eq("session_id", session_id)
            .eq("kind", kind)
            .execute()
        )
        existing = existing_rows.data[0] if existing_rows.data else None
        if existing is None:
            version = 1
            status: VibeArtifactStatus = "DRAFT"
            response = (
                await self._client.table("vibe_artifacts")
                .insert(
                    {
                        "session_id": session_id,
                        "project_id": project_id,
                        "user_id": user_id,
                        "kind": kind,
                        "title": ARTIFACT_TITLES[kind],
                        "content": content,
                        "status": status,
                        "version": version,
                        "generated_by": generated_by,
                    }
                )
                .execute()
            )
            artifact = _row_to_artifact(response.data[0])
        else:
            version = int(existing.get("version") or 1) + 1
            # Approved content is never silently replaced: the new revision
            # asks for review and the old approved version stays in history.
            status = (
                "NEEDS_REVIEW"
                if existing.get("status") in ("APPROVED", "STALE", "NEEDS_REVIEW")
                else "DRAFT"
            )
            response = (
                await self._client.table("vibe_artifacts")
                .update(
                    {
                        "title": ARTIFACT_TITLES[kind],
                        "content": content,
                        "status": status,
                        "version": version,
                        "generated_by": generated_by,
                        "reviewed_at": None,
                    }
                )
                .eq("id", existing["id"])
                .execute()
            )
            artifact = _row_to_artifact(response.data[0])

        await (
            self._client.table("vibe_artifact_versions")
            .insert(
                {
                    "artifact_id": artifact.id,
                    "user_id": user_id,
                    "version": version,
                    "content": content,
                    "status": status,
                    "note": note,
                }
            )
            .execute()
        )
        return artifact

    async def approve_artifact(
        self, session_id: str, kind: VibeArtifactKind
    ) -> VibeArtifactOut:
        artifact = await self.get_artifact(session_id, kind)
        reviewed_at = _iso_now()
        response = (
            await self._client.table("vibe_artifacts")
            .update({"status": "APPROVED", "reviewed_at": reviewed_at})
            .eq("id", artifact.id)
            .execute()
        )
        await (
            self._client.table("vibe_artifact_versions")
            .update({"status": "APPROVED"})
            .eq("artifact_id", artifact.id)
            .eq("version", artifact.version)
            .execute()
        )
        return _row_to_artifact(response.data[0])

    async def mark_artifact_stale(
        self, session_id: str, kind: VibeArtifactKind
    ) -> VibeArtifactOut:
        artifact = await self.get_artifact(session_id, kind)
        response = (
            await self._client.table("vibe_artifacts")
            .update({"status": "STALE"})
            .eq("id", artifact.id)
            .execute()
        )
        return _row_to_artifact(response.data[0])

    # ------------------------------------------------------------------ tasks
    async def list_session_tasks(self, session_id: str) -> list[ProjectTaskOut]:
        response = (
            await self._client.table("project_tasks")
            .select("*")
            .eq("vibe_session_id", session_id)
            .order("position")
            .order("created_at")
            .execute()
        )
        return [_row_to_task(row) for row in response.data or []]

    async def generate_tasks(
        self,
        user_id: str,
        project_id: str,
        session_id: str,
        max_tasks: int = 8,
    ) -> list[ProjectTaskOut]:
        session = await self.get_session(user_id, project_id, session_id)
        project = await self._load_project(user_id, project_id)
        decisions = await self.list_decisions(session_id)
        documents = await self._load_documents(project_id)
        artifacts = await self.list_artifacts(session_id)
        existing = await self.list_session_tasks(session_id)

        context = [
            self._project_context(project, documents),
            self._idea_context(session),
            self._decision_context(decisions),
            self._artifact_context(artifacts),
            f"JUMLAH TASK MAKSIMUM: {max_tasks}",
        ]
        if existing:
            context.append(
                "TASK YANG SUDAH ADA (jangan duplikasi key):\n"
                + "\n".join(f"- {task.vibe_task_key}: {task.title}" for task in existing)
            )
        answer, _ = await self._complete(
            ChatRequest(
                messages=[
                    ChatMessage(role="system", content=self._system(_TASK_SYSTEM)),
                    ChatMessage(role="user", content=_join_context(context, 8000)),
                ],
                model=self._model,
                temperature=0.3,
                max_tokens=4000,
                stream=False,
            )
        )
        parsed = _parse_json(answer)
        if parsed is None:
            raise VibeOutputError(
                "Model tidak mengembalikan JSON task yang valid. "
                "Coba kurangi jumlah task atau konteks."
            )
        try:
            payload = _TaskListPayload.model_validate(parsed)
        except ValidationError as exc:
            raise VibeOutputError("Struktur JSON task tidak valid.") from exc
        if not payload.tasks:
            raise VibeOutputError("Model tidak menghasilkan task.")

        existing_keys = {task.vibe_task_key for task in existing if task.vibe_task_key}
        position = max((task.position for task in existing), default=-1) + 1
        for index, task in enumerate(payload.tasks[:max_tasks]):
            key = (task.key or f"T-{index + 1:03d}").strip()[:40]
            if key in existing_keys:
                continue
            detail_parts = [
                f"Goal: {task.goal.strip()}" if task.goal.strip() else "",
                f"Scope: {task.scope.strip()}" if task.scope.strip() else "",
                f"Testing: {task.testing.strip()}" if task.testing.strip() else "",
                (
                    f"Risky operations: {task.risky_operations.strip()}"
                    if task.risky_operations.strip()
                    else ""
                ),
            ]
            priority = task.priority if task.priority in ("low", "medium", "high") else "medium"
            await (
                self._client.table("project_tasks")
                .insert(
                    {
                        "project_id": project_id,
                        "user_id": user_id,
                        "title": task.title.strip()[:300],
                        "detail": "\n".join(part for part in detail_parts if part)[:4000],
                        "status": "todo",
                        "priority": priority,
                        "position": position,
                        "source": "vibe",
                        "vibe_session_id": session_id,
                        "vibe_task_key": key,
                        "acceptance_criteria": _string_list(task.acceptance_criteria, 20),
                        "dependencies": _string_list(task.dependencies, 30),
                        "affected_modules": _string_list(task.affected_modules, 30),
                        "testing_notes": task.testing.strip()[:4000],
                        "verification_status": "TODO",
                    }
                )
                .execute()
            )
            existing_keys.add(key)
            position += 1

        await self.update_session(
            user_id, project_id, session_id, {"stage": "planning"}
        )
        return await self.list_session_tasks(session_id)

    async def build_prompt(
        self,
        user_id: str,
        project_id: str,
        session_id: str,
        task_id: str,
    ) -> str:
        session = await self.get_session(user_id, project_id, session_id)
        project = await self._load_project(user_id, project_id)
        response = (
            await self._client.table("project_tasks")
            .select("*")
            .eq("id", task_id)
            .eq("project_id", project_id)
            .eq("vibe_session_id", session_id)
            .single()
            .execute()
        )
        task = _row_to_task(response.data)
        artifacts = await self.list_artifacts(session_id)
        # Prefer approved artifacts; fall back to the current drafts so a
        # prototype task can still be handed off early.
        approved = [item for item in artifacts if item.status == "APPROVED" and item.content.strip()]
        chosen = approved or [item for item in artifacts if item.content.strip()]
        relevant_kinds = {
            "PRD",
            "ARCHITECTURE",
            "UI_UX_SPEC",
            "ACCEPTANCE_TEST_PLAN",
            "AGENT_INSTRUCTIONS",
            "DEFINITION_OF_DONE",
        }
        chosen = [item for item in chosen if item.kind in relevant_kinds]
        chosen.sort(key=lambda item: ARTIFACT_KINDS.index(item.kind))

        repo_line = project.repo_full_name or project.repo_url or "(belum ada repo)"
        sections = [
            "# Instruksi Implementasi untuk Coding Agent",
            f"## Task {task.vibe_task_key or task.id}\n**{task.title}**",
            "## Konteks Proyek\n"
            + "\n".join(
                [
                    f"- Nama: {project.name}",
                    f"- Deskripsi: {_clip(project.description, 800) or '(kosong)'}",
                    f"- Tech stack: {', '.join(project.tech_stack) or '(belum diisi)'}",
                    f"- Repo: {repo_line}",
                    f"- Ringkasan repo: {_clip(project.repo_summary, 1500) or '(belum ada)'}",
                    f"- Ide/feature: {session.title}",
                    f"- Problem: {_clip(str(session.raw_idea.get('problem', '')), 800) or '(belum diisi)'}",
                    f"- Target pengguna: {_clip(str(session.raw_idea.get('target_users', '')), 500) or '(belum diisi)'}",
                    f"- Constraints: {_clip(str(session.raw_idea.get('constraints', '')), 800) or '(belum diisi)'}",
                ]
            ),
            "## Goal\n" + (_clip(task.detail, 2000) or task.title),
            "## Scope\n"
            + ("\n".join(f"- {item}" for item in task.affected_modules) or "- Ikuti scope task di atas; jangan memperluas pekerjaan tanpa persetujuan."),
            "## Acceptance Criteria\n"
            + ("\n".join(f"- [ ] {item}" for item in task.acceptance_criteria) or "- [ ] Perilaku sesuai goal task."),
            "## Dependencies\n"
            + ("\n".join(f"- {item}" for item in task.dependencies) or "- Tidak ada dependensi eksplisit."),
            "## Testing & Verification\n"
            + (task.testing_notes or "Jalankan test relevan, lint, typecheck, dan build proyek."),
            "## Security & Boundaries\n"
            + "\n".join(
                [
                    "- Jangan pernah mencetak, menyimpan, atau mengirim secret/API key/token.",
                    "- Jangan menjalankan operasi destruktif pada database atau repository.",
                    "- Jangan commit/push/deploy otomatis tanpa persetujuan manusia.",
                    "- Jangan mengubah file di luar scope tanpa menjelaskan alasannya.",
                    "- Minta persetujuan sebelum operasi berisiko.",
                ]
            ),
            "## Expected Completion Report\n"
            + "\n".join(
                [
                    "- Ringkasan perubahan dan file yang disentuh.",
                    "- Acceptance criteria: status per item + bukti.",
                    "- Perintah test/lint/typecheck/build yang dijalankan beserta hasil.",
                    "- Risiko, keterbatasan, dan pekerjaan yang belum selesai.",
                    "- Asumsi baru atau requirement yang perlu diperbarui.",
                ]
            ),
        ]
        if chosen:
            sections.append(
                "## Approved Project Artifacts\n"
                + "\n\n".join(
                    f"### {item.title or item.kind}\n{_clip(item.content, 4000)}"
                    for item in chosen
                )
            )
        sections.append(
            "## Catatan\nDokumen di atas adalah spesifikasi, bukan kode yang sudah "
            "diimplementasikan. Laporkan hasil aktual, jangan mengklaim test lulus "
            "tanpa bukti."
        )
        return "\n\n".join(sections)

    async def update_verification(
        self,
        project_id: str,
        session_id: str,
        task_id: str,
        *,
        status: VibeVerificationStatus,
        evidence: str,
        notes: str,
    ) -> ProjectTaskOut:
        response = (
            await self._client.table("project_tasks")
            .select("*")
            .eq("id", task_id)
            .eq("project_id", project_id)
            .eq("vibe_session_id", session_id)
            .single()
            .execute()
        )
        if not response.data:
            raise KeyError("task_not_found")
        if status == "DONE" and not evidence.strip():
            raise ValueError(
                "Bukti verifikasi wajib diisi sebelum menandai task DONE."
            )
        task_status = {
            "DONE": "done",
            "TODO": "todo",
        }.get(status, "doing")
        updated = (
            await self._client.table("project_tasks")
            .update(
                {
                    "verification_status": status,
                    "verification_evidence": evidence.strip()[:20000],
                    "verification_notes": notes.strip()[:5000],
                    "status": task_status,
                    "completed_at": _iso_now() if task_status == "done" else None,
                }
            )
            .eq("id", task_id)
            .eq("project_id", project_id)
            .execute()
        )
        return _row_to_task(updated.data[0])

    # ---------------------------------------------------------------- context
    def _discovery_context(
        self,
        session: VibeSessionOut,
        project: ProjectOut,
        documents: list[ProjectDocumentOut],
        decisions: list[VibeDecisionOut],
        history: list[VibeMessageOut],
    ) -> str:
        messages = "\n".join(
            f"[{item.role}] {_clip(item.content, 1200)}" for item in history[-12:]
        )
        return "\n\n".join(
            part
            for part in [
                self._project_context(project, documents),
                self._idea_context(session),
                self._decision_context(decisions),
                f"RIWAYAT DISCOVERY TERAKHIR:\n{messages or '(belum ada)'}",
                "TUGAS: berikan ringkasan pemahaman, maksimal 3 pertanyaan paling "
                "berdampak, dan keputusan/asumsi baru yang perlu dicatat.",
            ]
            if part
        )

    def _project_context(
        self, project: ProjectOut, documents: list[ProjectDocumentOut]
    ) -> str:
        docs: list[str] = []
        remaining = 2400
        for document in documents:
            if remaining <= 0:
                break
            body = document.url if document.kind == "link" else _clip(document.content, 500)
            line = f"- [{document.kind}] {document.title or '(tanpa judul)'}: {body}"
            docs.append(line)
            remaining -= len(line)
        return "\n".join(
            [
                "KONTEKS PROYEK:",
                f"- Nama: {project.name}",
                f"- Status: {project.status}",
                f"- Deskripsi: {_clip(project.description, 1200) or '(kosong)'}",
                f"- Tech stack: {', '.join(project.tech_stack) or '(belum diisi)'}",
                f"- Repo: {project.repo_full_name or project.repo_url or '(belum ada)'}",
                f"- Ringkasan repo: {_clip(project.repo_summary, 2000) or '(belum ada)'}",
                f"- Catatan: {_clip(project.notes, 1500) or '(kosong)'}",
                "DOKUMEN PROYEK (non-repo):",
                "\n".join(docs) or "(tidak ada)",
            ]
        )

    def _idea_context(self, session: VibeSessionOut) -> str:
        idea = session.raw_idea
        return "\n".join(
            [
                f"IDE MENTAH ({session.title}):",
                f"- Yang ingin dibangun: {_clip(str(idea.get('idea', '')), 3000) or '(kosong)'}",
                f"- Masalah: {_clip(str(idea.get('problem', '')), 2000) or '(kosong)'}",
                f"- Target pengguna: {_clip(str(idea.get('target_users', '')), 1200) or '(kosong)'}",
                f"- Preferensi/kendala/teknologi: {_clip(str(idea.get('constraints', '')), 2000) or '(kosong)'}",
            ]
        )

    def _decision_context(self, decisions: list[VibeDecisionOut]) -> str:
        if not decisions:
            return ""
        lines = [
            f"- [{item.status}] ({item.category}) {item.statement}"
            + (f" — {_clip(item.rationale, 300)}" if item.rationale else "")
            for item in decisions[:40]
        ]
        return "KEPUTUSAN & ASUMSI:\n" + "\n".join(lines)

    def _artifact_context(
        self, artifacts: list[VibeArtifactOut], exclude: VibeArtifactKind | None = None
    ) -> str:
        selected = [
            item
            for item in artifacts
            if item.content.strip() and item.kind != exclude
        ]
        if not selected:
            return ""
        selected.sort(key=lambda item: ARTIFACT_KINDS.index(item.kind))
        return "ARTEFAK YANG SUDAH ADA:\n" + "\n\n".join(
            f"### {item.title or item.kind} [{item.status}]\n{_clip(item.content, 1200)}"
            for item in selected[:5]
        )
