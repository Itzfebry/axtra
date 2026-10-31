"""LLM provider abstraction and Groq implementation.

The rest of the application depends only on :class:`LLMProvider`, so the model
and provider can be swapped without touching business logic (PRD §13).
"""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Protocol

import httpx


class LLMProviderError(RuntimeError):
    """Raised when the upstream provider fails in a non-retryable way."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        retry_after: float | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.retry_after = retry_after


_RETRY_IN_RE = re.compile(r"try again in\s*([\d.]+)\s*(ms|s)\b", re.IGNORECASE)

# Last rate-limit snapshot per provider (from response headers when present).
# Groq exposes x-ratelimit-*; other OpenAI-compatible providers may not, in
# which case the UI falls back to locally recorded usage.
_RATE_LIMIT_HEADERS = (
    "x-ratelimit-limit-requests",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-reset-requests",
    "x-ratelimit-limit-tokens",
    "x-ratelimit-remaining-tokens",
    "x-ratelimit-reset-tokens",
    "retry-after",
)
_rate_limits: dict[str, dict[str, str]] = {}


def record_rate_limits(provider: str, headers: httpx.Headers) -> None:
    snapshot = {
        name: headers.get(name, "")
        for name in _RATE_LIMIT_HEADERS
        if headers.get(name)
    }
    if snapshot:
        _rate_limits[provider] = snapshot


def get_rate_limits(provider: str) -> dict[str, str]:
    return dict(_rate_limits.get(provider, {}))


def _retry_after_seconds(response: httpx.Response, default: float = 2.0) -> float:
    """Best-effort delay requested by the provider (header or error message)."""
    header = response.headers.get("retry-after")
    if header:
        try:
            return max(0.0, float(header))
        except ValueError:
            pass
    try:
        error = response.json().get("error") or {}
        message = str(error.get("message") or "")
    except (ValueError, AttributeError):
        message = response.text[:1000]
    match = _RETRY_IN_RE.search(message)
    if match:
        value = float(match.group(1))
        return value / 1000.0 if match.group(2).lower() == "ms" else value
    return default


@dataclass
class ChatMessage:
    role: str  # system | user | assistant
    content: str


@dataclass
class ChatRequest:
    messages: list[ChatMessage]
    model: str
    temperature: float = 0.7
    max_tokens: int = 2048
    stream: bool = True
    metadata: dict = field(default_factory=dict)


@dataclass
class StreamChunk:
    delta: str = ""
    model: str | None = None
    finish_reason: str | None = None
    usage: dict | None = None


class LLMProvider(Protocol):
    name: str

    def stream_chat(self, request: ChatRequest) -> AsyncIterator[StreamChunk]: ...

    async def complete(self, request: ChatRequest) -> tuple[str, dict | None]: ...


class OpenAICompatibleProvider:
    """OpenAI-compatible chat provider (Groq, OpenAI, OpenRouter, ...).

    Only the base URL, key, and display name vary between providers, so one
    adapter covers them all. Error strings carry the provider name to make
    failures readable in the UI.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str,
        name: str = "openai-compatible",
        timeout: float = 60.0,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self.name = name

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    @property
    def label(self) -> str:
        return self.name.capitalize()

    def _payload(self, request: ChatRequest, stream: bool) -> dict:
        return {
            "model": request.model,
            "messages": [
                {"role": m.role, "content": m.content} for m in request.messages
            ],
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "stream": stream,
        }

    async def stream_chat(self, request: ChatRequest) -> AsyncIterator[StreamChunk]:
        payload = self._payload(request, stream=True)
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            async with client.stream(
                "POST",
                f"{self._base_url}/chat/completions",
                headers=self._headers(),
                json=payload,
            ) as response:
                if response.status_code >= 400:
                    body = await response.aread()
                    raise LLMProviderError(
                        f"{self.label} error {response.status_code}: {body.decode(errors='replace')[:500]}"
                    )
                record_rate_limits(self.name, response.headers)
                async for line in response.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[len("data:") :].strip()
                    if data == "[DONE]":
                        break
                    try:
                        parsed = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    choices = parsed.get("choices") or []
                    if not choices:
                        continue
                    choice = choices[0]
                    delta = (choice.get("delta") or {}).get("content") or ""
                    yield StreamChunk(
                        delta=delta,
                        model=parsed.get("model"),
                        finish_reason=choice.get("finish_reason"),
                        usage=parsed.get("usage") or parsed.get("x_groq", {}).get("usage"),
                    )

    async def complete(self, request: ChatRequest) -> tuple[str, dict | None]:
        payload = self._payload(request, stream=False)
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response: httpx.Response | None = None
            for attempt in range(3):
                response = await client.post(
                    f"{self._base_url}/chat/completions",
                    headers=self._headers(),
                    json=payload,
                )
                if response.status_code == 429 and attempt < 2:
                    # Free-tier TPM limits are transient; honour the provider's
                    # suggested delay before retrying the same request.
                    await asyncio.sleep(
                        min(_retry_after_seconds(response) + 0.25, 15.0)
                    )
                    continue
                break

            assert response is not None
            record_rate_limits(self.name, response.headers)
            if response.status_code >= 400:
                retry_after = (
                    _retry_after_seconds(response)
                    if response.status_code == 429
                    else None
                )
                raise LLMProviderError(
                    f"{self.label} error {response.status_code}: {response.text[:500]}",
                    status_code=response.status_code,
                    retry_after=retry_after,
                )
            data = response.json()
            choice = data["choices"][0]
            content = choice["message"]["content"] or ""
            usage = data.get("usage") or {}
            finish_reason = choice.get("finish_reason")
            if finish_reason:
                usage = dict(usage or {})
                usage["finish_reason"] = finish_reason
            return content, usage or None


class GroqProvider(OpenAICompatibleProvider):
    """Backward-compatible Groq adapter (default provider)."""

    def __init__(self, api_key: str, base_url: str, timeout: float = 60.0) -> None:
        super().__init__(api_key=api_key, base_url=base_url, name="groq", timeout=timeout)
