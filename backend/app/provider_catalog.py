"""Catalog of OpenAI-compatible LLM providers.

The whole app talks to providers through the OpenAI chat-completions shape, so
one adapter covers every entry here. Each spec is metadata only: base URL, the
env var that may hold a server-side key, and docs. Per-user keys (if any) are
stored encrypted elsewhere (see ``services.provider_crypto``).

``models_path`` is appended to the base URL for the live model listing. Most
providers expose ``/models``; OpenRouter additionally returns pricing and
input-modality metadata, which the UI uses for the free filter and badges.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.config import Settings


@dataclass(frozen=True)
class ProviderSpec:
    id: str
    label: str
    base_url: str
    env_key: str
    docs_url: str = ""
    notes: str = ""
    models_path: str = "/models"
    # Image generation route (OpenRouter-style Image API). Only providers that
    # implement it can generate images.
    images_path: str = "/images"
    # Image contract: "openrouter" (POST {base}/images) or "cloudflare"
    # (POST {account ai root}/run/<model>, returns result.image base64).
    images_style: str = "openrouter"
    # Curated image models for providers with no /images/models listing.
    fallback_image_models: tuple[str, ...] = ()
    # OpenRouter exposes pricing/modality metadata; plain OpenAI-compatible
    # providers usually do not, so the UI falls back to conservative defaults.
    rich_metadata: bool = False
    # Curated models used when a provider has no ``/models`` listing (Workers AI
    # exposes chat/embeddings but not a models endpoint on the OpenAI surface).
    fallback_models: tuple[str, ...] = ()
    # True when ``base_url`` embeds ``{account_id}`` resolved from settings.
    templated_base_url: bool = False


# Curated Workers AI text-generation models (free-tier eligible). Workers AI
# exposes no /models on the OpenAI surface, and these carry no pricing metadata,
# so the UI treats them as free.
CLOUDFLARE_TEXT_MODELS: tuple[str, ...] = (
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    "@cf/meta/llama-3.1-8b-instruct",
    "@cf/meta/llama-3.2-3b-instruct",
    "@cf/meta/llama-3.2-1b-instruct",
    "@cf/openai/gpt-oss-120b",
    "@cf/openai/gpt-oss-20b",
    "@cf/qwen/qwen2.5-coder-32b-instruct",
    "@cf/qwen/qwq-32b",
    "@cf/mistralai/mistral-small-3.1-24b-instruct",
    "@cf/google/gemma-3-12b-it",
    "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
)

# Curated Workers AI image models. These are called through the account
# ``/ai/run/<model>`` route (not the OpenAI image surface). FLUX.2 models use
# multipart form input and additionally accept up to four reference images
# (image-to-image / multi-reference editing).
CLOUDFLARE_IMAGE_MODELS: tuple[str, ...] = (
    "@cf/black-forest-labs/flux-1-schnell",
    "@cf/stabilityai/stable-diffusion-xl-base-1.0",
    "@cf/bytedance/stable-diffusion-xl-lightning",
    "@cf/lykon/dreamshaper-8-lcm",
    "@cf/leonardo/lucid-origin",
    "@cf/leonardo/phoenix-1.0",
    "@cf/black-forest-labs/flux-2-klein-4b",
    "@cf/black-forest-labs/flux-2-klein-9b",
    "@cf/black-forest-labs/flux-2-dev",
)

PROVIDERS: tuple[ProviderSpec, ...] = (
    ProviderSpec(
        id="groq",
        label="Groq",
        base_url="https://api.groq.com/openai/v1",
        env_key="GROQ_API_KEY",
        docs_url="https://console.groq.com/docs/models",
        notes="Cepat & ada tier gratis. TPM free tier terbatas.",
    ),
    ProviderSpec(
        id="openrouter",
        label="OpenRouter",
        base_url="https://openrouter.ai/api/v1",
        env_key="OPENROUTER_API_KEY",
        docs_url="https://openrouter.ai/models",
        notes="Agregator ratusan model, metadata harga & modality lengkap.",
        rich_metadata=True,
    ),
    ProviderSpec(
        id="openai",
        label="OpenAI",
        base_url="https://api.openai.com/v1",
        env_key="OPENAI_API_KEY",
        docs_url="https://platform.openai.com/docs/models",
    ),
    ProviderSpec(
        id="google",
        label="Google Gemini",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai",
        env_key="GEMINI_API_KEY",
        docs_url="https://ai.google.dev/gemini-api/docs/openai",
    ),
    ProviderSpec(
        id="cloudflare",
        label="Cloudflare Workers AI",
        base_url="https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
        env_key="CLOUDFLARE_API_KEY",
        docs_url="https://developers.cloudflare.com/workers-ai/models/",
        notes=(
            "Tier gratis ~10.000 Neuron/hari. Butuh CLOUDFLARE_ACCOUNT_ID "
            "(dan CLOUDFLARE_API_KEY) di env server."
        ),
        templated_base_url=True,
        fallback_models=CLOUDFLARE_TEXT_MODELS,
        images_style="cloudflare",
        fallback_image_models=CLOUDFLARE_IMAGE_MODELS,
    ),
)

PROVIDERS_BY_ID: dict[str, ProviderSpec] = {spec.id: spec for spec in PROVIDERS}


def get_provider(provider_id: str) -> ProviderSpec | None:
    return PROVIDERS_BY_ID.get((provider_id or "").strip().lower())


def provider_base_url(settings: Settings, spec: ProviderSpec) -> str:
    """Resolve the effective base URL.

    Groq honours its configurable base; Workers AI builds its URL from the
    account id (kept as a ``{account_id}`` placeholder when unset so the UI can
    show what is missing instead of a broken URL).
    """
    if spec.id == "groq" and settings.groq_base_url:
        return settings.groq_base_url.rstrip("/")
    if spec.templated_base_url:
        override = getattr(settings, f"{spec.id}_base_url", "")
        if isinstance(override, str) and override.strip():
            return override.strip().rstrip("/")
        account = getattr(settings, f"{spec.id}_account_id", "")
        if isinstance(account, str) and account.strip():
            return spec.base_url.replace("{account_id}", account.strip()).rstrip("/")
        return spec.base_url
    return spec.base_url.rstrip("/")


def env_api_key(settings: Settings, spec: ProviderSpec) -> str:
    """Return the server-side key for a provider, or an empty string."""
    value = getattr(settings, spec.env_key.lower(), "")
    return value.strip() if isinstance(value, str) else ""


# Workers AI accounts expose the OpenAI-compatible surface at ``/ai/v1`` and the
# native run route at ``/ai/run``. Users often add the native route as a custom
# provider, so detect that shape and use the Workers AI image contract.
_WORKERS_AI_PATH = re.compile(r"/accounts/[^/]+/ai(?:/|$)", re.IGNORECASE)


def is_workers_ai_base_url(base_url: str) -> bool:
    return bool(_WORKERS_AI_PATH.search((base_url or "").strip()))


def custom_spec(
    provider_id: str, label: str, base_url: str, *, models_path: str = "/models"
) -> ProviderSpec:
    """Build a spec for a user-added OpenAI-compatible endpoint.

    Custom providers keep their key in the same encrypted store, so
    ``env_key`` stays empty (no server default) and ``rich_metadata`` off.
    """
    normalized = base_url.rstrip("/")
    workers_ai = is_workers_ai_base_url(normalized)
    return ProviderSpec(
        id=provider_id,
        label=label or provider_id,
        base_url=normalized,
        env_key="",
        models_path=models_path or "/models",
        images_style="cloudflare" if workers_ai else "openrouter",
        fallback_image_models=CLOUDFLARE_IMAGE_MODELS if workers_ai else (),
    )
