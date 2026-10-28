"""Pydantic request/response schemas for the Axtra API."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

MemoryType = Literal[
    "identity", "episodic", "semantic", "project", "goal", "skill", "conversation"
]
MemoryStatus = Literal["active", "conflicted", "archived"]
ChatMode = Literal["general", "curhat", "brainstorming", "document"]


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
