"""Tests for the Belajar (study) service: CRUD + material generation."""

from __future__ import annotations

import asyncio

from app.schemas import StudyReviewRequest, StudyTopicCreate, StudyTopicUpdate
from app.services.study_service import StudyService, build_prompt
from tests.fake_supabase import FakeClient


class FakeLLM:
    def __init__(self, reply: str = "## Ringkasan materi\nIsi materi.") -> None:
        self.reply = reply
        self.requests: list = []

    async def complete(self, request):  # noqa: ANN001 - mirrors LLMProvider
        self.requests.append(request)
        return self.reply, None


USER = "00000000-0000-0000-0000-000000000001"


def test_create_list_update_delete() -> None:
    async def run() -> None:
        client = FakeClient()
        service = StudyService(client)  # type: ignore[arg-type]

        created = await service.create(
            USER, StudyTopicCreate(title="CPNS TWK", subject="CPNS", goal="Lulus")
        )
        assert created.title == "CPNS TWK"
        assert created.progress == 0

        rows = await service.list_topics(USER)
        assert len(rows) == 1

        updated = await service.update(
            USER, created.id, StudyTopicUpdate(status="done")
        )
        assert updated.status == "done"
        assert updated.progress == 100

        await service.delete(USER, created.id)
        assert await service.list_topics(USER) == []

    asyncio.run(run())


def test_generate_material_saves_and_uses_prompt() -> None:
    async def run() -> None:
        client = FakeClient()
        service = StudyService(client)  # type: ignore[arg-type]
        topic = await service.create(
            USER, StudyTopicCreate(title="Deret angka", subject="CPNS", goal="Latihan")
        )

        llm = FakeLLM("## Ringkasan materi\nDeret aritmetika.")
        result = await service.generate_material(
            USER, topic.id, llm, "test-model", focus="fokus deret"  # type: ignore[arg-type]
        )

        assert "Deret aritmetika" in result.material
        # Prompt carries the topic identity and the extra focus.
        sent = llm.requests[0].messages[-1].content
        assert "Deret angka" in sent
        assert "fokus deret" in sent

    asyncio.run(run())


def test_generate_missing_topic_raises() -> None:
    async def run() -> None:
        service = StudyService(FakeClient())  # type: ignore[arg-type]
        try:
            await service.generate_material(
                USER, "00000000-0000-0000-0000-0000000000ff", FakeLLM(), "m"  # type: ignore[arg-type]
            )
        except KeyError:
            return
        raise AssertionError("expected KeyError")

    asyncio.run(run())


def test_build_prompt_includes_fields() -> None:
    from app.schemas import StudyTopicOut

    topic = StudyTopicOut(
        id="1", title="Pancasila", subject="TWK", goal="Hafal sila", notes="catatan"
    )
    text = build_prompt(topic)
    assert "Pancasila" in text
    assert "Hafal sila" in text


def test_generate_quiz_parses_and_grades() -> None:
    async def run() -> None:
        client = FakeClient()
        service = StudyService(client)  # type: ignore[arg-type]
        topic = await service.create(USER, StudyTopicCreate(title="TWK"))

        reply = (
            '[{"question":"Sila pertama?","options":["Ketuhanan","Kemanusiaan"],'
            '"answer":0,"explanation":"Sila 1."}]'
        )
        quizzed = await service.generate_quiz(
            USER, topic.id, FakeLLM(reply), "m"  # type: ignore[arg-type]
        )
        assert len(quizzed.quiz) == 1
        assert quizzed.quiz[0].answer == 0

        graded = await service.grade_quiz(USER, topic.id, [0])
        assert graded.correct == 1
        assert graded.score == 100
        assert graded.results[0].correct is True

        wrong = await service.grade_quiz(USER, topic.id, [1])
        assert wrong.correct == 0

        refreshed = await service.get(USER, topic.id)
        assert refreshed is not None
        assert [attempt.score for attempt in refreshed.quiz_history] == [100, 0]

    asyncio.run(run())


def test_quiz_distribution_and_level_setting() -> None:
    async def run() -> None:
        client = FakeClient()
        service = StudyService(client)  # type: ignore[arg-type]
        topic = await service.create(USER, StudyTopicCreate(title="TWK"))

        reply = (
            '[{"question":"Q","options":["a","b"],"answer":0,"explanation":"e"}]'
        )
        mixed = FakeLLM(reply)
        await service.generate_quiz(
            USER, topic.id, mixed, "m", count=10  # type: ignore[arg-type]
        )
        prompt = mixed.requests[0].messages[-1].content
        assert "JUMLAH SOAL: 10" in prompt
        # Default mix: 30% mudah, 60% sedang, 10% sulit.
        assert "3 soal mudah" in prompt
        assert "6 soal sedang" in prompt
        assert "1 soal sulit" in prompt

        fixed = FakeLLM(reply)
        await service.generate_quiz(
            USER, topic.id, fixed, "m", count=5, level="sulit"  # type: ignore[arg-type]
        )
        fixed_prompt = fixed.requests[0].messages[-1].content
        assert "semuanya tingkat sulit" in fixed_prompt
        assert "soal mudah" not in fixed_prompt

    asyncio.run(run())


def test_import_source_feeds_prompt() -> None:
    async def run() -> None:
        client = FakeClient()
        service = StudyService(client)  # type: ignore[arg-type]
        topic = await service.create(USER, StudyTopicCreate(title="Deret"))

        imported = await service.import_source(
            USER, topic.id, "modul.txt", "Deret aritmetika naik konstan."
        )
        assert imported.source_filename == "modul.txt"
        assert imported.source_chars > 0

        llm = FakeLLM("materi")
        await service.generate_material(USER, topic.id, llm, "m")  # type: ignore[arg-type]
        assert "Deret aritmetika" in llm.requests[0].messages[-1].content

    asyncio.run(run())


def test_schedule_review_and_link_goal() -> None:
    async def run() -> None:
        client = FakeClient()
        service = StudyService(client)  # type: ignore[arg-type]
        topic = await service.create(USER, StudyTopicCreate(title="CPNS"))

        reviewed = await service.schedule_review(
            USER, topic.id, StudyReviewRequest(days=3)
        )
        assert reviewed.next_review_at is not None
        assert client.table("schedules").rows

        linked = await service.link_goal(USER, topic.id)
        assert linked.goal_id is not None
        assert client.table("goals").rows

    asyncio.run(run())


def test_schedule_review_dedupes() -> None:
    async def run() -> None:
        client = FakeClient()
        service = StudyService(client)  # type: ignore[arg-type]
        topic = await service.create(USER, StudyTopicCreate(title="CPNS"))

        await service.schedule_review(USER, topic.id, StudyReviewRequest(days=1))
        await service.schedule_review(USER, topic.id, StudyReviewRequest(days=7))

        schedules = client.table("schedules").rows
        assert len(schedules) == 2
        active = [row for row in schedules if row.get("status") == "active"]
        assert len(active) == 1

    asyncio.run(run())


def test_delete_archives_goal_and_cancels_reviews() -> None:
    async def run() -> None:
        client = FakeClient()
        service = StudyService(client)  # type: ignore[arg-type]
        topic = await service.create(USER, StudyTopicCreate(title="CPNS"))

        linked = await service.link_goal(USER, topic.id)
        assert linked.goal_id is not None
        await service.schedule_review(USER, topic.id, StudyReviewRequest(days=3))

        await service.delete(USER, topic.id)

        assert await service.list_topics(USER) == []
        goals = client.table("goals").rows
        assert goals and all(row.get("status") == "archived" for row in goals)
        schedules = client.table("schedules").rows
        assert schedules and all(
            row.get("status") == "cancelled" for row in schedules
        )

    asyncio.run(run())
