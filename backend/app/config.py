"""Application configuration loaded from environment variables."""

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Root .env is a fallback; backend/.env wins when both define a key.
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # App
    app_env: str = "development"
    app_name: str = "Axtra API"
    cors_origins: str = "http://localhost:3000"

    # Supabase
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""

    # Single-user auth
    app_password: str = ""
    session_secret: str = ""
    owner_user_id: str = "00000000-0000-0000-0000-000000000001"
    session_ttl_hours: int = 720

    # Groq
    groq_api_key: str = ""
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_chat_models: str = "openai/gpt-oss-120b,openai/gpt-oss-20b"

    # Multi-provider LLM (OpenAI-compatible). Env keys are optional; a per-user
    # key can be stored encrypted (provider_keys table) as an override. The
    # active provider/model is stored per-user in profiles.preferences['llm'].
    llm_provider: str = "groq"
    llm_model: str = ""
    openai_api_key: str = ""
    openrouter_api_key: str = ""
    together_api_key: str = ""
    deepseek_api_key: str = ""
    mistral_api_key: str = ""
    gemini_api_key: str = ""
    anthropic_api_key: str = ""
    xai_api_key: str = ""
    cerebras_api_key: str = ""
    # Cloudflare Workers AI (OpenAI-compatible surface). The base URL embeds the
    # account id, so it is built from ``cloudflare_account_id`` (or overridden by
    # a full ``cloudflare_base_url``). Free tier: ~10,000 Neurons/day.
    cloudflare_api_key: str = ""
    cloudflare_account_id: str = ""
    cloudflare_base_url: str = ""
    # Cache window for live /models listings (short: metadata is provider-side).
    provider_models_cache_seconds: int = 120
    provider_ping_timeout: float = 12.0
    # Image generation (OpenRouter-style Image API). The image provider/model
    # live separately in profiles.preferences['llm_image']; these are defaults.
    image_provider: str = "openrouter"
    image_model: str = "google/gemini-3-pro-image"
    image_timeout: float = 120.0
    # Retry budget for transient image-provider failures (429/5xx).
    image_max_retries: int = 2
    # Hard daily cap on generated images (0 disables the cap). Guards against a
    # runaway loop spending real credit.
    image_daily_limit: int = 100
    # Secret used to encrypt per-user provider keys at rest. Falls back to the
    # session secret when unset so the feature still works in dev; set a stable
    # value in production or stored keys become undecryptable after a change.
    app_encryption_key: str = ""

    # Embeddings
    embedding_provider: str = "none"  # none | huggingface
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_dim: int = 384
    huggingface_api_key: str = ""

    # Memory retrieval
    memory_retrieval_count: int = 6
    memory_min_similarity: float = 0.25
    memory_cluster_similarity: float = 0.82
    memory_extraction_enabled: bool = True
    # When true, chat retrieval only uses memories from the same chat mode (or
    # unscoped/manual ones). Default false: all modes share one memory pool.
    memory_scope_by_mode: bool = False

    # GitHub repository indexing (RAG over project code)
    # Token is optional; without it only public repos are readable (60 req/h).
    github_token: str = ""
    github_api_base: str = "https://api.github.com"
    github_raw_base: str = "https://raw.githubusercontent.com"
    repo_index_max_files: int = 300
    repo_index_max_file_bytes: int = 200000
    repo_index_max_chunks: int = 4000
    repo_index_chunk_chars: int = 1200
    repo_index_chunk_overlap: int = 200
    repo_qa_context_chunks: int = 8

    # Project AI health auto-refresh: when project data changes, mark the cached
    # summary stale and regenerate it in the background after a short debounce.
    project_health_auto_refresh: bool = True
    project_health_debounce_seconds: float = 12.0

    # Guardrails
    max_context_messages: int = 20
    rate_limit_per_minute: int = 30
    read_rate_limit_per_minute: int = 300
    max_upload_bytes: int = 10 * 1024 * 1024
    max_document_chars: int = 12000

    # Web research (Riset Web): crawl pages into a conversation's context.
    research_max_chars: int = 12000
    research_max_sources: int = 5
    research_fetch_timeout: float = 15.0
    research_max_bytes: int = 2 * 1024 * 1024
    # Firecrawl web search (Riset Web "Cari di web"): number of hits per query.
    research_search_limit: int = 5

    # AI skills: cap how much skill content is injected into one prompt so long
    # Markdown skills cannot blow the model context window.
    skill_max_chars: int = 6000
    skills_max_total_chars: int = 12000
    skills_max_per_feature: int = 6

    # Crawl provider: "httpx" (built-in parser, default) or "firecrawl" (opt-in).
    # Firecrawl is an external API; its key lives only here in the server env and
    # is never sent to or stored by the browser. Self-hosting is supported by
    # pointing firecrawl_base_url at the local instance and (only when the
    # instance truly runs without auth) setting firecrawl_allow_empty_key.
    crawl_provider: str = "httpx"
    firecrawl_api_key: str = ""
    firecrawl_base_url: str = "https://api.firecrawl.dev"
    firecrawl_allow_empty_key: bool = False
    firecrawl_timeout_ms: int = 60000
    # Firecrawl free tier = 1000 credits/month; cap daily usage so the monthly
    # quota is not drained in a few days. One markdown scrape ~= 1 credit.
    firecrawl_daily_credits: int = 30
    firecrawl_monthly_credits: int = 1000
    # Firecrawl's own prompt-injection scan (extra credits). Axtra already
    # guards at the prompt level, so this stays off unless explicitly enabled.
    firecrawl_check_prompt_injection: bool = False

    # Token usage display (denominators for the navbar/sidebar meters).
    # Set to 0 to hide the corresponding limit/percentage.
    model_tpm_limit: int = 8000
    model_daily_token_limit: int = 200000

    @field_validator("memory_min_similarity", "memory_cluster_similarity", mode="before")
    @classmethod
    def _coerce_float(cls, value: object) -> object:
        if isinstance(value, str):
            return float(value)
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return self._split(self.cors_origins)

    @property
    def groq_model_list(self) -> list[str]:
        return self._split(self.groq_chat_models)

    @staticmethod
    def _split(raw: str) -> list[str]:
        return [item.strip() for item in raw.split(",") if item.strip()]

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    @property
    def default_chat_model(self) -> str:
        return self.groq_model_list[0]


@lru_cache
def get_settings() -> Settings:
    return Settings()
