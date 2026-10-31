"""Image generation endpoints (OpenRouter-style Image API).

Generation runs through the image provider/model stored in
``profiles.preferences['llm_image']`` (default from server settings). Results are
returned as base64 data URLs and are not stored server-side. Per-image cost is
recorded in ``image_usage_events`` for the daily cap and the usage panel.
"""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from app.config import Settings, get_settings
from app.deps import CurrentUser, read_rate_limit, rate_limit
from app.schemas import (
    ImageConfigOut,
    ImageCreditsOut,
    ImageEndpointOut,
    ImageEndpointsOut,
    ImageGenerateOut,
    ImageGenerateRequest,
    ImageModelOut,
    ImageModelsOut,
    ImageStyleOut,
    ImageStyleUpdate,
    ImageUsageOut,
)
from app.services.image_service import (
    ImageGenerationError,
    build_provider_routing,
    fetch_image_endpoints,
    generate_image,
    get_credits,
    get_image_usage,
    image_style_entry,
    image_style_options,
    list_image_models,
    load_image_preference,
    save_image_style,
    stream_image,
)
from app.services.provider_registry import resolve_api_key, resolve_provider_spec

router = APIRouter(prefix="/api/images", tags=["images"])

_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}

# Values the OpenRouter Image API documents. Providers clamp to their own
# supported subset, so the UI offers these and each model's capabilities gate
# which ones actually apply.
ASPECT_RATIOS = [
    "auto",
    "1:1",
    "3:2",
    "2:3",
    "16:9",
    "9:16",
    "4:3",
    "3:4",
    "21:9",
]
RESOLUTIONS = ["512", "768", "1K", "1.5K", "2K", "4K"]
QUALITIES = ["auto", "low", "medium", "high"]
OUTPUT_FORMATS = ["png", "jpeg", "webp", "svg"]
BACKGROUNDS = ["auto", "transparent", "opaque"]


def _format_sse(event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"


_SORT_VALUES = {"price", "throughput", "latency"}


def _routing(payload: ImageGenerateRequest) -> dict[str, object]:
    """Build the provider routing object from a request."""
    sort = payload.provider_sort.strip().lower()
    return build_provider_routing(
        only=payload.provider_only,
        order=payload.provider_order,
        ignore=payload.provider_ignore,
        sort=sort if sort in _SORT_VALUES else "",
        allow_fallbacks=payload.provider_allow_fallbacks,
    )


@router.get("/config", response_model=ImageConfigOut)
async def image_config(
    user: CurrentUser = Depends(read_rate_limit),
    settings: Settings = Depends(get_settings),
) -> ImageConfigOut:
    provider, model, style = await load_image_preference(user.client, user.id)
    provider = provider or settings.image_provider or "openrouter"
    model = model or settings.image_model
    spec = await resolve_provider_spec(settings, user.client, user.id, provider)
    key_ok = False
    label = provider
    if spec is not None:
        label = spec.label
        _, source = await resolve_api_key(settings, user.client, user.id, spec)
        key_ok = source != "none"
    return ImageConfigOut(
        provider=provider,
        provider_label=label,
        model=model,
        key_ok=key_ok,
        style=style,
        styles=[ImageStyleOut(**item) for item in image_style_options()],
        aspect_ratios=ASPECT_RATIOS,
        resolutions=RESOLUTIONS,
        qualities=QUALITIES,
        output_formats=OUTPUT_FORMATS,
        backgrounds=BACKGROUNDS,
        max_n=10,
        daily_limit=max(settings.image_daily_limit, 0),
    )


@router.get("/models", response_model=ImageModelsOut)
async def image_models(
    user: CurrentUser = Depends(read_rate_limit),
    settings: Settings = Depends(get_settings),
    provider: str = Query(default=""),
) -> ImageModelsOut:
    provider = (provider or "").strip()
    if not provider:
        provider, _, _ = await load_image_preference(user.client, user.id)
    provider = provider or settings.image_provider or "openrouter"
    try:
        models = await list_image_models(settings, user.client, user.id, provider)
    except ImageGenerationError as exc:
        raise HTTPException(
            exc.status_code or status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return ImageModelsOut(
        provider=provider,
        count=len(models),
        models=[ImageModelOut(**model) for model in models],
    )


@router.get("/endpoints", response_model=ImageEndpointsOut)
async def image_endpoints(
    user: CurrentUser = Depends(read_rate_limit),
    settings: Settings = Depends(get_settings),
    model: str = Query(default=""),
    provider: str = Query(default=""),
) -> ImageEndpointsOut:
    provider = (provider or "").strip()
    model = (model or "").strip()
    if not provider:
        provider, stored_model, _ = await load_image_preference(user.client, user.id)
        model = model or stored_model
    provider = provider or settings.image_provider or "openrouter"
    if not model:
        return ImageEndpointsOut(provider=provider, model=model, endpoints=[])
    try:
        endpoints = await fetch_image_endpoints(
            settings, user.client, user.id, provider, model
        )
    except ImageGenerationError as exc:
        raise HTTPException(
            exc.status_code or status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return ImageEndpointsOut(
        provider=provider,
        model=model,
        endpoints=[ImageEndpointOut(**item) for item in endpoints],
    )


@router.get("/credits", response_model=ImageCreditsOut)
async def image_credits(
    user: CurrentUser = Depends(read_rate_limit),
    settings: Settings = Depends(get_settings),
    provider: str = Query(default=""),
) -> ImageCreditsOut:
    result = await get_credits(settings, user.client, user.id, provider.strip())
    return ImageCreditsOut(**result)


@router.get("/usage", response_model=ImageUsageOut)
async def image_usage(
    user: CurrentUser = Depends(read_rate_limit),
    settings: Settings = Depends(get_settings),
) -> ImageUsageOut:
    usage = await get_image_usage(settings, user.client, user.id)
    return ImageUsageOut(**usage)


@router.put("/style", response_model=ImageStyleOut)
async def set_style(
    payload: ImageStyleUpdate,
    user: CurrentUser = Depends(rate_limit),
) -> ImageStyleOut:
    """Save the default image style used by the Generated Image page."""
    style = await save_image_style(user.client, user.id, payload.style)
    return ImageStyleOut(**image_style_entry(style))


@router.post("/generate", response_model=ImageGenerateOut)
async def generate(
    payload: ImageGenerateRequest,
    user: CurrentUser = Depends(rate_limit),
    settings: Settings = Depends(get_settings),
) -> ImageGenerateOut:
    prompt = payload.prompt.strip()
    if not prompt:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Prompt wajib diisi.")
    try:
        result = await generate_image(
            settings,
            user.client,
            user.id,
            prompt=prompt,
            provider=payload.provider,
            model=payload.model,
            aspect_ratio=payload.aspect_ratio,
            resolution=payload.resolution,
            quality=payload.quality,
            output_format=payload.output_format,
            background=payload.background,
            output_compression=payload.output_compression,
            seed=payload.seed,
            steps=payload.steps,
            style=payload.style,
            input_references=payload.input_references,
            provider_routing=_routing(payload),
            n=payload.n,
        )
    except ImageGenerationError as exc:
        raise HTTPException(
            exc.status_code or status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return ImageGenerateOut(**result)


@router.post("/generate/stream")
async def generate_stream(
    payload: ImageGenerateRequest,
    user: CurrentUser = Depends(rate_limit),
    settings: Settings = Depends(get_settings),
):
    """Stream a generation as SSE.

    Events: ``partial`` ({data_url, index}), ``completed`` ({images, usage}),
    ``error`` ({detail}). Falls back to a single ``completed`` event when the
    model does not emit partial previews.
    """
    prompt = payload.prompt.strip()
    if not prompt:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Prompt wajib diisi.")

    async def generator() -> AsyncGenerator[str, None]:
        async for event in stream_image(
            settings,
            user.client,
            user.id,
            prompt=prompt,
            provider=payload.provider,
            model=payload.model,
            aspect_ratio=payload.aspect_ratio,
            resolution=payload.resolution,
            quality=payload.quality,
            output_format=payload.output_format,
            background=payload.background,
            seed=payload.seed,
            steps=payload.steps,
            style=payload.style,
            input_references=payload.input_references,
            provider_routing=_routing(payload),
            n=payload.n,
        ):
            kind = str(event.get("type") or "message")
            yield _format_sse(kind, json.dumps(event))

    return StreamingResponse(
        generator(), media_type="text/event-stream", headers=_SSE_HEADERS
    )
