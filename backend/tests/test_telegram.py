"""Tests for Telegram helpers, cron guards, and journal/goal schemas."""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import app
from app.routers.cron import _quiet
from app.schemas import GoalCreate, JournalEntryCreate, TelegramSettingsUpdate
from app.services.journal_service import today_wib
from app.services.telegram_client import (
    escape_html,
    markdown_to_telegram_html,
    split_message,
)
from app.services.telegram_store import in_quiet_hours


# ---------------------------------------------------------------------------
# Telegram client helpers
# ---------------------------------------------------------------------------
def test_escape_html_escapes_markup_characters() -> None:
    assert escape_html("a & b <c> d") == "a &amp; b &lt;c&gt; d"


def test_split_message_short_text_is_one_chunk() -> None:
    assert split_message("halo") == ["halo"]


def test_split_message_splits_on_newlines_under_limit() -> None:
    text = "\n".join(["x" * 50] * 10)  # 509 chars
    chunks = split_message(text, limit=120)
    assert len(chunks) > 1
    assert all(len(chunk) <= 120 for chunk in chunks)
    # No content lost except the newlines used as split points.
    assert "".join(chunks).replace("\n", "") == text.replace("\n", "")


def test_split_message_hard_cuts_when_no_newline() -> None:
    chunks = split_message("y" * 250, limit=100)
    assert [len(chunk) for chunk in chunks] == [100, 100, 50]


def test_split_message_balances_open_tags() -> None:
    text = "<b>" + ("a" * 250) + "</b>"
    chunks = split_message(text, limit=100)
    assert len(chunks) > 1
    for chunk in chunks:
        assert chunk.count("<b>") == chunk.count("</b>")
        assert chunk.startswith("<b>")
        assert chunk.endswith("</b>")


# ---------------------------------------------------------------------------
# Markdown -> Telegram HTML
# ---------------------------------------------------------------------------
def test_markdown_bold_italic_strike() -> None:
    assert markdown_to_telegram_html("**tebal**") == "<b>tebal</b>"
    assert markdown_to_telegram_html("*miring*") == "<i>miring</i>"
    assert markdown_to_telegram_html("~~coret~~") == "<s>coret</s>"


def test_markdown_inline_code_escapes_content() -> None:
    assert markdown_to_telegram_html("`a < b`") == "<code>a &lt; b</code>"


def test_markdown_fenced_code_block() -> None:
    source = '```py\nprint("<x>")\n```'
    assert markdown_to_telegram_html(source) == (
        '<pre><code class="language-py">print("&lt;x&gt;")</code></pre>'
    )


def test_markdown_heading_becomes_bold() -> None:
    assert markdown_to_telegram_html("## Judul") == "<b>Judul</b>"


def test_markdown_list_and_quote() -> None:
    assert markdown_to_telegram_html("- satu") == "• satu"
    assert markdown_to_telegram_html("1. dua") == "1. dua"
    assert markdown_to_telegram_html("> kutip") == "<blockquote>kutip</blockquote>"


def test_markdown_link() -> None:
    assert markdown_to_telegram_html("[Axtra](https://axtra.app)") == (
        '<a href="https://axtra.app">Axtra</a>'
    )


def test_markdown_neutralises_raw_html() -> None:
    assert markdown_to_telegram_html("<script>x</script>") == (
        "&lt;script&gt;x&lt;/script&gt;"
    )


# ---------------------------------------------------------------------------
# Quiet hours
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("start", "end", "hour", "expected"),
    [
        (22, 7, 23, True),
        (22, 7, 2, True),
        (22, 7, 7, False),
        (22, 7, 21, False),
        (9, 17, 10, True),
        (9, 17, 17, False),
        (9, 17, 8, False),
        (22, 22, 23, False),
    ],
)
def test_in_quiet_hours(start: int, end: int, hour: int, expected: bool) -> None:
    link = {"quiet_start": start, "quiet_end": end}
    assert in_quiet_hours(link, hour) is expected
    assert _quiet(link, hour) is expected


def test_in_quiet_hours_defaults_when_missing() -> None:
    assert in_quiet_hours({}, 23) is True
    assert in_quiet_hours({}, 12) is False


# ---------------------------------------------------------------------------
# Schemas / journal helpers
# ---------------------------------------------------------------------------
def test_telegram_settings_rejects_out_of_range_hour() -> None:
    with pytest.raises(ValueError):
        TelegramSettingsUpdate(report_hour=24)
    with pytest.raises(ValueError):
        TelegramSettingsUpdate(quiet_start=-1)
    assert TelegramSettingsUpdate(report_hour=5).report_hour == 5


def test_goal_and_journal_payload_defaults() -> None:
    goal = GoalCreate(title="Belajar Telegram")
    assert goal.progress == 0
    entry = JournalEntryCreate(content="Hari produktif")
    assert entry.tags == []
    assert isinstance(today_wib(), date)


# ---------------------------------------------------------------------------
# HTTP guards
# ---------------------------------------------------------------------------
def _settings(**overrides: object) -> Settings:
    base = {
        "app_env": "test",
        "telegram_enabled": False,
        "telegram_bot_token": "",
        "telegram_webhook_secret": "",
        "cron_secret": "rahasia",
    }
    base.update(overrides)
    return Settings(**base)


def test_webhook_is_noop_when_telegram_disabled() -> None:
    app.dependency_overrides[get_settings] = lambda: _settings()
    try:
        with TestClient(app) as client:
            response = client.post("/api/telegram/webhook", json={})
        assert response.status_code == 200
        assert response.json()["ok"] is False
    finally:
        app.dependency_overrides.clear()


def test_webhook_rejects_wrong_secret_when_enabled() -> None:
    app.dependency_overrides[get_settings] = lambda: _settings(
        telegram_enabled=True,
        telegram_bot_token="token",
        telegram_webhook_secret="benar",
    )
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/telegram/webhook",
                json={"update_id": 1},
                headers={"X-Telegram-Bot-Api-Secret-Token": "salah"},
            )
        assert response.status_code == 401
    finally:
        app.dependency_overrides.clear()


def test_cron_requires_bearer_secret() -> None:
    app.dependency_overrides[get_settings] = lambda: _settings()
    try:
        with TestClient(app) as client:
            missing = client.get("/api/cron/tick")
            wrong = client.get(
                "/api/cron/tick", headers={"Authorization": "Bearer salah"}
            )
        assert missing.status_code == 401
        assert wrong.status_code == 401
    finally:
        app.dependency_overrides.clear()


def test_cron_unavailable_without_secret() -> None:
    app.dependency_overrides[get_settings] = lambda: _settings(cron_secret="")
    try:
        with TestClient(app) as client:
            response = client.get("/api/cron/tick")
        assert response.status_code == 503
    finally:
        app.dependency_overrides.clear()


def test_cron_tick_runs_pipeline(monkeypatch: pytest.MonkeyPatch) -> None:
    import app.routers.cron as cron_router
    import app.supabase_client as supabase_client

    async def fake_owner_client() -> object:
        return object()

    async def fake_refresh(client: object, user_id: str) -> int:
        return 3

    async def fake_dispatch(client: object, settings: Settings, now: object) -> int:
        return 2

    async def fake_deliver(client: object, telegram: object) -> tuple[int, int]:
        return (1, 0)

    async def fake_purge(client: object, days: int = 7) -> None:
        return None

    monkeypatch.setattr(supabase_client, "get_owner_client", fake_owner_client)
    monkeypatch.setattr(cron_router, "refresh_stale_projects", fake_refresh)
    monkeypatch.setattr(cron_router, "_dispatch_reports", fake_dispatch)
    monkeypatch.setattr(cron_router, "deliver_due", fake_deliver)
    monkeypatch.setattr(cron_router, "purge_updates", fake_purge)

    app.dependency_overrides[get_settings] = lambda: _settings(
        telegram_bot_token="token"
    )
    try:
        with TestClient(app) as client:
            response = client.get(
                "/api/cron/tick", headers={"Authorization": "Bearer rahasia"}
            )
        assert response.status_code == 200
        body = response.json()
        assert body["health_refreshed"] == 3
        assert body["reports_sent"] == 2
        assert body["outbox_sent"] == 1
        assert body["outbox_failed"] == 0
    finally:
        app.dependency_overrides.clear()


def test_webhook_dispatches_update(monkeypatch: pytest.MonkeyPatch) -> None:
    from types import SimpleNamespace

    import app.supabase_client as supabase_client
    from app.services.telegram_bot import TelegramBot

    class FakeClient:
        def table(self, *args: object, **kwargs: object) -> "FakeClient":
            return self

        def select(self, *args: object, **kwargs: object) -> "FakeClient":
            return self

        def eq(self, *args: object, **kwargs: object) -> "FakeClient":
            return self

        def insert(self, *args: object, **kwargs: object) -> "FakeClient":
            return self

        def maybe_single(self) -> "FakeClient":
            return self

        async def execute(self) -> SimpleNamespace:
            return SimpleNamespace(data=[])

    async def fake_owner_client() -> FakeClient:
        return FakeClient()

    async def fake_handle(self: TelegramBot, update: dict) -> bool:
        return True

    monkeypatch.setattr(supabase_client, "get_owner_client", fake_owner_client)
    monkeypatch.setattr(TelegramBot, "handle_update", fake_handle)

    app.dependency_overrides[get_settings] = lambda: _settings(
        telegram_enabled=True,
        telegram_bot_token="token",
        telegram_webhook_secret="benar",
    )
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/telegram/webhook",
                json={"update_id": 1},
                headers={"X-Telegram-Bot-Api-Secret-Token": "benar"},
            )
        assert response.status_code == 200
        assert response.json() == {"ok": True, "handled": True, "detail": ""}
    finally:
        app.dependency_overrides.clear()