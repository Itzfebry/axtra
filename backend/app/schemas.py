"""Pydantic request/response schemas for the Axtra API."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

MemoryType = Literal[
    "identity", "episodic", "semantic", "project", "goal", "skill", "conversation"
]
MemoryStatus = Literal["active", "conflicted", "archived"]
ChatMode = Literal["general", "curhat", "brainstorming", "document", "research"]


# ---------------------------------------------------------------------------
# Profile
# ---------------------------------------------------------------------------
class ProfileUpdate(BaseModel):
    display_name: str | None = None
    timezone: str | None = None
    locale: str | None = None
    communication_style: str | None = None
    preferences: dict[str, Any] | None = None


class ProfileOut(BaseModel):
    id: str
    display_name: str | None = None
    timezone: str
    locale: str
    communication_style: str | None = None
    preferences: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


# ---------------------------------------------------------------------------
# Conversations & messages
# ---------------------------------------------------------------------------
class ConversationCreate(BaseModel):
    title: str | None = None
    mode: ChatMode = "general"


class ConversationOut(BaseModel):
    id: str
    title: str | None = None
    mode: ChatMode = "general"
    summary: str | None = None
    message_count: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None
    last_message_at: datetime | None = None


class MessageOut(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    model: str | None = None
    token_count: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None


class ChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str = Field(default="", max_length=32000)
    mode: ChatMode = "general"
    model: str | None = None
    use_memory: bool = True
    temperature: float = Field(default=0.7, ge=0, le=2)
    command: str | None = Field(default=None, max_length=40)
    # Projects referenced with @mention; their context is injected into the prompt.
    project_ids: list[str] = Field(default_factory=list, max_length=5)
    # Job applications referenced with @mention; same grounding behavior.
    job_ids: list[str] = Field(default_factory=list, max_length=5)

    @model_validator(mode="after")
    def _require_message_or_command(self) -> "ChatRequest":
        if not self.message.strip() and not (self.command or "").strip():
            raise ValueError("Pesan tidak boleh kosong.")
        return self


class ChatModeSettingsUpdate(BaseModel):
    mode: ChatMode
    roles: list[str] = Field(min_length=1, max_length=8)
    behavior: str = Field(min_length=1, max_length=60)
    role_note: str = Field(default="", max_length=500)


class DocumentOut(BaseModel):
    id: str
    conversation_id: str
    filename: str
    mime_type: str
    size_bytes: int
    created_at: datetime | None = None


# ---------------------------------------------------------------------------
# Web research (Riset Web chat mode)
# ---------------------------------------------------------------------------
class ResearchCrawlRequest(BaseModel):
    url: str = Field(min_length=1, max_length=1000)
    conversation_id: str | None = None


class ResearchSourceOut(BaseModel):
    id: str
    conversation_id: str
    url: str
    title: str = ""
    site: str = ""
    excerpt: str = ""
    char_count: int = 0
    created_at: datetime | None = None


# ---------------------------------------------------------------------------
# Cari Kerja (job application tracker)
# ---------------------------------------------------------------------------
JobStatus = Literal[
    "draft", "applied", "screening", "interview", "offer", "rejected", "withdrawn"
]


class JobApplicationCreate(BaseModel):
    company: str = Field(min_length=1, max_length=200)
    role: str = Field(min_length=1, max_length=200)
    location: str = Field(default="", max_length=200)
    work_type: str = Field(default="", max_length=60)
    salary: str = Field(default="", max_length=120)
    job_url: str | None = Field(default=None, max_length=1000)
    status: JobStatus = "applied"
    applied_at: datetime | None = None
    deadline: date | None = None
    created_at: datetime | None = None
    notes: str = Field(default="", max_length=20000)
    job_description: str = Field(default="", max_length=50000)


class JobApplicationUpdate(BaseModel):
    company: str | None = Field(default=None, min_length=1, max_length=200)
    role: str | None = Field(default=None, min_length=1, max_length=200)
    location: str | None = Field(default=None, max_length=200)
    work_type: str | None = Field(default=None, max_length=60)
    salary: str | None = Field(default=None, max_length=120)
    job_url: str | None = Field(default=None, max_length=1000)
    status: JobStatus | None = None
    applied_at: datetime | None = None
    deadline: date | None = None
    created_at: datetime | None = None
    notes: str | None = Field(default=None, max_length=20000)
    job_description: str | None = Field(default=None, max_length=50000)
    cover_letter: str | None = Field(default=None, max_length=20000)


class JobApplicationOut(BaseModel):
    id: str
    company: str
    role: str
    location: str = ""
    work_type: str = ""
    salary: str = ""
    job_url: str | None = None
    source: str = "manual"
    status: JobStatus = "applied"
    applied_at: datetime | None = None
    deadline: date | None = None
    notes: str = ""
    job_description: str = ""
    job_title: str = ""
    predicted_jobdesk: str = ""
    match_score: int | None = None
    match_analysis: str = ""
    success_score: int | None = None
    success_analysis: str = ""
    cover_letter: str = ""
    analyzed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class JobCvOut(BaseModel):
    filename: str = ""
    summary: str = ""
    char_count: int = 0
    updated_at: datetime | None = None


class JobCrawlRequest(BaseModel):
    url: str | None = Field(default=None, max_length=1000)


# ---------------------------------------------------------------------------
# Memories
# ---------------------------------------------------------------------------
class MemoryCreate(BaseModel):
    type: MemoryType = "semantic"
    content: str = Field(min_length=1, max_length=8000)
    source: str = "manual"
    confidence: float = Field(default=0.9, ge=0, le=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class MemoryUpdate(BaseModel):
    type: MemoryType | None = None
    content: str | None = Field(default=None, min_length=1, max_length=8000)
    confidence: float | None = Field(default=None, ge=0, le=1)
    status: MemoryStatus | None = None
    metadata: dict[str, Any] | None = None


class MemoryOut(BaseModel):
    id: str
    type: MemoryType
    content: str
    source: str
    source_ref: dict[str, Any] = Field(default_factory=dict)
    confidence: float
    status: MemoryStatus
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class MemorySearchOut(MemoryOut):
    score: float | None = None


class MemoryClusterOut(BaseModel):
    key: str
    memories: list[MemoryOut] = Field(default_factory=list)


class MemoryMergeRequest(BaseModel):
    ids: list[str] = Field(min_length=2, max_length=50)
    type: MemoryType | None = None


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------
ProjectStatus = Literal["idea", "active", "paused", "done"]


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=8000)
    status: ProjectStatus = "idea"
    tech_stack: list[str] = Field(default_factory=list, max_length=40)
    repo_url: str | None = Field(default=None, max_length=500)
    notes: str = Field(default="", max_length=20000)


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=8000)
    status: ProjectStatus | None = None
    tech_stack: list[str] | None = Field(default=None, max_length=40)
    repo_url: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=20000)


class ProjectOut(BaseModel):
    id: str
    name: str
    description: str = ""
    status: ProjectStatus = "idea"
    tech_stack: list[str] = Field(default_factory=list)
    repo_url: str | None = None
    notes: str = ""
    source: str = "manual"
    source_ref: dict[str, Any] = Field(default_factory=dict)
    repo_full_name: str | None = None
    repo_branch: str | None = None
    repo_index_status: str = "none"
    repo_file_count: int = 0
    repo_chunk_count: int = 0
    repo_summary: str | None = None
    repo_index_error: str | None = None
    repo_index_progress: int = 0
    repo_index_stage: str | None = None
    repo_indexed_at: datetime | None = None
    health_summary: str | None = None
    health_generated_at: datetime | None = None
    health_stale: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


class RepoAskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)


class CodeSourceOut(BaseModel):
    path: str
    language: str = "text"
    snippet: str = ""
    score: float | None = None


class RepoAskOut(BaseModel):
    answer: str
    sources: list[CodeSourceOut] = Field(default_factory=list)
    ask_id: str | None = None


class ProjectAskOut(BaseModel):
    id: str
    project_id: str
    question: str
    answer: str = ""
    sources: list[CodeSourceOut] = Field(default_factory=list)
    error: str | None = None
    created_at: datetime | None = None


ProjectTaskStatus = Literal["todo", "doing", "done"]
ProjectTaskPriority = Literal["low", "medium", "high"]


class ProjectTaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    detail: str = Field(default="", max_length=4000)
    status: ProjectTaskStatus = "todo"
    priority: ProjectTaskPriority = "medium"


class ProjectTaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    detail: str | None = Field(default=None, max_length=4000)
    status: ProjectTaskStatus | None = None
    priority: ProjectTaskPriority | None = None
    position: int | None = Field(default=None, ge=0)


class ProjectTaskReorderItem(BaseModel):
    id: str
    status: ProjectTaskStatus
    position: int = Field(ge=0)


class ProjectTaskReorder(BaseModel):
    items: list[ProjectTaskReorderItem] = Field(min_length=1, max_length=500)


class ProjectTaskOut(BaseModel):
    id: str
    project_id: str
    title: str
    detail: str = ""
    status: ProjectTaskStatus = "todo"
    priority: ProjectTaskPriority = "medium"
    source: str = "manual"
    position: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None
    completed_at: datetime | None = None


class ProjectConversationOut(BaseModel):
    """A chat thread linked to a project (via @mention)."""

    conversation_id: str
    title: str | None = None
    mode: str = "general"
    message_count: int = 0
    created_at: datetime | None = None
    last_message_at: datetime | None = None
    linked_at: datetime | None = None


ProjectDocumentKind = Literal["note", "link"]


class ProjectDocumentCreate(BaseModel):
    title: str = Field(default="", max_length=200)
    kind: ProjectDocumentKind = "note"
    url: str | None = Field(default=None, max_length=1000)
    content: str = Field(default="", max_length=50000)


class ProjectDocumentUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    kind: ProjectDocumentKind | None = None
    url: str | None = Field(default=None, max_length=1000)
    content: str | None = Field(default=None, max_length=50000)


class ProjectDocumentOut(BaseModel):
    id: str
    project_id: str
    title: str = ""
    kind: ProjectDocumentKind = "note"
    url: str | None = None
    content: str = ""
    source: str = "manual"
    created_at: datetime | None = None
    updated_at: datetime | None = None


class RepoFileOut(BaseModel):
    path: str
    language: str = "text"
    chunk_count: int = 0


class RepoFileContentOut(BaseModel):
    path: str
    language: str = "text"
    content: str = ""


# ---------------------------------------------------------------------------
# Assistant recommendations (homepage digest of interaction history)
# ---------------------------------------------------------------------------
class RecommendationOut(BaseModel):
    greeting: str
    items: list[str] = Field(default_factory=list)
    conversation_count: int = 0
    memory_count: int = 0
    generated_at: datetime
    source: Literal["llm", "fallback", "empty"] = "llm"


# ---------------------------------------------------------------------------
# Orchestrator (homepage assistant that configures menus and navigates)
# ---------------------------------------------------------------------------
class MenuEntry(BaseModel):
    id: str
    label: str
    live: bool = False
    href: str | None = None
    visible: bool = True


class OrchestratorMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class OrchestratorRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    menu: list[MenuEntry] = Field(default_factory=list)
    history: list[OrchestratorMessage] = Field(default_factory=list)


class OrchestratorAction(BaseModel):
    type: Literal[
        "menu_order",
        "menu_visibility",
        "menu_rename",
        "navigate",
        "reset_menu",
        "set_theme",
        "save_memory",
        "new_conversation",
        "focus_menu",
    ]
    order: list[str] | None = None
    hidden: list[str] | None = None
    labels: dict[str, str] | None = None
    href: str | None = None
    prompt: str | None = None
    theme: Literal["light", "dark"] | None = None
    content: str | None = None
    title: str | None = None
    mode: str | None = None
    target: str | None = None


class OrchestratorOut(BaseModel):
    reply: str
    actions: list[OrchestratorAction] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Token usage
# ---------------------------------------------------------------------------
class UsageOut(BaseModel):
    minute_tokens: int = 0
    day_tokens: int = 0
    minute_limit: int = 0
    day_limit: int = 0
    model: str
    timezone: str = "Asia/Jakarta"
    day_reset_at: datetime


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
class HealthOut(BaseModel):
    status: str
    app: str
    environment: str
    llm_provider: str
    embedding_provider: str
