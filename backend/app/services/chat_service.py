"""Chat orchestration: context building, streaming, persistence, memory loop."""

from __future__ import annotations

import json
import re
import time
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from dataclasses import dataclass
from typing import Any

from supabase import AsyncClient

from app.chat_modes import build_persona_prompt, resolve_command, resolve_mode_settings
from app.config import Settings
from app.llm import ChatMessage, ChatRequest, GroqProvider, LLMProvider
from app.prompts import (
    DOCUMENT_CONTEXT_HEADER,
    MEMORY_CONTEXT_HEADER,
    MODE_PROMPTS,
    SYSTEM_PROMPT,
)
from app.schemas import MemoryOut
from app.services.memory_extraction import MemoryExtractor
from app.services.memory_service import MemoryService
from app.services.usage_service import record_usage


_OPTIONS_BLOCK = re.compile(r"```\s*options\s*(.*?)(?:```|$)", re.IGNORECASE | re.DOTALL)


def _parse_options(raw: str) -> list[str]:
    """Parse the options payload as a JSON array, with line-based fallback."""
    text = raw.strip()
    if not text:
        return []
    for candidate in (text,):
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]
    # Fallback: an array somewhere in the payload.
    array_match = re.search(r"\[.*\]", text, re.DOTALL)
    if array_match:
        try:
            parsed = json.loads(array_match.group(0))
            if isinstance(parsed, list):
                return [str(item).strip() for item in parsed if str(item).strip()]
        except json.JSONDecodeError:
            pass
    # Last resort: bullet/numbered lines.
    options: list[str] = []
    for line in text.splitlines():
        cleaned = re.sub(r"^\s*(?:[-*]|\d+[.)])\s*", "", line).strip().strip('"').strip("'")
        if cleaned:
            options.append(cleaned)
    return options


def _extract_options(reply: str) -> tuple[str, list[str]]:
    """Pull an optional ```options JSON block out of the model reply.

    Tolerates a missing closing fence (e.g. a truncated stream) and a stray
    space after the backticks. The block is only stripped when it actually
    yields options, so ordinary code is never removed by accident.
    """
    match = _OPTIONS_BLOCK.search(reply)
    if not match:
        return reply, []
    options = _parse_options(match.group(1))
    if not options:
        return reply, []
    cleaned_reply = (reply[: match.start()] + reply[match.end() :]).strip()
    return cleaned_reply, options[:4]


@dataclass
class ConversationContext:
    conversation_id: str
    mode: str
    profile: dict[str, Any] | None
    mode_settings: dict[str, Any]
    history: list[dict[str, Any]]
    memories: list[MemoryOut]
    documents: list[dict[str, Any]]


class ConversationNotFound(Exception):
    """Raised when a caller passes a conversation id that does not exist."""


class ChatService:
    def __init__(
        self,
        settings: Settings,
        llm: LLMProvider,
        memory_service_factory,
        extractor: MemoryExtractor,
    ) -> None:
        self._settings = settings
        self._llm = llm
        self._memory_service_factory = memory_service_factory
        self._extractor = extractor

    # ---------------------------------------------------------------- helpers
    async def _ensure_conversation(
        self,
        client: AsyncClient,
        user_id: str,
        conversation_id: str | None,
        mode: str = "general",
    ) -> tuple[str, str]:
        if conversation_id:
            # Verify ownership through RLS: a scoped query will return the row
            # only if it belongs to the current user. The stored mode wins.
            response = (
                await client.table("conversations")
                .select("id, mode")
                .eq("id", conversation_id)
                .maybe_single()
                .execute()
            )
            if response and response.data:
                return response.data["id"], response.data.get("mode") or "general"
            # A stale/deleted id must not silently create another conversation.
            raise ConversationNotFound(conversation_id)
        payload = {"user_id": user_id, "title": None, "mode": mode}
        response = await client.table("conversations").insert(payload).execute()
        row = response.data[0]
        return row["id"], row.get("mode") or mode

    async def _load_context(
        self,
        client: AsyncClient,
        user_id: str,
        conversation_id: str,
        mode: str,
        user_message: str,
        use_memory: bool,
        memory_service: MemoryService | None,
    ) -> ConversationContext:
        history_query = (
            client.table("messages")
            .select("role, content, created_at")
            .eq("conversation_id", conversation_id)
            .order("created_at", desc=True)
            .limit(self._settings.max_context_messages)
        )
        history_result = await history_query.execute()
        history = list(reversed(history_result.data or []))

        profile_response = await (
            client.table("profiles").select("*").eq("id", user_id).single().execute()
        )
        profile = profile_response.data or {}

        memories: list[MemoryOut] = []
        if use_memory and memory_service and user_message.strip():
            try:
                memories = await memory_service.retrieve(user_id, user_message)
            except Exception:
                memories = []

        # Documents are scoped to one conversation and only used in document mode.
        documents: list[dict[str, Any]] = []
        if mode == "document":
            doc_response = await (
                client.table("chat_documents")
                .select("filename, content")
                .eq("conversation_id", conversation_id)
                .order("created_at")
                .execute()
            )
            documents = doc_response.data or []

        return ConversationContext(
            conversation_id=conversation_id,
            mode=mode,
            profile=profile,
            mode_settings=resolve_mode_settings(profile.get("preferences"), mode),
            history=history,
            memories=memories,
            documents=documents,
        )

    def _build_messages(
        self, context: ConversationContext, command: str | None = None
    ) -> list[ChatMessage]:
        parts = [
            SYSTEM_PROMPT,
            MODE_PROMPTS.get(context.mode, MODE_PROMPTS["general"]),
        ]

        persona = build_persona_prompt(context.mode, context.mode_settings)
        if persona:
            parts.append(persona)

        profile = context.profile or {}
        profile_bits = []
        if profile.get("display_name"):
            profile_bits.append(f"Nama: {profile['display_name']}")
        if profile.get("timezone"):
            profile_bits.append(f"Zona waktu: {profile['timezone']}")
        if profile.get("communication_style"):
            profile_bits.append(f"Gaya komunikasi pengguna: {profile['communication_style']}")
        preferences = profile.get("preferences") or {}
        # `chat_modes` is internal configuration, not user context.
        preferences = {k: v for k, v in preferences.items() if k != "chat_modes"}
        if preferences:
            import json as _json

            try:
                profile_bits.append(
                    "Preferensi: " + _json.dumps(preferences, ensure_ascii=False)[:800]
                )
            except (TypeError, ValueError):
                pass
        if profile_bits:
            parts.append("PROFIL PENGGUNA:\n" + "\n".join(profile_bits))

        if context.memories:
            lines = []
            for memory in context.memories:
                label = memory.type
                content = memory.content.strip()
                flag = f" [{label}]" if label else ""
                lines.append(f"-{flag} {content}")
            parts.append(MEMORY_CONTEXT_HEADER + "\n" + "\n".join(lines))

        if context.documents:
            doc_blocks: list[str] = []
            remaining = self._settings.max_document_chars
            for document in context.documents:
                if remaining <= 0:
                    break
                text = (document.get("content") or "").strip()
                if not text:
                    continue
                snippet = text[:remaining]
                remaining -= len(snippet)
                doc_blocks.append(f"--- {document.get('filename', 'dokumen')} ---\n{snippet}")
            if doc_blocks:
                parts.append(DOCUMENT_CONTEXT_HEADER + "\n" + "\n\n".join(doc_blocks))

        command_instruction = resolve_command(context.mode, command)
        if command_instruction:
            parts.append(command_instruction)

        parts.append("Aturan pelaksanaan: jangan sebut 'memori' secara eksplisit kecuali "
                     "pengguna menanyakan apa yang kamu ingat.")

        history = [
            ChatMessage(role=m.get("role", "user"), content=m.get("content", ""))
            for m in context.history
        ]
        return [ChatMessage(role="system", content="\n\n".join(parts))] + history

    # ------------------------------------------------------------------ stream
    async def stream_response(
        self,
        *,
        client: AsyncClient,
        user_id: str,
        conversation_id: str | None,
        user_message: str,
        model: str | None,
        use_memory: bool,
        temperature: float = 0.7,
        mode: str = "general",
        command: str | None = None,
    ) -> AsyncIterator[dict[str, str]]:
        """Yield SSE-ready events for a chat turn (meta, token, done, memory, error)."""
        started = time.monotonic()

        async def _emit(event: str, data: dict[str, Any]) -> dict[str, str]:
            return {"event": event, "data": json.dumps(data, ensure_ascii=False)}

        # A command-only turn has no user text. Persist an empty message (the UI
        # renders the command chip from metadata) but still give the model a
        # short user line to answer.
        display_content = user_message.strip()
        command_id = (command or "").strip().lstrip("/").lower() or None
        prompt_content = display_content or (f"/{command_id}" if command_id else "(kosong)")

        try:
            conversation_id, mode = await self._ensure_conversation(
                client, user_id, conversation_id, mode
            )

            memory_service = self._memory_service_factory(client) if use_memory else None
            context = await self._load_context(
                client,
                user_id,
                conversation_id,
                mode,
                prompt_content,
                use_memory,
                memory_service,
            )

            messages = self._build_messages(context, command)
            # The current turn is not persisted yet, so it is not in `history`.
            # Without this the model answers the previous user message.
            messages.append(ChatMessage(role="user", content=prompt_content))
            llm_request = ChatRequest(
                messages=messages,
                model=model or self._settings.default_chat_model,
                temperature=temperature,
            )

            yield await _emit(
                "meta",
                {
                    "conversation_id": conversation_id,
                    "model": llm_request.model,
                    "mode": mode,
                },
            )

            reply_parts: list[str] = []
            usage: dict[str, Any] | None = None

            async for chunk in self._llm.stream_chat(llm_request):
                if chunk.usage:
                    usage = chunk.usage
                if chunk.delta:
                    reply_parts.append(chunk.delta)
                    yield await _emit("token", {"t": chunk.delta})
            reply = "".join(reply_parts)
            reply, options = _extract_options(reply)
            reply = reply.strip()

            if not reply:
                raise LLMProviderError("Model tidak mengembalikan respons.")

            try:
                await self._persist_turn(
                    client,
                    user_id,
                    conversation_id,
                    display_content,
                    reply,
                    llm_request.model,
                    usage,
                    options,
                    command,
                )
            except Exception as exc:  # noqa: BLE001 - never break the stream
                yield await _emit("warning", {"detail": f"Gagal menyimpan percakapan: {exc}"})

            # Record usage before `done` so a usage refetch triggered by the
            # client sees this turn's tokens immediately.
            await record_usage(
                client, user_id, llm_request.model, usage, source="chat"
            )

            # The answer is streamed and persisted. Signal completion now so the
            # client can accept the next message while the slower memory
            # extraction (a second LLM call) continues on this connection.
            yield await _emit(
                "done",
                {
                    "conversation_id": conversation_id,
                    "elapsed_ms": int((time.monotonic() - started) * 1000),
                    "content": reply,
                    "options": options,
                    "mode": mode,
                },
            )

            # Memory extraction runs after `done`; its failures can never
            # corrupt the already-streamed reply. Command-only turns carry no
            # personal facts, so skip them.
            if self._settings.memory_extraction_enabled and display_content:
                try:
                    recent_context = "\n".join(
                        str(m.get("content", "")) for m in context.history[-4:]
                    )
                    saved = await self.extract_and_store(
                        client,
                        user_id,
                        conversation_id,
                        display_content,
                        recent_context,
                    )
                    if saved:
                        yield await _emit("memory", {"saved": saved})
                except Exception as exc:  # noqa: BLE001
                    yield await _emit(
                        "warning", {"detail": f"Ekstraksi memori gagal: {exc}"}
                    )
        except ConversationNotFound:
            yield await _emit("error", {"detail": "Percakapan tidak ditemukan."})
        except Exception as exc:  # noqa: BLE001
            yield await _emit("error", {"detail": str(exc)})

    # --------------------------------------------------------------- persist
    async def _persist_turn(
        self,
        client: AsyncClient,
        user_id: str,
        conversation_id: str,
        user_message: str,
        assistant_reply: str,
        model: str | None,
        usage: dict[str, Any] | None = None,
        options: list[str] | None = None,
        command: str | None = None,
    ) -> None:
        metadata: dict[str, Any] = dict(usage or {})
        if options:
            metadata["options"] = options
        command_id = (command or "").strip().lstrip("/").lower() or None
        user_metadata: dict[str, Any] = {}
        if command_id:
            user_metadata["command"] = command_id
        rows = [
            {
                "conversation_id": conversation_id,
                "user_id": user_id,
                "role": "user",
                "content": user_message,
                "metadata": user_metadata,
            },
            {
                "conversation_id": conversation_id,
                "user_id": user_id,
                "role": "assistant",
                "content": assistant_reply,
                "model": model,
                "token_count": (usage or {}).get("total_tokens"),
                "metadata": metadata,
            },
        ]
        await client.table("messages").insert(rows).execute()
        title_hint = user_message or (f"/{command_id}" if command_id else "")
        await self._set_conversation_metadata(client, conversation_id, title_hint)

    async def _set_conversation_metadata(
        self, client: AsyncClient, conversation_id: str, user_message: str
    ) -> None:
        count = await self._count_messages(client, conversation_id)
        # Only set the title on the very first exchange.
        title_response = (
            await client.table("conversations")
            .select("title")
            .eq("id", conversation_id)
            .maybe_single()
            .execute()
        )
        existing = (title_response.data if title_response else None) or {}
        patch: dict[str, Any] = {
            "message_count": count,
            "last_message_at": datetime.now(timezone.utc).isoformat(),
        }
        if not existing.get("title"):
            patch["title"] = (user_message[:60] + ("…" if len(user_message) > 60 else "")) or "Percakapan baru"
        await (
            client.table("conversations").update(patch).eq("id", conversation_id).execute()
        )

    async def _count_messages(self, client: AsyncClient, conversation_id: str) -> int:
        response = (
            await client.table("messages")
            .select("id", count="exact")
            .eq("conversation_id", conversation_id)
            .execute()
        )
        return int(response.count or 0)

    # ------------------------------------------------------------- extraction
    async def extract_and_store(
        self,
        client: AsyncClient,
        user_id: str,
        conversation_id: str,
        user_message: str,
        recent_context: str = "",
    ) -> list[dict[str, str]]:
        """Post-response memory extraction run.

        ``recent_context`` is the conversation history captured *before* this
        turn, so the current message is not duplicated in the prompt.
        """
        memory_service = self._memory_service_factory(client)

        extracted, usage, model = await self._extractor.extract(
            user_message, recent_context[:2000]
        )
        await record_usage(client, user_id, model, usage, source="memory")

        saved: list[dict[str, str]] = []
        for item in extracted:
            if await memory_service.exists_active(user_id, item.content):
                continue
            memory = await memory_service.create(
                user_id,
                type_=item.type,
                content=item.content,
                source="chat",
                source_ref={"conversation_id": conversation_id},
                confidence=item.confidence,
            )
            saved.append({"id": memory.id, "type": memory.type, "content": memory.content})
        return saved


def build_groq_provider(settings: Settings) -> GroqProvider:
    return GroqProvider(api_key=settings.groq_api_key, base_url=settings.groq_base_url)
