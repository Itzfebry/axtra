"""Tests for the headless agent surface: API-token auth, menu/theme state,
server-side action execution, and the job queue.
"""

from __future__ import annotations

import pytest

from app.config import Settings, get_settings
from app.deps import get_current_user
from app.main import app
from app.services.agent_job_service import claim_next_job, enqueue_job, run_jobs
from fastapi.testclient import TestClient
from tests.fake_supabase import FakeClient

OWNER = "00000000-0000-0000-0000-000000000001"


def _settings() -> Settings:
    # No parameters: an override with ``**kwargs`` makes FastAPI treat them as
    # required query params.
    return Settings(
        supabase_url="https://fake.supabase.co",
        supabase_service_role_key="fake",
        app_password="pw",
        session_secret="secret",
        owner_user_id=OWNER,
        api_token="tok_123",
        groq_api_key="",
        rate_limit_per_minute=30,
        read_rate_limit_per_minute=300,
    )


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    fake = FakeClient()

    async def _owner_client() -> FakeClient:
        return fake

    monkeypatch.setattr("app.supabase_client.get_owner_client", _owner_client)
    monkeypatch.setattr("app.deps.get_owner_client", _owner_client)
    app.dependency_overrides[get_settings] = _settings
    with TestClient(app) as test_client:
        test_client.fake = fake  # type: ignore[attr-defined]
        yield test_client
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# API token auth
# ---------------------------------------------------------------------------
def test_api_token_header_authenticates_without_cookie(client: TestClient) -> None:
    assert client.get("/api/agent/state").status_code == 401
    ok = client.get("/api/agent/state", headers={"X-API-Key": "tok_123"})
    assert ok.status_code == 200
    assert ok.json()["order"] == []


def test_wrong_api_token_is_rejected(client: TestClient) -> None:
    assert client.get("/api/agent/state", headers={"X-API-Key": "nope"}).status_code == 401
    bearer = client.get("/api/agent/state", headers={"Authorization": "Bearer nope"})
    assert bearer.status_code == 401


def test_bearer_token_authenticates(client: TestClient) -> None:
    response = client.get(
        "/api/agent/state", headers={"Authorization": "Bearer tok_123"}
    )
    assert response.status_code == 200


# ---------------------------------------------------------------------------
# Menu/theme state
# ---------------------------------------------------------------------------
def test_state_put_is_partial_and_persists(client: TestClient) -> None:
    headers = {"X-API-Key": "tok_123"}
    put = client.put(
        "/api/agent/state",
        headers=headers,
        json={"order": ["chat", "memory"], "hidden": ["jobs"]},
    )
    assert put.status_code == 200
    assert put.json()["order"] == ["chat", "memory"]

    # A theme-only PUT must not wipe the menu, and vice versa.
    client.put("/api/agent/state", headers=headers, json={"theme": "dark"})
    state = client.get("/api/agent/state", headers=headers).json()
    assert state["theme"] == "dark"
    assert state["order"] == ["chat", "memory"]
    assert state["hidden"] == ["jobs"]


# ---------------------------------------------------------------------------
# Server-side action execution
# ---------------------------------------------------------------------------
async def test_apply_runs_actions_without_a_browser(client: TestClient) -> None:
    headers = {"X-API-Key": "tok_123"}
    response = client.post(
        "/api/agent/apply",
        headers=headers,
        json={
            "actions": [
                {"type": "menu_rename", "labels": {"chat": "Ngobrol"}},
                {"type": "set_theme", "theme": "light"},
                {"type": "reset_menu"},
                {"type": "focus_menu", "target": "chat"},
            ]
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert "focus_menu:tidak dieksekusi server" in body["skipped"]
    assert body["state"]["order"] == []
    assert body["state"]["labels"] == {}


async def test_apply_queues_chat_jobs_for_navigation_actions(client: TestClient) -> None:
    headers = {"X-API-Key": "tok_123"}
    response = client.post(
        "/api/agent/apply",
        headers=headers,
        json={
            "actions": [
                {"type": "new_conversation", "mode": "brainstorming", "prompt": "ide konten"},
                {"type": "navigate", "href": "/chat/research"},
            ]
        },
    )
    body = response.json()
    assert len(body["queued_job_ids"]) == 1
    assert "navigate:tidak ada prompt" in body["skipped"]


async def test_apply_creates_schedule_without_a_browser(client: TestClient) -> None:
    response = client.post(
        "/api/agent/apply",
        headers={"X-API-Key": "tok_123"},
        json={
            "actions": [
                {"type": "create_schedule", "title": "minum obat", "due_in_minutes": 30}
            ]
        },
    )
    assert response.status_code == 200
    assert response.json()["executed"][0].startswith("create_schedule:")


# ---------------------------------------------------------------------------
# Job queue
# ---------------------------------------------------------------------------
async def test_job_claim_is_single_shot(client: TestClient) -> None:
    fake: FakeClient = client.fake  # type: ignore[attr-defined]
    job = await enqueue_job(fake, OWNER, prompt="halo", mode="general")
    first = await claim_next_job(fake, OWNER)
    second = await claim_next_job(fake, OWNER)
    assert first and first["id"] == job["id"]
    assert second is None


async def test_run_jobs_marks_failure_when_llm_missing(client: TestClient) -> None:
    fake: FakeClient = client.fake  # type: ignore[attr-defined]
    await enqueue_job(fake, OWNER, prompt="halo")
    settings = _settings()  # no GROQ_API_KEY -> the provider cannot be built
    finished = await run_jobs(fake, settings, limit=1)
    assert len(finished) == 1
    assert finished[0]["status"] == "failed"


# ---------------------------------------------------------------------------
# Cron auth: the ticker may carry the automation token instead of CRON_SECRET
# ---------------------------------------------------------------------------
def test_cron_authorize_accepts_cron_secret_and_api_token() -> None:
    from types import SimpleNamespace

    from app.routers.cron import _authorize

    settings = _settings()
    settings.cron_secret = "cron_secret_value"

    def request(headers: dict[str, str]) -> SimpleNamespace:
        return SimpleNamespace(headers=headers)

    _authorize(request({"authorization": "Bearer cron_secret_value"}), settings)
    _authorize(request({"x-api-key": "tok_123"}), settings)
    with pytest.raises(Exception):
        _authorize(request({"x-api-key": "nope"}), settings)
