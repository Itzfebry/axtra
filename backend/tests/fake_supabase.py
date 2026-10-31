"""Tiny in-memory stand-in for the async Supabase client used by tests.

Only the query surface exercised by the services is implemented: select, eq,
in_, order, limit, single, insert, update, delete. It is deliberately strict
enough to catch accidental cross-scoping (missing filters simply return more
rows, and ``single`` raises like PostgREST when nothing matches).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any


class FakeSingleError(RuntimeError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


_DEFAULTS: dict[str, dict[str, Any]] = {
    "vibe_sessions": {
        "title": "",
        "raw_idea": {},
        "stage": "discovery",
        "summary": "",
    },
    "vibe_messages": {"metadata": {}},
    "vibe_decisions": {
        "category": "general",
        "status": "ASSUMED",
        "rationale": "",
        "source": "ai",
    },
    "vibe_artifacts": {
        "title": "",
        "content": "",
        "status": "DRAFT",
        "version": 1,
        "generated_by": "ai",
    },
    "vibe_artifact_versions": {
        "content": "",
        "status": "DRAFT",
        "note": "",
    },
    "project_tasks": {
        "detail": "",
        "status": "todo",
        "priority": "medium",
        "position": 0,
        "source": "manual",
        "acceptance_criteria": [],
        "dependencies": [],
        "affected_modules": [],
        "doc_refs": [],
        "testing_notes": "",
        "verification_status": "TODO",
        "verification_evidence": "",
        "verification_notes": "",
    },
    "project_documents": {"title": "", "kind": "note", "content": "", "source": "manual"},
}


class FakeQuery:
    def __init__(self, table: "FakeTable") -> None:
        self._table = table
        self._filters: list[tuple[str, Any]] = []
        self._order: list[tuple[str, bool]] = []
        self._limit: int | None = None
        self._single = False
        self._maybe_single = False
        self._mutation: tuple[str, Any] | None = None

    def select(self, *_args: Any, **_kwargs: Any) -> "FakeQuery":
        return self

    def eq(self, key: str, value: Any) -> "FakeQuery":
        self._filters.append((key, value))
        return self

    def in_(self, key: str, values: list[Any]) -> "FakeQuery":
        self._filters.append((key, set(values)))
        return self

    def order(self, key: str, desc: bool = False) -> "FakeQuery":
        self._order.append((key, desc))
        return self

    def limit(self, value: int) -> "FakeQuery":
        self._limit = value
        return self

    def single(self) -> "FakeQuery":
        self._single = True
        return self

    def maybe_single(self) -> "FakeQuery":
        self._maybe_single = True
        return self

    def insert(self, payload: Any) -> "FakeQuery":
        self._mutation = ("insert", payload)
        return self

    def update(self, patch: dict[str, Any]) -> "FakeQuery":
        self._mutation = ("update", patch)
        return self

    def delete(self) -> "FakeQuery":
        self._mutation = ("delete", None)
        return self

    def _match(self, row: dict[str, Any]) -> bool:
        for key, value in self._filters:
            if isinstance(value, set):
                if row.get(key) not in value:
                    return False
            elif row.get(key) != value:
                return False
        return True

    async def execute(self) -> Any:
        return self._execute()

    def _execute(self) -> Any:
        rows = self._table.rows
        if self._mutation is None:
            selected = [row for row in rows if self._match(row)]
            for key, desc in reversed(self._order):
                selected.sort(key=lambda row: row.get(key) or "", reverse=desc)
            if self._limit is not None:
                selected = selected[: self._limit]
            data = [_copy(row) for row in selected]
            if self._single:
                if len(data) != 1:
                    raise FakeSingleError("row not found")
                return _Response(data[0])
            if self._maybe_single:
                return _Response(data[0] if len(data) == 1 else None)
            return _Response(data)

        kind, payload = self._mutation
        if kind == "insert":
            items = payload if isinstance(payload, list) else [payload]
            created: list[dict[str, Any]] = []
            for item in items:
                row = dict(_DEFAULTS.get(self._table.name, {}))
                row.update(item)
                row.setdefault("id", str(uuid.uuid4()))
                row.setdefault("created_at", _now())
                if self._table.name != "vibe_messages":
                    row.setdefault("updated_at", row["created_at"])
                self._table.rows.append(row)
                created.append(_copy(row))
            return _Response(created)

        matched = [row for row in rows if self._match(row)]
        if kind == "update":
            for row in matched:
                row.update(payload)
                if "updated_at" in row or self._table.name != "vibe_messages":
                    row["updated_at"] = _now()
            return _Response([_copy(row) for row in matched])
        if kind == "delete":
            self._table.rows = [row for row in rows if not self._match(row)]
            return _Response([])
        raise NotImplementedError(kind)


class _Response:
    def __init__(self, data: Any) -> None:
        self.data = data


class FakeTable:
    def __init__(self, name: str, rows: list[dict[str, Any]] | None = None) -> None:
        self.name = name
        self.rows = rows or []

    def select(self, *args: Any, **kwargs: Any) -> FakeQuery:
        return FakeQuery(self)

    def insert(self, payload: Any) -> FakeQuery:
        return FakeQuery(self).insert(payload)

    def update(self, patch: dict[str, Any]) -> FakeQuery:
        return FakeQuery(self).update(patch)

    def delete(self) -> FakeQuery:
        return FakeQuery(self).delete()


class FakeClient:
    def __init__(self) -> None:
        self.tables: dict[str, FakeTable] = {}

    def table(self, name: str) -> FakeTable:
        if name not in self.tables:
            self.tables[name] = FakeTable(name)
        return self.tables[name]

    def seed(self, name: str, rows: list[dict[str, Any]]) -> None:
        self.table(name).rows = [dict(row) for row in rows]


def _copy(row: dict[str, Any]) -> dict[str, Any]:
    return {key: (dict(value) if isinstance(value, dict) else list(value) if isinstance(value, list) else value) for key, value in row.items()}