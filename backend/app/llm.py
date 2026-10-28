"""LLM provider abstraction and Groq implementation.

The rest of the application depends only on :class:`LLMProvider`, so the model
and provider can be swapped without touching business logic (PRD §13).
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Protocol

import httpx


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


class LLMProviderError(RuntimeError):
    """Raised when the upstream provider fails in a non-retryable way."""


class LLMProvider(Protocol):
    name: str

    def stream_chat(self, request: ChatRequest) -> AsyncIterator[StreamChunk]: ...

    async def complete(self, request: ChatRequest) -> tuple[str, dict | None]: ...


class GroqProvider:
    """Groq OpenAI-compatible chat provider with SSE streaming."""

    name = "groq"

    def __init__(self, api_key: str, base_url: str, timeout: float = 60.0) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

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
                        f"Groq error {response.status_code}: {body.decode(errors='replace')[:500]}"
                    )
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
            response = await client.post(
                f"{self._base_url}/chat/completions",
                headers=self._headers(),
                json=payload,
            )
            if response.status_code >= 400:
                raise LLMProviderError(
                    f"Groq error {response.status_code}: {response.text[:500]}"
                )
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            return content, data.get("usage")
