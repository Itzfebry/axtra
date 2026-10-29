"""Project service: CRUD for personal projects plus chat auto-sync.

All queries go through the caller's RLS-scoped Supabase client, so the owner
never reads or modifies another user's projects.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any

from supabase import AsyncClient

from app.schemas import (
    CodeSourceOut,
    ProjectAskOut,
    ProjectConversationOut,
    ProjectDocumentOut,
    ProjectOut,
    ProjectTaskOut,
    RepoFileContentOut,
    RepoFileOut,
)

TABLE = "projects"

logger = logging.getLogger("axtra.projects")


def _row_to_project(row: dict[str, Any]) -> ProjectOut:
    raw_stack = row.get("tech_stack")
    if isinstance(raw_stack, list):
        tech_stack = [str(item) for item in raw_stack if str(item).strip()]
    else:
        tech_stack = []
    return ProjectOut(
        id=row["id"],
        name=row.get("name", ""),
        description=row.get("description", "") or "",
        status=row.get("status", "idea"),
        tech_stack=tech_stack,
        repo_url=row.get("repo_url"),
        notes=row.get("notes", "") or "",
        source=row.get("source", "manual"),
        source_ref=row.get("source_ref") or {},
        repo_full_name=row.get("repo_full_name"),
        repo_branch=row.get("repo_branch"),
        repo_index_status=row.get("repo_index_status", "none") or "none",
        repo_file_count=int(row.get("repo_file_count") or 0),
        repo_chunk_count=int(row.get("repo_chunk_count") or 0),
        repo_summary=row.get("repo_summary"),
        repo_index_error=row.get("repo_index_error"),
        repo_index_progress=int(row.get("repo_index_progress") or 0),
        repo_index_stage=row.get("repo_index_stage"),
        repo_indexed_at=row.get("repo_indexed_at"),
        health_summary=row.get("health_summary"),
        health_generated_at=row.get("health_generated_at"),
        health_stale=bool(row.get("health_stale")),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


def _row_to_task(row: dict[str, Any]) -> ProjectTaskOut:
    return ProjectTaskOut(
        id=row["id"],
        project_id=row["project_id"],
        title=row.get("title", ""),
        detail=row.get("detail", "") or "",
        status=row.get("status", "todo") or "todo",
        priority=row.get("priority", "medium") or "medium",
        source=row.get("source", "manual") or "manual",
        position=int(row.get("position") or 0),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
        completed_at=row.get("completed_at"),
    )


def _row_to_ask(row: dict[str, Any]) -> ProjectAskOut:
    raw_sources = row.get("sources")
    sources = [
        CodeSourceOut(**item)
        for item in (raw_sources or [])
        if isinstance(item, dict)
    ]
    return ProjectAskOut(
        id=row["id"],
        project_id=row["project_id"],
        question=row.get("question", ""),
        answer=row.get("answer", "") or "",
        sources=sources,
        error=row.get("error"),
        created_at=row.get("created_at"),
    )


def _row_to_document(row: dict[str, Any]) -> ProjectDocumentOut:
    return ProjectDocumentOut(
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


def _normalize(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (name or "").lower())


def _candidate_name(content: str) -> str:
    """Derive a short project label from an extracted project memory."""
    text = " ".join((content or "").split())
    # Prefer the clause after a "proyek"/"project" keyword when present.
    match = re.search(
        r"\b(?:proyek|project)\s+(?:baru\s+)?[:\-]?\s*(.+)",
        text,
        re.IGNORECASE,
    )
    label = match.group(1) if match else text
    label = label.split(".")[0].strip(" -:")
    return (label or text)[:80].strip()


class ProjectService:
    def __init__(self, client: AsyncClient) -> None:
        self._client = client

    async def list_projects(
        self,
        user_id: str,
        *,
        status_: str | None = None,
        search: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[ProjectOut]:
        capped = min(limit, 200)
        query = self._client.table(TABLE).select("*").eq("user_id", user_id)
        if status_:
            query = query.eq("status", status_)
        query = query.order("updated_at", desc=True).range(offset, offset + capped - 1)
        if search:
            query = query.text_search(
                "name", search, {"type": "web_search", "config": "simple"}
            )
        response = await query.execute()
        return [_row_to_project(row) for row in response.data]

    async def get(self, user_id: str, project_id: str) -> ProjectOut:
        response = (
            await self._client.table(TABLE)
            .select("*")
            .eq("id", project_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        return _row_to_project(response.data)

    async def get_many(self, user_id: str, project_ids: list[str]) -> list[ProjectOut]:
        """Load several projects at once, preserving the requested order."""
        wanted = [pid for pid in project_ids if pid]
        if not wanted:
            return []
        response = (
            await self._client.table(TABLE)
            .select("*")
            .eq("user_id", user_id)
            .in_("id", wanted)
            .execute()
        )
        by_id = {row["id"]: _row_to_project(row) for row in response.data or []}
        return [by_id[pid] for pid in wanted if pid in by_id]

    async def context_bundles(
        self, user_id: str, project_ids: list[str]
    ) -> list[dict[str, Any]]:
        """Project rows plus open tasks, ready to render into a prompt block."""
        bundles: list[dict[str, Any]] = []
        for project in await self.get_many(user_id, project_ids):
            tasks = await self.list_tasks(project.id)
            open_tasks = [task for task in tasks if task.status != "done"]
            done_count = len(tasks) - len(open_tasks)
            bundles.append(
                {
                    "project": project,
                    "open_tasks": open_tasks[:8],
                    "done_count": done_count,
                    "documents": await self.list_documents(project.id),
                }
            )
        return bundles

    async def create(
        self,
        user_id: str,
        *,
        name: str,
        description: str = "",
        status_: str = "idea",
        tech_stack: list[str] | None = None,
        repo_url: str | None = None,
        notes: str = "",
        source: str = "manual",
        source_ref: dict[str, Any] | None = None,
    ) -> ProjectOut:
        payload = {
            "user_id": user_id,
            "name": name,
            "description": description,
            "status": status_,
            "tech_stack": tech_stack or [],
            "repo_url": repo_url,
            "notes": notes,
            "source": source,
            "source_ref": source_ref or {},
        }
        response = await self._client.table(TABLE).insert(payload).execute()
        return _row_to_project(response.data[0])

    async def update(
        self, user_id: str, project_id: str, patch: dict[str, Any]
    ) -> ProjectOut:
        response = (
            await self._client.table(TABLE)
            .update(patch)
            .eq("id", project_id)
            .eq("user_id", user_id)
            .execute()
        )
        if not response.data:
            raise KeyError("project_not_found")
        return _row_to_project(response.data[0])

    async def delete(self, user_id: str, project_id: str) -> None:
        await (
            self._client.table(TABLE)
            .delete()
            .eq("id", project_id)
            .eq("user_id", user_id)
            .execute()
        )

    async def find_by_name(self, user_id: str, name: str) -> ProjectOut | None:
        target = _normalize(name)
        if not target:
            return None
        response = (
            await self._client.table(TABLE)
            .select("*")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .execute()
        )
        for row in response.data or []:
            row_name = _normalize(row.get("name", ""))
            if not row_name:
                continue
            if row_name == target:
                return _row_to_project(row)
            # Fuzzy fallback: one normalized name contains the other. The
            # shorter side must be long enough to avoid spurious matches.
            shorter, longer = sorted((row_name, target), key=len)
            if len(shorter) >= 4 and shorter in longer:
                return _row_to_project(row)
        return None

    async def _attach_note(
        self, user_id: str, project_id: str, content: str
    ) -> ProjectOut | None:
        try:
            existing = await self.get(user_id, project_id)
        except Exception:  # noqa: BLE001 - missing/foreign project -> no attach
            return None
        note = content.strip()
        if note and note not in existing.notes:
            merged = (existing.notes + "\n" + note).strip() if existing.notes else note
            return await self.update(user_id, existing.id, {"notes": merged[:20000]})
        return existing

    async def sync_from_memory(
        self,
        user_id: str,
        content: str,
        *,
        conversation_id: str | None = None,
        target_project_id: str | None = None,
    ) -> ProjectOut | None:
        """Attach an extracted project memory to an existing project.

        Never creates a project: project creation is manual-only. When the turn
        referenced a project (``target_project_id``) the note attaches there;
        otherwise it matches an existing project by (fuzzy) name. If nothing
        matches, the memory is simply not linked — no stray project appears.
        """
        if target_project_id:
            attached = await self._attach_note(user_id, target_project_id, content)
            if attached is not None:
                return attached

        name = _candidate_name(content)
        if not name:
            return None
        existing = await self.find_by_name(user_id, name)
        if existing:
            return await self._attach_note(user_id, existing.id, content)
        return None

    # ------------------------------------------------- chat <-> project links
    async def link_conversation(
        self, user_id: str, project_id: str, conversation_id: str
    ) -> None:
        """Record that a chat thread references a project (idempotent)."""
        await (
            self._client.table("project_conversations")
            .upsert(
                {
                    "user_id": user_id,
                    "project_id": project_id,
                    "conversation_id": conversation_id,
                },
                on_conflict="project_id,conversation_id",
            )
            .execute()
        )

    async def list_conversations(
        self, project_id: str
    ) -> list[ProjectConversationOut]:
        links = (
            await self._client.table("project_conversations")
            .select("conversation_id, created_at")
            .eq("project_id", project_id)
            .order("created_at", desc=True)
            .execute()
        )
        rows = links.data or []
        ids = [row.get("conversation_id") for row in rows if row.get("conversation_id")]
        if not ids:
            return []
        conversations = (
            await self._client.table("conversations")
            .select("id, title, mode, message_count, created_at, last_message_at")
            .in_("id", ids)
            .execute()
        )
        by_id = {row["id"]: row for row in conversations.data or []}
        out: list[ProjectConversationOut] = []
        for link in rows:
            cid = link.get("conversation_id")
            row = by_id.get(cid)
            if not row:
                continue
            out.append(
                ProjectConversationOut(
                    conversation_id=row["id"],
                    title=row.get("title"),
                    mode=row.get("mode") or "general",
                    message_count=int(row.get("message_count") or 0),
                    created_at=row.get("created_at"),
                    last_message_at=row.get("last_message_at"),
                    linked_at=link.get("created_at"),
                )
            )
        return out

    # ------------------------------------------------------- repo file browser
    async def list_repo_files(self, project_id: str) -> list[RepoFileOut]:
        # Aggregate in SQL so we do not pull every chunk row over the wire.
        # Falls back to client-side aggregation if the RPC is not deployed yet.
        try:
            response = await self._client.rpc(
                "list_project_code_files", {"filter_project": project_id}
            ).execute()
            rows = response.data or []
            return sorted(
                (
                    RepoFileOut(
                        path=row.get("path", ""),
                        language=row.get("language") or "text",
                        chunk_count=int(row.get("chunk_count") or 0),
                    )
                    for row in rows
                    if row.get("path")
                ),
                key=lambda item: item.path,
            )
        except Exception as exc:  # noqa: BLE001 - older DB without the RPC
            logger.warning(
                "list_project_code_files RPC unavailable, using fallback: %s", exc
            )

        response = (
            await self._client.table("project_code_chunks")
            .select("path,language")
            .eq("project_id", project_id)
            .execute()
        )
        agg: dict[str, RepoFileOut] = {}
        for row in response.data or []:
            path = row.get("path", "")
            if not path:
                continue
            existing = agg.get(path)
            if existing:
                existing.chunk_count += 1
            else:
                agg[path] = RepoFileOut(
                    path=path,
                    language=row.get("language", "text") or "text",
                    chunk_count=1,
                )
        return sorted(agg.values(), key=lambda item: item.path)

    async def get_repo_file(self, project_id: str, path: str) -> RepoFileContentOut:
        response = (
            await self._client.table("project_code_chunks")
            .select("chunk_index,content,language")
            .eq("project_id", project_id)
            .eq("path", path)
            .order("chunk_index")
            .execute()
        )
        rows = response.data or []
        language = "text"
        if rows:
            language = rows[0].get("language") or "text"
        content = "\n".join(row.get("content", "") for row in rows)
        return RepoFileContentOut(path=path, language=language, content=content)

    # ------------------------------------------------------------------ tasks
    async def list_tasks(self, project_id: str) -> list[ProjectTaskOut]:
        response = (
            await self._client.table("project_tasks")
            .select("*")
            .eq("project_id", project_id)
            .order("position")
            .order("created_at")
            .execute()
        )
        return [_row_to_task(row) for row in response.data or []]

    async def create_task(
        self,
        project_id: str,
        user_id: str,
        *,
        title: str,
        detail: str = "",
        status_: str = "todo",
        priority: str = "medium",
        source: str = "manual",
    ) -> ProjectTaskOut:
        payload = {
            "project_id": project_id,
            "user_id": user_id,
            "title": title.strip()[:300],
            "detail": detail.strip()[:4000],
            "status": status_,
            "priority": priority,
            "source": source,
            "position": await self._next_position(project_id),
        }
        response = (
            await self._client.table("project_tasks").insert(payload).execute()
        )
        return _row_to_task(response.data[0])

    async def _next_position(self, project_id: str) -> int:
        response = (
            await self._client.table("project_tasks")
            .select("position")
            .eq("project_id", project_id)
            .order("position", desc=True)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        return int(rows[0].get("position") or 0) + 1 if rows else 0

    async def update_task(
        self, project_id: str, task_id: str, patch: dict[str, Any]
    ) -> ProjectTaskOut:
        clean = {key: value for key, value in patch.items() if value is not None}
        if "status" in clean:
            clean["completed_at"] = (
                datetime.now(timezone.utc).isoformat()
                if clean["status"] == "done"
                else None
            )
        response = (
            await self._client.table("project_tasks")
            .update(clean)
            .eq("id", task_id)
            .eq("project_id", project_id)
            .execute()
        )
        if not response.data:
            raise KeyError("task_not_found")
        return _row_to_task(response.data[0])

    async def delete_task(self, project_id: str, task_id: str) -> None:
        await (
            self._client.table("project_tasks")
            .delete()
            .eq("id", task_id)
            .eq("project_id", project_id)
            .execute()
        )

    async def reorder_tasks(
        self, project_id: str, items: list[dict[str, Any]]
    ) -> list[ProjectTaskOut]:
        """Apply a board reorder: status + position for each task in one batch.

        A single ``upsert`` keeps the whole board consistent: either every moved
        task is saved or none is, instead of a half-applied loop of updates.
        """
        now = datetime.now(timezone.utc).isoformat()
        # Restrict to tasks that actually belong to this project so a stray or
        # cross-project id cannot be reassigned by the upsert.
        existing = (
            await self._client.table("project_tasks")
            .select("id")
            .eq("project_id", project_id)
            .execute()
        )
        allowed = {row.get("id") for row in existing.data or []}
        payload: list[dict[str, Any]] = []
        for item in items:
            task_id = item.get("id")
            if not task_id or task_id not in allowed:
                continue
            status_ = item.get("status", "todo")
            payload.append(
                {
                    "id": task_id,
                    "project_id": project_id,
                    "status": status_,
                    "position": int(item.get("position") or 0),
                    "completed_at": now if status_ == "done" else None,
                }
            )
        if payload:
            await (
                self._client.table("project_tasks")
                .upsert(payload, on_conflict="id")
                .execute()
            )
        return await self.list_tasks(project_id)

    # ------------------------------------------------------------------- asks
    async def list_asks(self, project_id: str, limit: int = 50) -> list[ProjectAskOut]:
        response = (
            await self._client.table("project_asks")
            .select("*")
            .eq("project_id", project_id)
            .order("created_at", desc=True)
            .limit(max(1, min(limit, 200)))
            .execute()
        )
        rows = [_row_to_ask(row) for row in response.data or []]
        # Oldest first so the sidebar reads like a conversation.
        rows.reverse()
        return rows

    async def add_ask(
        self,
        project_id: str,
        user_id: str,
        *,
        question: str,
        answer: str = "",
        sources: list[dict[str, Any]] | None = None,
        error: str | None = None,
    ) -> ProjectAskOut:
        payload = {
            "project_id": project_id,
            "user_id": user_id,
            "question": question.strip()[:2000],
            "answer": answer,
            "sources": sources or [],
            "error": error[:2000] if error else None,
        }
        response = await self._client.table("project_asks").insert(payload).execute()
        return _row_to_ask(response.data[0])

    async def delete_ask(self, project_id: str, ask_id: str) -> None:
        await (
            self._client.table("project_asks")
            .delete()
            .eq("id", ask_id)
            .eq("project_id", project_id)
            .execute()
        )

    async def clear_asks(self, project_id: str) -> None:
        await (
            self._client.table("project_asks")
            .delete()
            .eq("project_id", project_id)
            .execute()
        )

    # -------------------------------------------------------------- documents
    async def list_documents(self, project_id: str) -> list[ProjectDocumentOut]:
        response = (
            await self._client.table("project_documents")
            .select("*")
            .eq("project_id", project_id)
            .order("created_at", desc=True)
            .execute()
        )
        return [_row_to_document(row) for row in response.data or []]

    async def create_document(
        self,
        project_id: str,
        user_id: str,
        *,
        title: str,
        kind: str = "note",
        url: str | None = None,
        content: str = "",
        source: str = "manual",
    ) -> ProjectDocumentOut:
        payload = {
            "project_id": project_id,
            "user_id": user_id,
            "title": (title or "").strip()[:200],
            "kind": kind,
            "url": (url or "").strip()[:1000] or None,
            "content": content,
            "source": source,
        }
        response = (
            await self._client.table("project_documents").insert(payload).execute()
        )
        return _row_to_document(response.data[0])

    async def update_document(
        self, project_id: str, document_id: str, patch: dict[str, Any]
    ) -> ProjectDocumentOut:
        clean = {key: value for key, value in patch.items() if value is not None}
        if "title" in clean:
            clean["title"] = str(clean["title"]).strip()[:200]
        response = (
            await self._client.table("project_documents")
            .update(clean)
            .eq("id", document_id)
            .eq("project_id", project_id)
            .execute()
        )
        if not response.data:
            raise KeyError("document_not_found")
        return _row_to_document(response.data[0])

    async def delete_document(self, project_id: str, document_id: str) -> None:
        await (
            self._client.table("project_documents")
            .delete()
            .eq("id", document_id)
            .eq("project_id", project_id)
            .execute()
        )
