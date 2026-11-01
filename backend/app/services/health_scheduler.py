"""Debounced background refresh of a project's cached AI health summary.

Project data changes (edits, tasks, repo index) mark ``projects.health_stale``
and call :func:`schedule_health_refresh`. The refresh runs once, a short delay
after the last change, so a burst of edits costs a single LLM call. Running the
regeneration in the background keeps the mutating request fast and avoids
blocking on the model.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

logger = logging.getLogger("axtra.projects.health")

_tasks: dict[str, asyncio.Task[None]] = {}


def schedule_health_refresh(project_id: str, user_id: str, delay: float) -> None:
    """(Re)schedule a health refresh, debouncing rapid successive calls."""
    existing = _tasks.get(project_id)
    if existing and not existing.done():
        existing.cancel()
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:  # pragma: no cover - no loop in sync contexts
        logger.warning("No running loop; skipping health refresh for %s", project_id)
        return
    _tasks[project_id] = loop.create_task(_run(project_id, user_id, delay))


def cancel_health_refresh(project_id: str) -> None:
    """Cancel a pending refresh (e.g. the user ran a manual analysis)."""
    existing = _tasks.pop(project_id, None)
    if existing and not existing.done():
        existing.cancel()


def is_health_refresh_pending(project_id: str) -> bool:
    existing = _tasks.get(project_id)
    return existing is not None and not existing.done()


async def _refresh_project(client, user_id: str, project_id: str) -> bool:
    """Regenerate one stale project's health summary. Returns True when updated."""
    # Imported lazily so this light module never loads the LLM stack on import
    # (and to avoid a circular import with the providers).
    from app.config import get_settings

    settings = get_settings()
    if not settings.project_health_auto_refresh:
        return False

    from app.memory_service_provider import build_project_analyzer
    from app.services.feature_persona import load_feature_persona
    from app.services.project_service import ProjectService

    service = ProjectService(client)
    project = await service.get(user_id, project_id)
    # A manual analysis (or a newer change that already refreshed) wins.
    if not project.health_stale:
        return False

    analyzer = build_project_analyzer()
    tasks = await service.list_tasks(project_id)
    documents = await service.list_documents(project_id)
    persona = await load_feature_persona(client, "projects:health", user_id=user_id)
    summary = await analyzer.analyze(project, tasks, documents, persona)
    await service.update(
        user_id,
        project_id,
        {
            "health_summary": summary,
            "health_generated_at": datetime.now(timezone.utc).isoformat(),
            "health_stale": False,
        },
    )
    logger.info("Auto-refreshed health summary for project %s", project_id)
    return True


async def refresh_stale_projects(client, user_id: str, *, limit: int = 20) -> int:
    """Cron entrypoint: refresh projects marked stale.

    This is the persistent safety net for serverless deployments where the
    in-process debounce task may be killed right after the response is sent.
    """
    response = await (
        client.table("projects")
        .select("id")
        .eq("user_id", user_id)
        .eq("health_stale", True)
        .order("updated_at")
        .limit(limit)
        .execute()
    )
    refreshed = 0
    for row in response.data or []:
        project_id = str(row.get("id") or "")
        if not project_id:
            continue
        try:
            if await _refresh_project(client, user_id, project_id):
                refreshed += 1
        except Exception as exc:  # noqa: BLE001 - one failure must not stop the sweep
            logger.warning("Health refresh failed for %s: %s", project_id, exc)
    return refreshed


async def _run(project_id: str, user_id: str, delay: float) -> None:
    try:
        await asyncio.sleep(max(delay, 0.0))

        from app.supabase_client import get_owner_client

        client = await get_owner_client()
        await _refresh_project(client, user_id, project_id)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001 - background, best-effort
        logger.warning("Health auto-refresh failed for %s: %s", project_id, exc)
    finally:
        _tasks.pop(project_id, None)
