"""Unit tests for the Vibe Coding workspace service.

Uses an in-memory Supabase stand-in and a scripted LLM so discovery, artifact
versioning, task generation, prompt assembly, verification, and cross-project
scoping are deterministic and need no network.
"""

from __future__ import annotations

import json

import pytest
from fastapi import HTTPException

from app.deps import CurrentUser
from app.llm import ChatRequest, LLMProviderError, StreamChunk
from app.routers.vibe import _service as vibe_router_service
from app.services.vibe_service import (
    VibeIntakeError,
    VibeOutputError,
    VibeService,
)
from tests.fake_supabase import FakeClient

USER_ID = "00000000-0000-0000-0000-000000000001"
PROJECT_ID = "11111111-1111-1111-1111-111111111111"
OTHER_PROJECT_ID = "22222222-2222-2222-2222-222222222222"


class FakeLLM:
    name = "fake"

    def __init__(self) -> None:
        self.answers: list[str] = []
        self.errors: list[Exception] = []
        self.metas: list[dict | None] = []
        self.requests: list[ChatRequest] = []

    def stream_chat(self, request: ChatRequest):  # pragma: no cover - unused
        async def _gen():
            yield StreamChunk(delta="")

        return _gen()

    async def complete(self, request: ChatRequest):
        self.requests.append(request)
        if self.errors:
            raise self.errors.pop(0)
        meta = self.metas.pop(0) if self.metas else None
        return self.answers.pop(0), meta


def make_client() -> FakeClient:
    client = FakeClient()
    client.seed(
        "projects",
        [
            {
                "id": PROJECT_ID,
                "user_id": USER_ID,
                "name": "Axtra",
                "description": "Personal AI agent",
                "status": "active",
                "tech_stack": ["Next.js", "FastAPI"],
                "notes": "",
                "source": "manual",
                "source_ref": {},
            },
            {
                "id": OTHER_PROJECT_ID,
                "user_id": USER_ID,
                "name": "Other",
                "description": "",
                "status": "idea",
                "tech_stack": [],
                "notes": "",
            },
        ],
    )
    return client


async def make_workspace(client: FakeClient, llm: FakeLLM) -> tuple[VibeService, str]:
    service = VibeService(client, llm, "fake-model")
    session = await service.create_session(
        USER_ID,
        PROJECT_ID,
        title="Idea",
        idea="Build a task app",
        problem="Tasks are scattered",
        target_users="Solo developers",
        constraints="Next.js + FastAPI",
    )
    return service, session.id


def discovery_json(reply: str = "Saya paham.") -> str:
    return json.dumps(
        {
            "reply": reply,
            "questions": [
                {
                    "question": "Satu pengguna atau tim?",
                    "options": ["Solo", "Tim"],
                    "recommended": "Solo",
                }
            ],
            "decisions": [
                {
                    "category": "users",
                    "statement": "Awalnya untuk pengguna solo",
                    "status": "ASSUMED",
                    "rationale": "Belum dikonfirmasi",
                }
            ],
        }
    )


@pytest.mark.asyncio
async def test_session_creation_and_persistence() -> None:
    client = make_client()
    service, session_id = await make_workspace(client, FakeLLM())

    session = await service.get_session(USER_ID, PROJECT_ID, session_id)
    assert session.raw_idea["idea"] == "Build a task app"
    assert session.stage == "discovery"

    updated = await service.update_session(
        USER_ID, PROJECT_ID, session_id, {"problem": "Tasks vanish", "stage": "planning"}
    )
    assert updated.raw_idea["problem"] == "Tasks vanish"
    assert updated.raw_idea["idea"] == "Build a task app"
    assert updated.stage == "planning"

    sessions = await service.list_sessions(USER_ID, PROJECT_ID)
    assert [item.id for item in sessions] == [session_id]


@pytest.mark.asyncio
async def test_discovery_persists_history_and_decisions() -> None:
    client = make_client()
    llm = FakeLLM()
    llm.answers.append(discovery_json())
    service, session_id = await make_workspace(client, llm)

    message, decisions, questions = await service.discovery(
        USER_ID, PROJECT_ID, session_id, "Aplikasi untuk mengelola task."
    )
    assert message.role == "assistant"
    assert message.metadata["questions"][0]["recommended"] == "Solo"
    assert questions[0].question.startswith("Satu pengguna")
    assert len(decisions) == 1
    assert decisions[0].status == "ASSUMED"

    history = await service.list_messages(session_id)
    assert [item.role for item in history] == ["user", "assistant"]
    assert history[0].content == "Aplikasi untuk mengelola task."

    # A second turn includes the prior history in the prompt and does not
    # duplicate an identical decision.
    llm.answers.append(discovery_json("Baik, lanjut."))
    await service.discovery(USER_ID, PROJECT_ID, session_id, "Lanjut.")
    decisions_after = await service.list_decisions(session_id)
    assert len(decisions_after) == 1
    prompt = llm.requests[-1].messages[-1].content
    assert "RIWAYAT DISCOVERY TERAKHIR" in prompt
    assert "Aplikasi untuk mengelola task." in prompt


@pytest.mark.asyncio
async def test_discovery_rejects_malformed_model_output() -> None:
    client = make_client()
    llm = FakeLLM()
    llm.answers.append("bukan json")
    service, session_id = await make_workspace(client, llm)

    with pytest.raises(VibeOutputError):
        await service.discovery(USER_ID, PROJECT_ID, session_id, "Halo")
    history = await service.list_messages(session_id)
    # The user's turn is preserved so it can be retried without retyping.
    assert [item.role for item in history] == ["user"]


@pytest.mark.asyncio
async def test_artifact_versioning_and_approval() -> None:
    client = make_client()
    llm = FakeLLM()
    service, session_id = await make_workspace(client, llm)

    llm.answers.append("# PRD\n\nVersi satu")
    first = await service.generate_artifact(
        USER_ID, PROJECT_ID, session_id, "PRD"
    )
    assert first.version == 1
    assert first.status == "DRAFT"

    approved = await service.approve_artifact(session_id, "PRD")
    assert approved.status == "APPROVED"
    assert approved.reviewed_at is not None

    # Regenerating an approved document never overwrites silently: it creates a
    # new version that needs review, while the approved revision stays in history.
    llm.answers.append("# PRD\n\nVersi dua")
    second = await service.generate_artifact(USER_ID, PROJECT_ID, session_id, "PRD")
    assert second.version == 2
    assert second.status == "NEEDS_REVIEW"

    versions = await service.list_versions(second.id)
    assert [item.version for item in versions] == [2, 1]
    assert versions[1].status == "APPROVED"
    assert "Versi satu" in versions[1].content


@pytest.mark.asyncio
async def test_manual_edit_creates_new_version_and_decision_change_marks_stale() -> None:
    client = make_client()
    llm = FakeLLM()
    llm.answers.append("# PRD\n\nAwal")
    service, session_id = await make_workspace(client, llm)
    await service.generate_artifact(USER_ID, PROJECT_ID, session_id, "PRD")
    await service.approve_artifact(session_id, "PRD")

    edited = await service.save_artifact_edit(
        USER_ID, PROJECT_ID, session_id, "PRD", "# PRD\n\nDiedit", note="perbaikan"
    )
    assert edited.version == 2
    assert edited.status == "NEEDS_REVIEW"

    decision = await service.create_decision(
        USER_ID,
        session_id,
        category="product",
        statement="Fitur A masuk MVP",
        status="NEEDS_DECISION",
        rationale="",
    )
    await service.update_decision(
        session_id, decision.id, {"status": "CONFIRMED"}
    )
    artifact = await service.get_artifact(session_id, "PRD")
    assert artifact.status == "STALE"


@pytest.mark.asyncio
async def test_task_generation_prompt_and_verification() -> None:
    client = make_client()
    llm = FakeLLM()
    llm.answers.append("# PRD\n\nFitur dasar")
    service, session_id = await make_workspace(client, llm)
    await service.generate_artifact(USER_ID, PROJECT_ID, session_id, "PRD")
    await service.approve_artifact(session_id, "PRD")

    llm.answers.append(
        json.dumps(
            {
                "tasks": [
                    {
                        "key": "T-001",
                        "title": "Bangun API task",
                        "goal": "CRUD task bekerja",
                        "scope": "backend saja",
                        "affected_modules": ["backend/app/routers/tasks.py"],
                        "dependencies": [],
                        "acceptance_criteria": ["POST membuat task", "GET mengembalikan task"],
                        "testing": "pytest",
                        "risky_operations": "",
                        "priority": "high",
                    }
                ]
            }
        )
    )
    tasks = await service.generate_tasks(USER_ID, PROJECT_ID, session_id)
    assert len(tasks) == 1
    task = tasks[0]
    assert task.vibe_task_key == "T-001"
    assert task.source == "vibe"
    assert task.acceptance_criteria == ["POST membuat task", "GET mengembalikan task"]
    assert task.verification_status == "TODO"

    # Regenerating does not duplicate an existing key.
    llm.answers.append(
        json.dumps({"tasks": [{"key": "T-001", "title": "Duplikat"}]})
    )
    await service.generate_tasks(USER_ID, PROJECT_ID, session_id)
    assert len(await service.list_session_tasks(session_id)) == 1

    prompt = await service.build_prompt(
        USER_ID, PROJECT_ID, session_id, task.id
    )
    assert "Bangun API task" in prompt
    assert "Fitur dasar" in prompt  # approved artifact is included
    assert "Security & Boundaries" in prompt
    assert "Expected Completion Report" in prompt

    with pytest.raises(ValueError):
        await service.update_verification(
            PROJECT_ID, session_id, task.id, status="DONE", evidence="", notes=""
        )

    verified = await service.update_verification(
        PROJECT_ID,
        session_id,
        task.id,
        status="DONE",
        evidence="pytest: 4 passed",
        notes="ok",
    )
    assert verified.verification_status == "DONE"
    assert verified.status == "done"
    assert verified.verification_evidence == "pytest: 4 passed"


@pytest.mark.asyncio
async def test_cross_project_and_cross_session_access_is_rejected() -> None:
    client = make_client()
    service, session_id = await make_workspace(client, FakeLLM())

    with pytest.raises(Exception):
        await service.get_session(USER_ID, OTHER_PROJECT_ID, session_id)

    assert await service.list_session_tasks("33333333-3333-3333-3333-333333333333") == []
    with pytest.raises(Exception):
        await service.get_artifact("33333333-3333-3333-3333-333333333333", "PRD")

    # Router-level ownership gate: the project must belong to the owner.
    user = CurrentUser(id=USER_ID, email=None, token="t", client=client)
    with pytest.raises(HTTPException) as exc:
        await vibe_router_service(user, "44444444-4444-4444-4444-444444444444")
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_llm_provider_failure_propagates() -> None:
    client = make_client()
    llm = FakeLLM()
    llm.errors.append(LLMProviderError("Groq error 500: upstream failure"))
    service, session_id = await make_workspace(client, llm)

    with pytest.raises(LLMProviderError):
        await service.discovery(USER_ID, PROJECT_ID, session_id, "Halo")
    # The user message is persisted, no assistant turn is fabricated.
    history = await service.list_messages(session_id)
    assert [item.role for item in history] == ["user"]


@pytest.mark.asyncio
async def test_rate_limit_error_is_retried() -> None:
    client = make_client()
    llm = FakeLLM()
    llm.errors.append(
        LLMProviderError(
            "Groq error 429: rate_limit_exceeded on tokens per minute (TPM): "
            "Limit 8000, Requested 9000. Please try again in 0s."
        )
    )
    llm.answers.append(discovery_json("Berhasil setelah retry."))
    service, session_id = await make_workspace(client, llm)

    message, _, _ = await service.discovery(USER_ID, PROJECT_ID, session_id, "Halo")
    assert "retry" in message.content
    assert len(llm.requests) == 2


def _set_repo_ready(client: FakeClient) -> None:
    row = client.table("projects").rows[0]
    row["repo_index_status"] = "ready"
    row["repo_indexed_at"] = "2026-11-01T00:00:00+00:00"
    row["repo_summary"] = "Aplikasi task sederhana dengan router dan service."


async def _make_intake_session(
    service: VibeService, *, entry_mode: str, template_key: str | None = None
) -> str:
    session = await service.create_session(
        USER_ID,
        PROJECT_ID,
        title="Ubah fitur",
        idea="",
        problem="",
        target_users="",
        constraints="",
        entry_mode=entry_mode,
        template_key=template_key,
        request="Tambah filter pada daftar task.",
    )
    return session.id


@pytest.mark.asyncio
async def test_create_session_intake_mode_and_tech_stack() -> None:
    client = make_client()
    service = VibeService(client, FakeLLM(), "fake-model")
    session = await service.create_session(
        USER_ID,
        PROJECT_ID,
        title="Aplikasi baru",
        idea="Landing page produk",
        problem="",
        target_users="",
        constraints="",
        entry_mode="greenfield",
        template_key="landing-page",
        tech_stack=["Next.js + TypeScript + Tailwind"],
    )
    assert session.stage == "intake"
    assert session.entry_mode == "greenfield"
    assert session.template_key == "landing-page"
    # tech stack is written to the project, not the session
    project_rows = client.table("projects").rows
    assert project_rows[0]["tech_stack"] == ["Next.js + TypeScript + Tailwind"]


@pytest.mark.asyncio
async def test_analyze_intake_brownfield_requires_index() -> None:
    client = make_client()
    service = VibeService(client, FakeLLM(), "fake-model")
    session_id = await _make_intake_session(service, entry_mode="brownfield")
    with pytest.raises(VibeIntakeError) as exc:
        await service.analyze_intake(USER_ID, PROJECT_ID, session_id)
    assert exc.value.code == "repo_not_indexed"


@pytest.mark.asyncio
async def test_analyze_intake_brownfield_writes_summary_and_baseline() -> None:
    client = make_client()
    _set_repo_ready(client)
    llm = FakeLLM()
    llm.answers.append("## Ringkasan\nProyek sehat.")
    service = VibeService(client, llm, "fake-model")
    session_id = await _make_intake_session(service, entry_mode="brownfield")

    result = await service.analyze_intake(USER_ID, PROJECT_ID, session_id)
    assert result["entry_mode"] == "brownfield"
    assert "Proyek sehat" in result["analysis"]
    assert result["baseline_indexed_at"] is not None

    stored = await service.get_session(USER_ID, PROJECT_ID, session_id)
    assert "Proyek sehat" in stored.summary
    assert stored.baseline_indexed_at is not None


@pytest.mark.asyncio
async def test_analyze_intake_greenfield_returns_template() -> None:
    client = make_client()
    service = VibeService(client, FakeLLM(), "fake-model")
    session = await service.create_session(
        USER_ID,
        PROJECT_ID,
        title="Baru",
        idea="Chatbot",
        problem="",
        target_users="",
        constraints="",
        entry_mode="greenfield",
        template_key="chatbot-rag",
    )
    result = await service.analyze_intake(USER_ID, PROJECT_ID, session.id)
    assert result["template"] is not None
    assert result["template"]["key"] == "chatbot-rag"


@pytest.mark.asyncio
async def test_analyze_intake_greenfield_requires_template() -> None:
    client = make_client()
    service = VibeService(client, FakeLLM(), "fake-model")
    session_id = await _make_intake_session(service, entry_mode="greenfield")
    with pytest.raises(VibeIntakeError) as exc:
        await service.analyze_intake(USER_ID, PROJECT_ID, session_id)
    assert exc.value.code == "template_required"


@pytest.mark.asyncio
async def test_classify_intake_uses_matrix_and_confirm_persists() -> None:
    client = make_client()
    llm = FakeLLM()
    llm.answers.append(
        json.dumps(
            {
                "scope": "small",
                "touches_data_api": True,
                "rationale": "Menambah kolom dan endpoint filter.",
            }
        )
    )
    service = VibeService(client, llm, "fake-model")
    session_id = await _make_intake_session(service, entry_mode="brownfield")

    result = await service.classify_intake(USER_ID, PROJECT_ID, session_id)
    assert result["scope"] == "small"
    assert result["touches_data_api"] is True
    assert "DATA_MODEL" in result["required_artifacts"]
    assert "API_SPEC" in result["required_artifacts"]

    # Nothing is persisted until the user confirms.
    before = await service.get_session(USER_ID, PROJECT_ID, session_id)
    assert before.feature_scope is None
    confirmed = await service.confirm_intake(
        USER_ID,
        PROJECT_ID,
        session_id,
        scope="small",
        touches_data_api=True,
    )
    assert confirmed.feature_scope == "small"
    assert "DATA_MODEL" in confirmed.required_artifacts
    assert confirmed.stage == "discovery"


@pytest.mark.asyncio
async def test_confirm_intake_greenfield_follows_template() -> None:
    client = make_client()
    service = VibeService(client, FakeLLM(), "fake-model")
    session = await service.create_session(
        USER_ID,
        PROJECT_ID,
        title="Landing",
        idea="Landing page produk",
        problem="",
        target_users="",
        constraints="",
        entry_mode="greenfield",
        template_key="landing-page",
    )
    confirmed = await service.confirm_intake(
        USER_ID,
        PROJECT_ID,
        session.id,
        scope="large",
        touches_data_api=False,
    )
    # large = exactly the kinds the landing-page template declares; no data/API.
    assert confirmed.required_artifacts == [
        "PRD",
        "ACCEPTANCE_TEST_PLAN",
        "UI_UX_SPEC",
        "AGENT_INSTRUCTIONS",
        "IMPLEMENTATION_PLAN",
        "DEFINITION_OF_DONE",
    ]
    assert confirmed.stage == "discovery"


@pytest.mark.asyncio
async def test_classify_intake_rejects_malformed_output() -> None:
    client = make_client()
    llm = FakeLLM()
    llm.answers.append("bukan json")
    service = VibeService(client, llm, "fake-model")
    session_id = await _make_intake_session(service, entry_mode="brownfield")
    with pytest.raises(VibeOutputError):
        await service.classify_intake(USER_ID, PROJECT_ID, session_id)


@pytest.mark.asyncio
async def test_metering_records_token_usage() -> None:
    client = make_client()
    llm = FakeLLM()
    llm.answers.append(discovery_json("Oke."))
    llm.metas.append(
        {"usage": {"prompt_tokens": 100, "completion_tokens": 40, "total_tokens": 140}}
    )
    service, session_id = await make_workspace(client, llm)
    await service.discovery(USER_ID, PROJECT_ID, session_id, "Halo")

    rows = client.table("token_usage_events").rows
    assert len(rows) == 1
    assert rows[0]["source"] == "vibe"
    assert rows[0]["total_tokens"] == 140


@pytest.mark.asyncio
async def test_plan_lists_required_and_optional_kinds() -> None:
    client = make_client()
    service = VibeService(client, FakeLLM(), "fake-model")
    session_id = await _make_intake_session(service, entry_mode="brownfield")
    await service.update_session(
        USER_ID,
        PROJECT_ID,
        session_id,
        {"required_artifacts": ["PRD", "API_SPEC"], "feature_scope": "medium"},
    )
    plan = await service.get_plan(USER_ID, PROJECT_ID, session_id)
    assert plan["required_artifacts"] == ["PRD", "API_SPEC"]
    required_flags = {item["kind"]: item["required"] for item in plan["items"]}
    assert required_flags["PRD"] is True
    assert required_flags["API_SPEC"] is True
    assert required_flags["UI_UX_SPEC"] is False


@pytest.mark.asyncio
async def test_staleness_only_marks_affected_kinds() -> None:
    client = make_client()
    llm = FakeLLM()
    llm.answers.append("# PRD\n\nisi")
    llm.answers.append("# UI\n\nisi")
    service, session_id = await make_workspace(client, llm)
    await service.generate_artifact(USER_ID, PROJECT_ID, session_id, "PRD")
    await service.generate_artifact(USER_ID, PROJECT_ID, session_id, "UI_UX_SPEC")
    await service.approve_artifact(session_id, "PRD")
    await service.approve_artifact(session_id, "UI_UX_SPEC")

    decision = await service.create_decision(
        USER_ID,
        session_id,
        category="uiux",
        statement="Tombol biru",
        status="NEEDS_DECISION",
        rationale="",
    )
    # Editing the statement (not just the status) must mark dependents stale.
    await service.update_decision(session_id, decision.id, {"statement": "Tombol hijau"})

    assert (await service.get_artifact(session_id, "UI_UX_SPEC")).status == "STALE"
    assert (await service.get_artifact(session_id, "PRD")).status == "APPROVED"


@pytest.mark.asyncio
async def test_small_scope_caps_generated_tasks() -> None:
    client = make_client()
    llm = FakeLLM()
    service = VibeService(client, llm, "fake-model")
    session_id = await _make_intake_session(service, entry_mode="brownfield")
    await service.update_session(
        USER_ID, PROJECT_ID, session_id, {"feature_scope": "small"}
    )
    llm.answers.append(
        json.dumps({"tasks": [{"key": "T-001", "title": "Kecil"}]})
    )
    await service.generate_tasks(USER_ID, PROJECT_ID, session_id, max_tasks=12)
    prompt = llm.requests[-1].messages[-1].content
    assert "MAKSIMUM: 4" in prompt