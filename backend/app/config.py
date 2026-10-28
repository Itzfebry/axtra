"""Application configuration loaded from environment variables."""

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
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

    # Embeddings
    embedding_provider: str = "none"  # none | huggingface
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_dim: int = 384
    huggingface_api_key: str = ""

    # Memory retrieval
    memory_retrieval_count: int = 6
    memory_min_similarity: float = 0.25
    memory_extraction_enabled: bool = True

    # Guardrails
    max_context_messages: int = 20
    rate_limit_per_minute: int = 30
    read_rate_limit_per_minute: int = 300
    max_upload_bytes: int = 10 * 1024 * 1024
    max_document_chars: int = 12000

    # Token usage display (denominators for the navbar/sidebar meters).
    # Set to 0 to hide the corresponding limit/percentage.
    model_tpm_limit: int = 8000
    model_daily_token_limit: int = 200000

    @field_validator("memory_min_similarity", mode="before")
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
