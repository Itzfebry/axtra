"""Memory extraction pipeline.

After (or before) answering, detect memory-worthy facts in the user's message
and persist them. Extraction results are stored with marked confidence so
inferred facts are never treated as confirmed knowledge (PRD §4.2).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

from app.llm import ChatMessage, ChatRequest, LLMProvider
from app.prompts import MEMORY_EXTRACTION_PROMPT
from app.schemas import MemoryType

VALID_TYPES = set(MemoryType.__args__)  # type: ignore[attr-defined]

# Small fast model for the cheap extraction task, used when available.
_EXTRACT_MODEL_FALLBACK_ORDER = ["openai/gpt-oss-20b", "openai/gpt-oss-120b"]


@dataclass
class ExtractedMemory:
    type: str
    content: str
    confidence: float


def _coerce_items(payload: str) -> list[dict]:
    match = re.search(r"\[.*\]", payload, re.DOTALL)
    if not match:
        return []
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    return [item for item in data if isinstance(item, dict)]


class MemoryExtractor:
    def __init__(self, llm: LLMProvider, default_model: str) -> None:
        self._llm = llm
        self._default_model = default_model

    async def extract(
        self, user_message: str, recent_context: str = "", persona: str = ""
    ) -> tuple[list[ExtractedMemory], dict | None, str | None]:
        """Best-effort extraction; never raises.

        Returns ``(memories, usage, model)``. ``usage``/``model`` describe the
        LLM call that was actually used so the caller can record token usage.
        """
        prompt = MEMORY_EXTRACTION_PROMPT.format(
            user_message=user_message.strip()[:6000], recent_context=recent_context
        )
        if persona:
            prompt = persona + "\n\n" + prompt

        for model in _EXTRACT_MODEL_FALLBACK_ORDER:
            try:
                request = ChatRequest(
                    messages=[ChatMessage(role="user", content=prompt)],
                    model=model,
                    temperature=0.0,
                    max_tokens=1024,
                    stream=False,
                )
                raw, usage = await self._llm.complete(request)
                items = _coerce_items(raw)
            except Exception:
                continue
            return self._validate(items), usage, model
        return [], None, None

    def _validate(self, items: list[dict]) -> list[ExtractedMemory]:
        results: list[ExtractedMemory] = []
        seen: set[str] = set()
        for item in items:
            type_ = str(item.get("type", "")).strip().lower()
            content = str(item.get("content", "")).strip()
            if type_ not in VALID_TYPES or len(content) < 3:
                continue
            dedup_key = content.lower()[:120]
            if dedup_key in seen:
                continue
            seen.add(dedup_key)
            try:
                confidence = max(0.0, min(1.0, float(item.get("confidence", 0.5))))
            except (TypeError, ValueError):
                confidence = 0.5
            results.append(
                ExtractedMemory(type=type_, content=content, confidence=confidence)
            )
        return results[:10]
