"""Homepage recommendations: an assistant digest of recent interaction history."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends

from app.config import get_settings
from app.deps import CurrentUser, rate_limit
from app.llm import ChatMessage, ChatRequest
from app.memory_service_provider import build_llm_provider, build_memory_service
from app.schemas import RecommendationOut
from app.services.feature_persona import load_feature_persona

router = APIRouter(prefix="/api/recommendations", tags=["recommendations"])

_MAX_MEMORIES = 10
_MAX_CONVERSATIONS = 8
_MAX_MESSAGES = 24
_MAX_MESSAGE_CHARS = 280

_SYSTEM_PROMPT = """\
Kamu adalah Axtra, asisten AI personal pengguna. Tugasmu: memberi rekomendasi \
sebagai asisten berdasarkan RINGKASAN RIWAYAT INTERAKSI di bawah.

Aturan:
- Balas HANYA JSON valid tanpa teks lain: {"greeting": "...", "items": ["...", "..."]}
- "greeting": satu kalimat sapaan hangat dan personal (pakai nama bila tersedia).
- "items": 3-4 rekomendasi konkret dan actionable, bahasa Indonesia, maksimal 15 kata per item.
- Rujuk topik/proyek yang benar-benar ada di konteks. Jangan mengarang fakta.
- Jika riwayat minim, sarankan langkah awal yang masuk akal, bukan asumsi pribadi.
"""


def _trim(text: str, limit: int) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _build_digest(
    profile: dict[str, Any],
    conversations: list[dict[str, Any]],
    messages: list[dict[str, Any]],
    memories: list[Any],
) -> str:
    blocks: list[str] = []

    profile_bits: list[str] = []
    if profile.get("display_name"):
        profile_bits.append(f"Nama: {profile['display_name']}")
    if profile.get("timezone"):
        profile_bits.append(f"Zona waktu: {profile['timezone']}")
    if profile.get("communication_style"):
        profile_bits.append(f"Gaya komunikasi: {profile['communication_style']}")
    if profile_bits:
        blocks.append("PROFIL:\n" + "\n".join(profile_bits))

    if memories:
        lines = []
        for memory in memories:
            content = getattr(memory, "content", None)
            type_ = getattr(memory, "type", "fakta")
            if content:
                lines.append(f"- [{type_}] {_trim(content, 200)}")
        if lines:
            blocks.append("MEMORI AKTIF:\n" + "\n".join(lines))

    if conversations:
        by_conversation: dict[str, list[dict[str, Any]]] = {}
        for message in messages:
            by_conversation.setdefault(message.get("conversation_id", ""), []).append(message)

        lines = []
        for conversation in conversations:
            title = conversation.get("title") or "Tanpa judul"
            mode = conversation.get("mode") or "general"
            summary = conversation.get("summary")
            header = f"- {title} (mode: {mode})"
            if summary:
                header += f" — ringkasan: {_trim(summary, 220)}"
            lines.append(header)
            # Messages arrive newest-first; keep each conversation's latest few
            # and restore chronological order.
            for message in reversed(by_conversation.get(conversation["id"], [])[:4]):
                role = "Pengguna" if message.get("role") == "user" else "Axtra"
                lines.append(f"  {role}: {_trim(message.get('content', ''), _MAX_MESSAGE_CHARS)}")
        blocks.append("RIWAYAT PERCAKAPAN TERBARU:\n" + "\n".join(lines))

    return "\n\n".join(blocks)


def _fallback_items(
    conversations: list[dict[str, Any]], memories: list[Any]
) -> list[str]:
    items: list[str] = []
    if conversations:
        title = conversations[0].get("title") or "percakapan terakhir"
        items.append(f"Lanjutkan “{_trim(title, 40)}” dan tentukan satu langkah berikutnya.")
    if memories:
        items.append("Tinjau memori terbaru dan koreksi yang sudah tidak relevan.")
    if not items:
        items.extend(
            [
                "Mulai percakapan baru untuk membangun konteks.",
                "Lengkapi profil agar saran lebih personal.",
                "Tambahkan memori penting yang ingin selalu diingat.",
            ]
        )
    else:
        items.append("Catat satu prioritas untuk hari ini di percakapan.")
    return items[:4]


def _parse_recommendations(raw: str) -> tuple[str, list[str]] | None:
    text = raw.strip()
    # Tolerate a fenced JSON block.
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.IGNORECASE | re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    if not text.startswith("{"):
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            return None
        text = match.group(0)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    greeting = str(parsed.get("greeting") or "").strip()
    raw_items = parsed.get("items")
    if not isinstance(raw_items, list):
        return None
    items = [str(item).strip() for item in raw_items if str(item).strip()]
    if not greeting or not items:
        return None
    return greeting, items[:4]


@router.get("", response_model=RecommendationOut)
async def get_recommendations(
    user: CurrentUser = Depends(rate_limit),
) -> RecommendationOut:
    """Return assistant recommendations derived from a digest of recent history."""
    settings = get_settings()
    client = user.client

    conversations: list[dict[str, Any]] = []
    try:
        response = await (
            client.table("conversations")
            .select("id,title,mode,summary,last_message_at")
            .order("last_message_at", desc=True, nullsfirst=False)
            .order("created_at", desc=True)
            .limit(_MAX_CONVERSATIONS)
            .execute()
        )
        conversations = response.data or []
    except Exception:
        conversations = []

    profile: dict[str, Any] = {}
    try:
        profile_response = await (
            client.table("profiles")
            .select("display_name,communication_style,timezone")
            .eq("id", user.id)
            .maybe_single()
            .execute()
        )
        profile = (profile_response.data if profile_response else None) or {}
    except Exception:
        profile = {}

    memories: list[Any] = []
    try:
        memories = await build_memory_service(client).list_memories(
            user.id, limit=_MAX_MEMORIES
        )
    except Exception:
        memories = []

    messages: list[dict[str, Any]] = []
    conversation_ids = [row["id"] for row in conversations if row.get("id")]
    if conversation_ids:
        try:
            message_response = await (
                client.table("messages")
                .select("conversation_id,role,content,created_at")
                .in_("conversation_id", conversation_ids)
                .order("created_at", desc=True)
                .limit(_MAX_MESSAGES)
                .execute()
            )
            messages = message_response.data or []
        except Exception:
            messages = []

    now = datetime.now(timezone.utc)

    if not conversations and not memories:
        return RecommendationOut(
            greeting="Belum ada riwayat yang cukup. Mulai percakapan agar Axtra bisa mengenalmu.",
            items=_fallback_items([], []),
            conversation_count=0,
            memory_count=0,
            generated_at=now,
            source="empty",
        )

    digest = _build_digest(profile, conversations, messages, memories)
    persona = await load_feature_persona(
        client, "recommendations", user_id=user.id
    )
    fallback_greeting = (
        f"Halo{', ' + profile['display_name'] if profile.get('display_name') else ''}."
        " Ini yang bisa kita lanjutkan."
    )

    try:
        llm = build_llm_provider()
        content, _ = await llm.complete(
            ChatRequest(
                messages=[
                    ChatMessage(
                        role="system",
                        content=_SYSTEM_PROMPT + (f"\n\n{persona}" if persona else ""),
                    ),
                    ChatMessage(role="user", content=digest),
                ],
                model=settings.default_chat_model,
                temperature=0.5,
                max_tokens=600,
                stream=False,
            )
        )
        parsed = _parse_recommendations(content)
        if parsed:
            greeting, items = parsed
            return RecommendationOut(
                greeting=greeting,
                items=items,
                conversation_count=len(conversations),
                memory_count=len(memories),
                generated_at=now,
                source="llm",
            )
    except Exception:
        # Recommendations are a convenience; never fail the homepage over them.
        pass

    return RecommendationOut(
        greeting=fallback_greeting,
        items=_fallback_items(conversations, memories),
        conversation_count=len(conversations),
        memory_count=len(memories),
        generated_at=now,
        source="fallback",
    )