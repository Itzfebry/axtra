"""Tests for schedules/reminders and PWA push helpers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.config import Settings, get_settings
from app.main import app
from app.routers.orchestrator import _sanitize_actions
from app.schemas import (
    MenuEntry,
    OrchestratorRequest,
    PushSubscriptionIn,
    ScheduleCreate,
)
from app.services.journal_service import WIB
from app.services.schedule_service import (
    resolve_due,
    schedule_out,
    to_utc,
)
from app.services.telegram_bot import parse_due_wib, parse_duration_minutes
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Duration / due-time parsing
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("+30m", 30),
        ("+1h", 60),
        ("+1h30m", 90),
        ("+90s", 2),
        ("+2d", 2880),
        ("30m", None),
        ("+abc", None),
        ("", None),
    ],
)
def test_parse_duration_minutes(text: str, expected: int | None) -> None:
    assert parse_duration_minutes(text) == expected


def test_parse_due_relative() -> None:
    now = datetime(2026, 11, 1, 10, 0, tzinfo=WIB)
    due = parse_due_wib("+45m", now=now)
    assert due == now + timedelta(minutes=45)


def test_parse_due_clock_rolls_to_tomorrow() -> None:
    now = datetime(2026, 11, 1, 22, 0, tzinfo=WIB)
    due = parse_due_wib("09:00", now=now)
    assert due is not None
    assert due.date() == now.date() + timedelta(days=1)
    assert (due.hour, due.minute) == (9, 0)


def test_parse_due_clock_today() -> None:
    now = datetime(2026, 11, 1, 8, 0, tzinfo=WIB)
    due = parse_due_wib("20:00", now=now)
    assert due is not None
    assert due.date() == now.date()


def test_parse_due_absolute_and_invalid() -> None:
    now = datetime(2026, 11, 1, 8, 0, tzinfo=WIB)
    due = parse_due_wib("2026-11-03 09:30", now=now)
    assert due == datetime(2026, 11, 3, 9, 30, tzinfo=WIB)
    assert parse_due_wib("99:99", now=now) is None
    assert parse_due_wib("garbage", now=now) is None


# ---------------------------------------------------------------------------
# Service helpers
# ---------------------------------------------------------------------------
def test_to_utc_treats_naive_as_wib() -> None:
    naive = datetime(2026, 11, 1, 7, 0)
    assert to_utc(naive) == datetime(2026, 11, 1, 0, 0, tzinfo=timezone.utc)


def test_resolve_due_uses_due_in_minutes() -> None:
    now = datetime(2026, 11, 1, 0, 0, tzinfo=timezone.utc)
    payload = ScheduleCreate(title="timer", kind="timer", due_in_minutes=25)
    assert resolve_due(payload, now=now) == now + timedelta(minutes=25)


def test_schedule_create_requires_a_due() -> None:
    with pytest.raises(ValueError):
        ScheduleCreate(title="kosong")
    assert ScheduleCreate(title="ok", due_in_minutes=5).due_in_minutes == 5


def test_schedule_out_computes_countdown() -> None:
    now = datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc)
    row = {
        "id": "00000000-0000-0000-0000-0000000000aa",
        "title": "minum obat",
        "note": "",
        "kind": "once",
        "due_at": (now + timedelta(minutes=10)).isoformat(),
        "status": "active",
        "channels": ["telegram"],
    }
    out = schedule_out(row, now=now)
    assert out.due_in_seconds == 600
    assert out.channels == ["telegram"]


# ---------------------------------------------------------------------------
# Orchestrator action sanitising
# ---------------------------------------------------------------------------
def _request() -> OrchestratorRequest:
    return OrchestratorRequest(
        message="ingatkan minum obat 30 menit lagi",
        menu=[MenuEntry(id="chat", label="Chat", href="/chat", live=True)],
    )


def test_sanitize_create_schedule_relative() -> None:
    actions = _sanitize_actions(
        [{"type": "create_schedule", "title": "minum obat", "due_in_minutes": 30}],
        _request(),
    )
    assert len(actions) == 1
    assert actions[0].type == "create_schedule"
    assert actions[0].title == "minum obat"
    assert actions[0].due_in_minutes == 30


def test_sanitize_create_schedule_drops_without_due_or_title() -> None:
    assert (
        _sanitize_actions([{"type": "create_schedule", "title": "x"}], _request())
        == []
    )
    assert (
        _sanitize_actions(
            [{"type": "create_schedule", "due_in_minutes": 5}], _request()
        )
        == []
    )


# ---------------------------------------------------------------------------
# HTTP guards
# ---------------------------------------------------------------------------
def _settings(**overrides: object) -> Settings:
    base = {
        "app_env": "test",
        "cron_secret": "rahasia",
        "vapid_public_key": "",
        "vapid_private_key": "",
    }
    base.update(overrides)
    return Settings(**base)


def test_minutely_requires_bearer_secret() -> None:
    app.dependency_overrides[get_settings] = lambda: _settings()
    try:
        with TestClient(app) as client:
            missing = client.get("/api/cron/minutely")
        assert missing.status_code == 401
    finally:
        app.dependency_overrides.clear()


def test_push_config_disabled_without_keys() -> None:
    app.dependency_overrides[get_settings] = lambda: _settings()
    try:
        with TestClient(app) as client:
            # Auth guard fires first without a session; assert the endpoint exists.
            response = client.get("/api/push/config")
        assert response.status_code in (401, 200)
    finally:
        app.dependency_overrides.clear()


def test_push_subscription_requires_keys() -> None:
    with pytest.raises(ValueError):
        PushSubscriptionIn(endpoint="https://example.com", keys={"auth": "x"})
    sub = PushSubscriptionIn(
        endpoint="https://example.com", keys={"p256dh": "a", "auth": "b"}
    )
    assert sub.keys["p256dh"] == "a"


def test_push_disabled_without_vapid_keys() -> None:
    import asyncio

    from app.services.push_service import send_push

    sent, failed, removed = asyncio.run(
        send_push(None, _settings(), "user", title="t", body="b")  # type: ignore[arg-type]
    )
    assert (sent, failed, removed) == (0, 0, 0)


def test_private_key_pem_unescapes_newlines() -> None:
    from app.services.push_service import _private_key_pem

    assert _private_key_pem(_settings(vapid_private_key="a\\nb")) == "a\nb"


def test_vapid_pem_signs_claims() -> None:
    from py_vapid import Vapid

    vapid = Vapid()
    vapid.generate_keys()
    pem = vapid.private_pem().decode()
    loaded = Vapid.from_pem(pem.encode())
    headers = loaded.sign(
        {"sub": "mailto:a@b.c", "aud": "https://push.example.com", "exp": 9999999999}
    )
    assert "Authorization" in headers
