"""AI health analysis for a project.

Combines the project's metadata, notes, indexed repo summary, and task list
into a short Markdown review (strengths, risks, next steps). The result is
cached on ``projects.health_summary`` by the router.
"""

from __future__ import annotations

from app.llm import ChatMessage, ChatRequest, LLMProvider
from app.schemas import ProjectDocumentOut, ProjectOut, ProjectTaskOut

_HEALTH_SYSTEM = """\
Kamu adalah konsultan teknis untuk proyek perangkat lunak. Berdasarkan data \
proyek di bawah, tulis analisa kesehatan proyek dalam Bahasa Indonesia, format \
Markdown, maksimal 240 kata. Wajib memakai bagian berikut:

## Ringkasan
Satu paragraf singkat tentang kondisi proyek saat ini.

## Kekuatan
2-3 poin kekuatan yang terlihat dari data.

## Risiko
2-3 risiko atau hambatan (teknis, scope, atau progres).

## Langkah berikutnya
Tepat 3 langkah konkret dan actionable, berupa daftar bernomor.

Jangan mengarang fitur atau bukti yang tidak ada di data. Jika data minim, \
sebutkan asumsinya secara singkat. Jangan menulis kalimat pembuka basa-basi.
"""


def _clip(text: str | None, limit: int) -> str:
    value = (text or "").strip()
    if len(value) <= limit:
        return value
    return value[:limit] + "…"


class ProjectAnalyzer:
    def __init__(self, llm: LLMProvider, model: str) -> None:
        self._llm = llm
        self._model = model

    async def analyze(
        self,
        project: ProjectOut,
        tasks: list[ProjectTaskOut],
        documents: list[ProjectDocumentOut] | None = None,
        persona: str = "",
    ) -> str:
        open_tasks = [task for task in tasks if task.status != "done"]
        done_tasks = [task for task in tasks if task.status == "done"]

        def task_lines(items: list[ProjectTaskOut], limit: int = 12) -> str:
            if not items:
                return "(tidak ada)"
            return "\n".join(
                f"- [{task.priority}] {task.title}" for task in items[:limit]
            )

        def document_lines(items: list[ProjectDocumentOut]) -> str:
            if not items:
                return "(tidak ada)"
            lines: list[str] = []
            remaining = 3000
            for document in items:
                if remaining <= 0:
                    break
                label = document.title or "(tanpa judul)"
                if document.kind == "link":
                    body = document.url or "(tautan kosong)"
                else:
                    body = _clip(document.content, min(remaining, 800))
                snippet = f"- [{document.kind}] {label}: {body}"
                lines.append(snippet)
                remaining -= len(snippet)
            return "\n".join(lines)

        repo_line = project.repo_full_name or project.repo_url or "(belum ada repo)"
        prompt = "\n".join(
            [
                f"NAMA PROYEK: {project.name}",
                f"STATUS: {project.status}",
                f"DESKRIPSI: {_clip(project.description, 1200) or '(kosong)'}",
                f"TECH STACK: {', '.join(project.tech_stack) or '(belum diisi)'}",
                f"REPO: {repo_line}",
                f"INDEX REPO: {project.repo_index_status} "
                f"({project.repo_file_count} file, {project.repo_chunk_count} chunk)",
                f"RINGKASAN REPO:\n{_clip(project.repo_summary, 3000) or '(belum ada)'}",
                f"CATATAN/KEPUTUSAN:\n{_clip(project.notes, 2500) or '(kosong)'}",
                f"DATA PROYEK LAIN (non-repo):\n{document_lines(documents or [])}",
                f"TUGAS TERBUKA ({len(open_tasks)}):\n{task_lines(open_tasks)}",
                f"TUGAS SELESAI ({len(done_tasks)}):\n{task_lines(done_tasks)}",
            ]
        )

        answer, _ = await self._llm.complete(
            ChatRequest(
                messages=[
                    ChatMessage(
                        role="system",
                        content=f"{_HEALTH_SYSTEM}\n\n{persona}" if persona else _HEALTH_SYSTEM,
                    ),
                    ChatMessage(role="user", content=prompt),
                ],
                model=self._model,
                temperature=0.3,
                max_tokens=900,
                stream=False,
            )
        )
        return answer.strip()
