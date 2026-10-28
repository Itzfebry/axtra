"""Memory curation: group same-topic memories and merge them into one summary.

Used by the Memory page so the user can collapse redundant notes. Clustering is
semantic when embeddings exist; otherwise the LLM proposes topic groups.
"""

from __future__ import annotations

import json
import re

from app.llm import ChatMessage, ChatRequest, LLMProvider
from app.prompts import MEMORY_GROUPING_PROMPT, MEMORY_MERGE_PROMPT
from app.schemas import MemoryOut
from app.services.memory_extraction import VALID_TYPES

# Small fast models for these cheap side tasks, tried in order.
_MODEL_FALLBACK_ORDER = ["openai/gpt-oss-20b", "openai/gpt-oss-120b"]

# Keep the prompt bounded; content beyond this is truncated.
_MAX_PROMPT_CHARS = 12000


def _coerce_object(payload: str) -> dict:
    match = re.search(r"\{.*\}", payload, re.DOTALL)
    if not match:
        return {}
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _coerce_groups(payload: str, size: int) -> list[list[int]] | None:
    """Parse grouping JSON. ``None`` means unparseable (try another model);
    an empty list is a valid "no shared topics" answer."""
    match = re.search(r"\[.*\]", payload, re.DOTALL)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(data, list):
        return None
    groups: list[list[int]] = []
    for item in data:
        if not isinstance(item, list):
            continue
        indexes = [int(value) for value in item if isinstance(value, int)]
        indexes = [index for index in indexes if 1 <= index <= size]
        if len(indexes) >= 2:
            groups.append(indexes)
    return groups


class MemoryCurator:
    def __init__(self, llm: LLMProvider, default_model: str) -> None:
        self._llm = llm
        self._default_model = default_model

    def _models(self) -> list[str]:
        models = [self._default_model, *_MODEL_FALLBACK_ORDER]
        seen: list[str] = []
        for model in models:
            if model and model not in seen:
                seen.append(model)
        return seen

    async def summarize(
        self, memories: list[MemoryOut]
    ) -> tuple[str, str | None, dict | None, str | None]:
        """Merge memories into one sentence block.

        Returns ``(content, type, usage, model)``. Empty content means the LLM
        call failed for every candidate model.
        """
        listing = "\n".join(f"- {memory.content}" for memory in memories)
        prompt = MEMORY_MERGE_PROMPT.format(memories=listing[:_MAX_PROMPT_CHARS])

        for model in self._models():
            try:
                request = ChatRequest(
                    messages=[ChatMessage(role="user", content=prompt)],
                    model=model,
                    temperature=0.2,
                    max_tokens=1024,
                    stream=False,
                )
                raw, usage = await self._llm.complete(request)
                parsed = _coerce_object(raw)
            except Exception:
                continue
            content = str(parsed.get("summary", "")).strip()
            if content:
                type_ = str(parsed.get("type", "")).strip().lower()
                return content, (type_ if type_ in VALID_TYPES else None), usage, model
        return "", None, None, None

    async def group_by_topic(self, memories: list[MemoryOut]) -> list[list[str]]:
        """Ask the LLM which memories share a topic; returns lists of ids."""
        if len(memories) < 2:
            return []
        listing = "\n".join(
            f"{index + 1}. {memory.content[:280]}"
            for index, memory in enumerate(memories)
        )
        prompt = MEMORY_GROUPING_PROMPT.format(memories=listing[:_MAX_PROMPT_CHARS])

        for model in self._models():
            try:
                request = ChatRequest(
                    messages=[ChatMessage(role="user", content=prompt)],
                    model=model,
                    temperature=0.0,
                    max_tokens=1024,
                    stream=False,
                )
                raw, _usage = await self._llm.complete(request)
                groups = _coerce_groups(raw, len(memories))
            except Exception:
                continue
            if groups is None:
                continue
            return [
                [memories[index - 1].id for index in group if index - 1 < len(memories)]
                for group in groups
            ]
        return []
