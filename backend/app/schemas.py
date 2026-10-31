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


class CrawlProviderSettingsUpdate(BaseModel):
    provider: Literal["httpx", "firecrawl"]


# ---------------------------------------------------------------------------
# Per-feature roles, skills & instruction (Settings page)
# ---------------------------------------------------------------------------
class FeatureSettingsUpdate(BaseModel):
    roles: str = Field(default="", max_length=500)
    skills: str = Field(default="", max_length=500)
    instruction: str = Field(default="", max_length=1000)
    behavior: str = Field(default="", max_length=60)
    skill_ids: list[str] = Field(default_factory=list, max_length=50)


# ---------------------------------------------------------------------------
# AI skills
# ---------------------------------------------------------------------------
SkillSource = Literal["custom", "imported", "ai_generated"]
SkillStatus = Literal["draft", "active", "disabled"]


class SkillCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str | None = Field(default=None, max_length=80)
    description: str = Field(default="", max_length=500)
    category: str = Field(default="general", max_length=60)
    content: str = Field(min_length=1, max_length=40000)
    version: str = Field(default="1", max_length=20)
    source: SkillSource = "custom"
    license: str = Field(default="", max_length=120)
    status: SkillStatus = "active"


class SkillUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    slug: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    category: str | None = Field(default=None, max_length=60)
    content: str | None = Field(default=None, min_length=1, max_length=40000)
    version: str | None = Field(default=None, max_length=20)
    source: SkillSource | None = None
    license: str | None = Field(default=None, max_length=120)
    status: SkillStatus | None = None


class SkillSummary(BaseModel):
    id: str
    slug: str
    name: str
    description: str = ""
    category: str = "general"
    version: str = "1"
    source: SkillSource = "custom"
    license: str = ""
    status: SkillStatus = "active"
    created_at: datetime | None = None
    updated_at: datetime | None = None


class SkillOut(SkillSummary):
    content: str


class SkillParseRequest(BaseModel):
    raw: str = Field(min_length=1, max_length=60000)
    fallback_name: str = Field(default="", max_length=120)


class SkillParseOut(BaseModel):
    name: str
    slug: str
    description: str = ""
    license: str = ""
    metadata: dict[str, str] = Field(default_factory=dict)
    content: str


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


class ResearchSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=300)
    conversation_id: str | None = None
    limit: int | None = Field(default=None, ge=1, le=10)


class ResearchSourceOut(BaseModel):
    id: str
    conversation_id: str
    url: str
    title: str = ""
    site: str = ""
    excerpt: str = ""
    char_count: int = 0
    provider: str = ""
    notice: str | None = None
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


class TokenUsageOut(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


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
    # Transient: set only on the crawl response (provider fallback notice).
    crawl_notice: str | None = None
    # Transient: token usage for the analyze/cover-letter call that produced
    # this response. Not persisted, so a page reload will not show it.
    token_usage: TokenUsageOut | None = None


class JobCvOut(BaseModel):
    filename: str = ""
    summary: str = ""
    char_count: int = 0
    linkedin_url: str = ""
    portfolio_url: str = ""
    portfolio_chars: int = 0
    linkedin_chars: int = 0
    links_updated_at: datetime | None = None
    updated_at: datetime | None = None


class JobProfileLinksUpdate(BaseModel):
    linkedin_url: str = Field(default="", max_length=1000)
    portfolio_url: str = Field(default="", max_length=1000)
    portfolio_content: str | None = Field(default=None, max_length=40000)
    linkedin_content: str | None = Field(default=None, max_length=40000)


JobProfileSource = Literal["cv", "portfolio", "linkedin"]


class JobAnalyzeRequest(BaseModel):
    sources: list[JobProfileSource] = Field(
        default_factory=lambda: ["cv"], max_length=3
    )


class JobCrawlRequest(BaseModel):
    url: str | None = Field(default=None, max_length=1000)


# ---------------------------------------------------------------------------
# LLM providers & models (Settings → Provider)
# ---------------------------------------------------------------------------
class ProviderOut(BaseModel):
    id: str
    label: str
    base_url: str
    docs_url: str = ""
    notes: str = ""
    # Whether a server-side env key is configured for this provider.
    env_key: bool = False
    # Whether the user stored their own key (value never returned).
    user_key: bool = False
    key_source: str = "none"  # user | env | none
    key_masked: str = ""
    rich_metadata: bool = False
    active: bool = False
    selected_model: str = ""
    # True for user-added OpenAI-compatible endpoints (deletable).
    custom: bool = False
    # Image generation slot (OpenRouter-style Image API), separate from text.
    active_image: bool = False
    selected_image_model: str = ""


class ProviderCreate(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    base_url: str = Field(min_length=1, max_length=400)
    api_key: str = Field(default="", max_length=400)
    model: str = Field(default="", max_length=200)


class ProviderKeyUpdate(BaseModel):
    api_key: str = Field(min_length=1, max_length=400)
    model: str = Field(default="", max_length=200)


class ProviderSelectionUpdate(BaseModel):
    provider: str = Field(min_length=1, max_length=40)
    model: str = Field(default="", max_length=200)


class ProviderImageSelectionUpdate(BaseModel):
    provider: str = Field(min_length=1, max_length=40)
    model: str = Field(default="", max_length=200)


class ProviderModelOut(BaseModel):
    id: str
    name: str = ""
    context_window: int | None = None
    modalities: list[str] = Field(default_factory=list)
    pricing: dict[str, float] | None = None
    free: bool = False
    tags: list[str] = Field(default_factory=list)


class ProviderModelsOut(BaseModel):
    provider: str
    label: str
    cached: bool = False
    count: int = 0
    models: list[ProviderModelOut] = Field(default_factory=list)


class ProviderPingOut(BaseModel):
    ok: bool
    status: int | None = None
    latency_ms: int | None = None
    detail: str = ""


class ProviderRecommendationOut(BaseModel):
    model: str
    reason: str
    free: bool = False
    tags: list[str] = Field(default_factory=list)


class ProviderRecommendationsOut(BaseModel):
    provider: str
    label: str
    recommendations: list[ProviderRecommendationOut] = Field(default_factory=list)


class LLMQuotaOut(BaseModel):
    provider: str
    model: str = ""
    minute_tokens: int = 0
    minute_limit: int = 0
    day_tokens: int = 0
    day_limit: int = 0
    day_reset_at: datetime | None = None
    # Raw rate-limit headers from the provider's last response (Groq exposes
    # these). Empty when the provider does not publish quota details.
    rate_limit: dict[str, str] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Image generation (OpenRouter-style Image API)
# ---------------------------------------------------------------------------
class ImageModelOut(BaseModel):
    id: str
    name: str = ""
    # Raw ``supported_parameters`` descriptors (param -> {type, values/min/max}).
    capabilities: dict[str, Any] = Field(default_factory=dict)
    supports_streaming: bool = False
    input_modalities: list[str] = Field(default_factory=list)
    output_modalities: list[str] = Field(default_factory=list)


class ImageModelsOut(BaseModel):
    provider: str
    count: int = 0
    models: list[ImageModelOut] = Field(default_factory=list)


class ImageStyleOut(BaseModel):
    id: str
    label: str = ""


class ImageStyleUpdate(BaseModel):
    style: str = Field(default="none", max_length=40)


class ImageConfigOut(BaseModel):
    provider: str
    provider_label: str
    model: str
    key_ok: bool = False
    style: str = "none"
    styles: list[ImageStyleOut] = Field(default_factory=list)
    aspect_ratios: list[str] = Field(default_factory=list)
    resolutions: list[str] = Field(default_factory=list)
    qualities: list[str] = Field(default_factory=list)
    output_formats: list[str] = Field(default_factory=list)
    backgrounds: list[str] = Field(default_factory=list)
    max_n: int = 4
    daily_limit: int = 0


class ImageGenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    provider: str = Field(default="", max_length=40)
    model: str = Field(default="", max_length=200)
    aspect_ratio: str = Field(default="", max_length=20)
    resolution: str = Field(default="", max_length=10)
    quality: str = Field(default="", max_length=10)
    output_format: str = Field(default="", max_length=10)
    background: str = Field(default="", max_length=12)
    style: str = Field(default="", max_length=40)
    output_compression: int | None = Field(default=None, ge=0, le=100)
    seed: int | None = Field(default=None, ge=0)
    # Cloudflare Workers AI diffusion steps (ignored by other providers).
    steps: int | None = Field(default=None, ge=1, le=20)
    # Reference images (image-to-image). Data URLs or HTTP(S) URLs.
    input_references: list[str] = Field(default_factory=list, max_length=8)
    # Provider routing (OpenRouter provider object).
    provider_only: list[str] = Field(default_factory=list, max_length=20)
    provider_order: list[str] = Field(default_factory=list, max_length=20)
    provider_ignore: list[str] = Field(default_factory=list, max_length=20)
    provider_sort: str = Field(default="", max_length=20)
    provider_allow_fallbacks: bool | None = None
    n: int = Field(default=1, ge=1, le=10)
    stream: bool = False


class ImageEndpointOut(BaseModel):
    provider_name: str = ""
    provider_slug: str = ""
    provider_tag: str | None = None
    supports_streaming: bool = False
    supported_parameters: dict[str, Any] = Field(default_factory=dict)
    pricing: list[dict[str, Any]] = Field(default_factory=list)


class ImageEndpointsOut(BaseModel):
    provider: str
    model: str
    endpoints: list[ImageEndpointOut] = Field(default_factory=list)


class ImageResultOut(BaseModel):
    data_url: str
    media_type: str = "image/png"


class ImageGenerateOut(BaseModel):
    provider: str
    model: str
    images: list[ImageResultOut] = Field(default_factory=list)
    usage: dict[str, Any] = Field(default_factory=dict)


class ImageCreditsOut(BaseModel):
    # False when the key cannot read credits (normal keys are not management
    # keys) or the provider does not expose a credits endpoint.
    available: bool = False
    total_credits: float | None = None
    total_usage: float | None = None
    remaining: float | None = None
    detail: str = ""


class ImageUsageOut(BaseModel):
    day_images: int = 0
    day_cost: float = 0.0
    day_limit: int = 0
    day_reset_at: datetime | None = None


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
    labels: list[str] = Field(default_factory=list, max_length=30)
    repo_url: str | None = Field(default=None, max_length=500)
    notes: str = Field(default="", max_length=20000)


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=8000)
    status: ProjectStatus | None = None
    tech_stack: list[str] | None = Field(default=None, max_length=40)
    labels: list[str] | None = Field(default=None, max_length=30)
    repo_url: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=20000)


class ProjectOut(BaseModel):
    id: str
    name: str
    description: str = ""
    status: ProjectStatus = "idea"
    tech_stack: list[str] = Field(default_factory=list)
    labels: list[str] = Field(default_factory=list)
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
    health_history: list[dict[str, Any]] = Field(default_factory=list)
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

# ---------------------------------------------------------------------------
# Vibe Coding workspace
# ---------------------------------------------------------------------------
VibeArtifactKind = Literal[
    "PRD",
    "ARCHITECTURE",
    "ACCEPTANCE_TEST_PLAN",
    "UI_UX_SPEC",
    "AGENT_INSTRUCTIONS",
    "IMPLEMENTATION_PLAN",
    "DEFINITION_OF_DONE",
]
VibeArtifactStatus = Literal["DRAFT", "NEEDS_REVIEW", "APPROVED", "STALE"]
VibeDecisionStatus = Literal[
    "CONFIRMED",
    "ASSUMED",
    "RESEARCH",
    "NEEDS_DECISION",
    "VALIDATION_REQUIRED",
]
VibeVerificationStatus = Literal[
    "TODO", "IN_PROGRESS", "BLOCKED", "NEEDS_REVIEW", "DONE"
]
VibeStage = Literal["discovery", "specification", "planning", "verification"]


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
    # Vibe Coding plan/verification metadata (nullable for manual tasks).
    vibe_session_id: str | None = None
    vibe_task_key: str | None = None
    acceptance_criteria: list[str] = Field(default_factory=list)
    dependencies: list[str] = Field(default_factory=list)
    affected_modules: list[str] = Field(default_factory=list)
    doc_refs: list[str] = Field(default_factory=list)
    testing_notes: str = ""
    verification_status: VibeVerificationStatus = "TODO"
    verification_evidence: str = ""
    verification_notes: str = ""


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
    memory_type: MemoryType | None = None
    title: str | None = None
    mode: str | None = None
    target: str | None = None


class OrchestratorOut(BaseModel):
    reply: str
    actions: list[OrchestratorAction] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Token usage
# ---------------------------------------------------------------------------
class UsageModelUsage(BaseModel):
    model: str
    tokens: int = 0


class UsageOut(BaseModel):
    minute_tokens: int = 0
    day_tokens: int = 0
    minute_limit: int = 0
    day_limit: int = 0
    model: str
    provider: str = ""
    by_model: list[UsageModelUsage] = Field(default_factory=list)
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


# ---------------------------------------------------------------------------
# Vibe Coding workflows
# ---------------------------------------------------------------------------
class VibeIdea(BaseModel):
    idea: str = Field(default="", max_length=8000)
    problem: str = Field(default="", max_length=4000)
    target_users: str = Field(default="", max_length=2000)
    constraints: str = Field(default="", max_length=4000)


class VibeSessionCreate(VibeIdea):
    title: str = Field(default="", max_length=200)


class VibeSessionUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    idea: str | None = Field(default=None, max_length=8000)
    problem: str | None = Field(default=None, max_length=4000)
    target_users: str | None = Field(default=None, max_length=2000)
    constraints: str | None = Field(default=None, max_length=4000)
    summary: str | None = Field(default=None, max_length=8000)
    stage: VibeStage | None = None


class VibeSessionOut(BaseModel):
    id: str
    project_id: str
    title: str = ""
    raw_idea: dict[str, Any] = Field(default_factory=dict)
    stage: VibeStage = "discovery"
    summary: str = ""
    created_at: datetime | None = None
    updated_at: datetime | None = None


class VibeMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=8000)


class VibeQuestion(BaseModel):
    question: str = ""
    options: list[str] = Field(default_factory=list)
    recommended: str | None = None


class VibeMessageOut(BaseModel):
    id: str
    session_id: str
    role: Literal["user", "assistant"]
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None


class VibeDecisionCreate(BaseModel):
    category: str = Field(default="general", max_length=60)
    statement: str = Field(min_length=1, max_length=2000)
    status: VibeDecisionStatus = "NEEDS_DECISION"
    rationale: str = Field(default="", max_length=2000)
    source: str = Field(default="manual", max_length=40)


class VibeDecisionUpdate(BaseModel):
    category: str | None = Field(default=None, max_length=60)
    statement: str | None = Field(default=None, min_length=1, max_length=2000)
    status: VibeDecisionStatus | None = None
    rationale: str | None = Field(default=None, max_length=2000)


class VibeDecisionOut(BaseModel):
    id: str
    session_id: str
    category: str = "general"
    statement: str
    status: VibeDecisionStatus = "ASSUMED"
    rationale: str = ""
    source: str = "ai"
    created_at: datetime | None = None
    updated_at: datetime | None = None


class VibeDiscoveryReply(BaseModel):
    message: VibeMessageOut
    decisions: list[VibeDecisionOut] = Field(default_factory=list)
    questions: list[VibeQuestion] = Field(default_factory=list)


class VibeArtifactGenerate(BaseModel):
    instructions: str = Field(default="", max_length=4000)


class VibeArtifactUpdate(BaseModel):
    content: str = Field(min_length=1, max_length=100000)
    note: str = Field(default="", max_length=500)


class VibeArtifactOut(BaseModel):
    id: str
    session_id: str
    project_id: str
    kind: VibeArtifactKind
    title: str = ""
    content: str = ""
    status: VibeArtifactStatus = "DRAFT"
    version: int = 1
    generated_by: str = "ai"
    reviewed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class VibeArtifactVersionOut(BaseModel):
    id: str
    artifact_id: str
    version: int
    content: str = ""
    status: VibeArtifactStatus = "DRAFT"
    note: str = ""
    created_at: datetime | None = None


class VibeTaskGenerateRequest(BaseModel):
    max_tasks: int = Field(default=8, ge=1, le=12)


class VibeTaskPromptOut(BaseModel):
    task_id: str
    prompt: str


class VibeVerificationUpdate(BaseModel):
    status: VibeVerificationStatus
    evidence: str = Field(default="", max_length=20000)
    notes: str = Field(default="", max_length=5000)
