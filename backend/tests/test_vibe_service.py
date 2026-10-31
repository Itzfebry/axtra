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
from app.services.vibe_service import VibeOutputError, VibeService
from tests.fake_supabase import FakeClient

USER_ID = "00000000-0000-0000-0000-000000000001"
PROJECT_ID = "11111111-1111-1111-1111-111111111111"
OTHER_PROJECT_ID = "22222222-2222-2222-2222-222222222222"


class FakeLLM:
    name = "fake"

    def __init__(self) -> None:
        self.answers: list[str] = []
        self.errors: list[Exception] = []
        self.requests: list[ChatRequest] = []

    def stream_chat(self, request: ChatRequest):  # pragma: no cover - unused
        async def _gen():
            yield StreamChunk(delta="")

        return _gen()

    async def complete(self, request: ChatRequest):
        self.requests.append(request)
        if self.errors:
            raise self.errors.pop(0)
        return self.answers.pop(0), None


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