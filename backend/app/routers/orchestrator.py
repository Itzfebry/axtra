"""Homepage orchestrator: Axtra configures the menu and triggers navigation."""

from __future__ import annotations

import json
import re
from typing import Any

from fastapi import APIRouter, Depends

from app.config import get_settings
from app.deps import CurrentUser, rate_limit
from app.llm import ChatMessage, ChatRequest
from app.memory_service_provider import build_llm_provider
from app.schemas import (
    OrchestratorAction,
    OrchestratorOut,
    OrchestratorRequest,
)

router = APIRouter(prefix="/api/orchestrator", tags=["orchestrator"])

_ALLOWED_ROUTES = {
    "/",
    "/chat",
    "/memory",
    "/profile",
    "/settings",
}

# Chat modes are sub-tools of /chat; expose each so intent maps to the right one.
_CHAT_MODE_ROUTES: dict[str, str] = {
    "/chat/general": "General - percakapan serba guna, rencana, ringkasan",
    "/chat/curhat": "Curhat - ruang cerita aman, nada empatik, jangan buru-buru solusi",
    "/chat/brainstorming": "Brainstorming - meledakkan banyak ide",
    "/chat/document": "Document - tanya jawab dengan dokumen yang diunggah",
}
_ALLOWED_ROUTES |= set(_CHAT_MODE_ROUTES)
_CHAT_MODES = ["general", "curhat", "brainstorming", "document"]

_SYSTEM_PROMPT = """\
Kamu adalah Axtra, orchestrator untuk halaman menu ruang kerja pengguna.

Satu-satunya tugasmu: menerjemahkan keinginan pengguna menjadi aksi pada \
menu/tools yang TERSEDIA pada konteks.

Cara kerja:
1. Pahami tujuan pengguna.
2. Petakan tujuan itu ke menu atau tool yang tersedia pada konteks.
3. Hasilkan aksi yang mewujudkannya (atur menu atau buka halaman tool).
4. Balas singkat (bahasa Indonesia) yang menjelaskan aksi yang dibuat.

Bila permintaan TIDAK berkaitan dengan menu/tools yang tersedia:
- Jangan mengarang fitur, id, atau rute.
- Tolak dengan sopan, lalu sebutkan tool/menu yang tersedia.
- Kembalikan actions: [].

Kamu HANYA boleh memakai menu dan rute yang diberikan pada konteks.

Balas HANYA JSON valid tanpa teks lain:
{
  "reply": "<balasan singkat untuk pengguna>",
  "actions": [
    {"type": "navigate", "href": "/chat/curhat", "prompt": "<pesan awal opsional>"},
    {"type": "new_conversation", "mode": "brainstorming", "title": "<opsional>", "prompt": "<opsional>"},
    {"type": "focus_menu", "target": "<id menu>"},
    {"type": "menu_order", "order": ["<id>", "<id>", "..."]},
    {"type": "menu_visibility", "hidden": ["<id>", "..."]},
    {"type": "menu_rename", "labels": {"<id>": "<nama baru>"}},
    {"type": "set_theme", "theme": "light"},
    {"type": "save_memory", "content": "<fakta yang ingin diingat>"},
    {"type": "reset_menu"}
  ]
}

Aturan aksi:
- navigate: href harus salah satu rute yang diizinkan; pakai ini untuk membuka \
tool/halaman tempat pengguna ingin bekerja. Bila pengguna ingin mengobrol, \
pilih mode chat yang paling cocok (curhat -> /chat/curhat, \
brainstorming -> /chat/brainstorming, dokumen -> /chat/document, \
lainnya -> /chat/general). Isi "prompt" bila pengguna sudah menyebut isi \
permintaannya, agar dikirim otomatis di sana.
- new_conversation: buat percakapan baru pada mode tertentu; "title" dan \
"prompt" opsional dari permintaan pengguna.
- focus_menu: sorot/arahkan ke satu tool di sidebar; "target" harus id menu \
yang ada di konteks.
- menu_order: sertakan SEMUA id menu, urut dari yang diinginkan.
- menu_visibility: hidden berisi id yang harus disembunyikan (selain itu tampil).
- menu_rename: hanya id dan label yang disebut pengguna.
- set_theme: theme bernilai "light" atau "dark".
- save_memory: simpan fakta personal yang jelas dan berulang; "content" singkat.
- reset_menu: tanpa field lain.
- Sertakan actions: [] bila tidak ada aksi yang cocok.
- Jangan mengarang id, nama fitur, rute, atau fakta.
"""


def _menu_context(request: OrchestratorRequest) -> str:
    lines = ["MENU SAAT INI:"]
    for item in request.menu:
        status = "tampil" if item.visible else "disembunyikan"
        live = "live" if item.live else "belum tersedia"
        href = f", href={item.href}" if item.href else ""
        lines.append(f"- id={item.id} | {item.label} | {status} | {live}{href}")
    lines.append(
        "MODE CHAT (sub-tool dari Chat, pakai navigate ke href yang paling cocok):"
    )
    for href, description in _CHAT_MODE_ROUTES.items():
        lines.append(f"- href={href} | {description}")
    routes = sorted({item.href for item in request.menu if item.href} | _ALLOWED_ROUTES)
    lines.append("RUTE YANG DIIZINKAN: " + ", ".join(routes))
    return "\n".join(lines)


def _parse_json(raw: str) -> dict[str, Any] | None:
    text = raw.strip()
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
    return parsed if isinstance(parsed, dict) else None


def _sanitize_actions(
    raw_actions: Any, request: OrchestratorRequest
) -> list[OrchestratorAction]:
    if not isinstance(raw_actions, list):
        return []

    known_ids = [item.id for item in request.menu]
    known_set = set(known_ids)
    allowed_routes = {item.href for item in request.menu if item.href} | _ALLOWED_ROUTES

    actions: list[OrchestratorAction] = []
    for raw in raw_actions:
        if not isinstance(raw, dict):
            continue
        action_type = raw.get("type")
        if action_type == "menu_order":
            seen: list[str] = []
            for item_id in raw.get("order") or []:
                if isinstance(item_id, str) and item_id in known_set and item_id not in seen:
                    seen.append(item_id)
            for item_id in known_ids:
                if item_id not in seen:
                    seen.append(item_id)
            if seen:
                actions.append(OrchestratorAction(type="menu_order", order=seen))
        elif action_type == "menu_visibility":
            hidden = [
                item_id
                for item_id in (raw.get("hidden") or [])
                if isinstance(item_id, str) and item_id in known_set
            ]
            actions.append(OrchestratorAction(type="menu_visibility", hidden=hidden))
        elif action_type == "menu_rename":
            labels: dict[str, str] = {}
            raw_labels = raw.get("labels")
            if isinstance(raw_labels, dict):
                for item_id, label in raw_labels.items():
                    if item_id in known_set and isinstance(label, str) and label.strip():
                        labels[item_id] = label.strip()[:24]
            if labels:
                actions.append(OrchestratorAction(type="menu_rename", labels=labels))
        elif action_type == "navigate":
            href = raw.get("href")
            if isinstance(href, str) and href in allowed_routes:
                prompt = raw.get("prompt")
                prompt = prompt.strip()[:4000] if isinstance(prompt, str) and prompt.strip() else None
                actions.append(OrchestratorAction(type="navigate", href=href, prompt=prompt))
        elif action_type == "set_theme":
            theme = raw.get("theme")
            if theme in ("light", "dark"):
                actions.append(OrchestratorAction(type="set_theme", theme=theme))
        elif action_type == "save_memory":
            content = raw.get("content")
            if isinstance(content, str) and content.strip():
                actions.append(
                    OrchestratorAction(type="save_memory", content=content.strip()[:500])
                )
        elif action_type == "new_conversation":
            mode = raw.get("mode")
            mode = mode if mode in _CHAT_MODES else "general"
            title = raw.get("title")
            title = title.strip()[:80] if isinstance(title, str) and title.strip() else None
            prompt = raw.get("prompt")
            prompt = prompt.strip()[:4000] if isinstance(prompt, str) and prompt.strip() else None
            actions.append(
                OrchestratorAction(
                    type="new_conversation", mode=mode, title=title, prompt=prompt
                )
            )
        elif action_type == "focus_menu":
            target = raw.get("target") or raw.get("id")
            if isinstance(target, str) and target in known_set:
                actions.append(OrchestratorAction(type="focus_menu", target=target))
        elif action_type == "reset_menu":
            actions.append(OrchestratorAction(type="reset_menu"))
    return actions


@router.post("", response_model=OrchestratorOut)
async def orchestrate(
    request: OrchestratorRequest,
    user: CurrentUser = Depends(rate_limit),
) -> OrchestratorOut:
    """Interpret a natural-language request into menu actions and a reply."""
    settings = get_settings()
    context = _menu_context(request)

    messages = [ChatMessage(role="system", content=_SYSTEM_PROMPT + "\n\n" + context)]
    for item in request.history[-8:]:
        messages.append(ChatMessage(role=item.role, content=item.content))
    messages.append(ChatMessage(role="user", content=request.message))

    try:
        llm = build_llm_provider()
        content, _ = await llm.complete(
            ChatRequest(
                messages=messages,
                model=settings.default_chat_model,
                temperature=0.3,
                max_tokens=700,
                stream=False,
            )
        )
        parsed = _parse_json(content)
        if parsed:
            reply = str(parsed.get("reply") or "").strip()
            actions = _sanitize_actions(parsed.get("actions"), request)
            if reply:
                return OrchestratorOut(reply=reply, actions=actions)
    except Exception:
        # The orchestrator must degrade gracefully when the LLM is unavailable.
        pass

    return OrchestratorOut(
        reply=(
            "Maaf, saya belum bisa memproses permintaan itu sekarang. "
            "Coba lagi sebentar lagi."
        ),
        actions=[],
    )