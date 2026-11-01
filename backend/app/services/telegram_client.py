"""Thin async client for the Telegram Bot API.

Only the endpoints Axtra needs are wrapped. Messages use ``parse_mode=HTML``
(only ``&``, ``<``, ``>`` need escaping) because MarkdownV2's escaping rules are
error-prone for dynamic content. Long text is split to Telegram's 4096-char cap.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger("axtra.telegram")

_API_BASE = "https://api.telegram.org"
_MAX_MESSAGE_CHARS = 4096
# Headroom below the hard cap so a trailing entity/chunk stays valid.
_SPLIT_CHARS = 3800


class TelegramError(RuntimeError):
    """Raised when the Bot API returns ``ok: false`` or the request fails."""

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


def escape_html(text: str) -> str:
    """Escape the three characters Telegram's HTML parser treats as markup."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def split_message(text: str, limit: int = _SPLIT_CHARS) -> list[str]:
    """Split long text on newlines (falling back to hard cuts) for Telegram."""
    if len(text) <= limit:
        return [text]
    chunks: list[str] = []
    remaining = text
    while len(remaining) > limit:
        cut = remaining.rfind("\n", 0, limit)
        if cut <= 0:
            cut = limit
        chunks.append(remaining[:cut].rstrip())
        remaining = remaining[cut:].lstrip("\n")
    if remaining:
        chunks.append(remaining)
    return chunks


class TelegramClient:
    def __init__(self, token: str, timeout: float = 25.0) -> None:
        self._token = token
        self._timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self._token)

    async def _call(
        self,
        method: str,
        payload: dict[str, Any] | None = None,
        files: dict[str, Any] | None = None,
    ) -> Any:
        if not self._token:
            raise TelegramError("TELEGRAM_BOT_TOKEN belum diatur.")
        url = f"{_API_BASE}/bot{self._token}/{method}"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as http:
                if files is not None:
                    response = await http.post(url, data=payload or {}, files=files)
                else:
                    response = await http.post(url, json=payload or {})
        except httpx.HTTPError as exc:  # network / timeout
            raise TelegramError(f"Gagal menghubungi Telegram: {exc}") from exc

        try:
            body = response.json()
        except ValueError as exc:
            raise TelegramError(
                f"Respons Telegram tidak valid (HTTP {response.status_code}).",
                status_code=response.status_code,
            ) from exc

        if not isinstance(body, dict) or not body.get("ok"):
            description = ""
            if isinstance(body, dict):
                description = str(body.get("description") or "")
            raise TelegramError(
                description or f"Telegram menolak permintaan (HTTP {response.status_code}).",
                status_code=response.status_code,
            )
        return body.get("result")

    async def send_message(
        self,
        chat_id: str,
        text: str,
        *,
        reply_markup: dict[str, Any] | None = None,
        disable_preview: bool = True,
    ) -> list[dict[str, Any]]:
        """Send text, split into several messages when it exceeds the cap."""
        results: list[dict[str, Any]] = []
        chunks = split_message(text) or [""]
        for index, chunk in enumerate(chunks):
            payload: dict[str, Any] = {
                "chat_id": chat_id,
                "text": chunk,
                "parse_mode": "HTML",
                "disable_web_page_preview": disable_preview,
            }
            # Only the last chunk carries the keyboard.
            if reply_markup is not None and index == len(chunks) - 1:
                payload["reply_markup"] = reply_markup
            results.append(await self._call("sendMessage", payload))
        return results

    async def send_photo(
        self,
        chat_id: str,
        photo: bytes,
        *,
        caption: str = "",
        reply_markup: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "chat_id": chat_id,
            "caption": caption[:1024],
            "parse_mode": "HTML",
        }
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup
        return await self._call(
            "sendPhoto", payload, files={"photo": ("axtra.png", photo, "image/png")}
        )

    async def send_document(
        self,
        chat_id: str,
        document: bytes,
        filename: str,
        *,
        caption: str = "",
    ) -> dict[str, Any]:
        return await self._call(
            "sendDocument",
            {"chat_id": chat_id, "caption": caption[:1024], "parse_mode": "HTML"},
            files={"document": (filename, document, "text/plain")},
        )

    async def send_chat_action(self, chat_id: str, action: str = "typing") -> None:
        try:
            await self._call("sendChatAction", {"chat_id": chat_id, "action": action})
        except TelegramError:
            # Cosmetic; never block a reply on it.
            pass

    async def edit_message_text(
        self,
        chat_id: str,
        message_id: int,
        text: str,
        *,
        reply_markup: dict[str, Any] | None = None,
    ) -> None:
        payload: dict[str, Any] = {
            "chat_id": chat_id,
            "message_id": message_id,
            "text": text[:_MAX_MESSAGE_CHARS - 32],
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup
        await self._call("editMessageText", payload)

    async def answer_callback_query(self, callback_id: str, text: str = "") -> None:
        try:
            await self._call(
                "answerCallbackQuery",
                {"callback_query_id": callback_id, "text": text[:200]},
            )
        except TelegramError:
            pass

    async def get_updates(
        self, *, offset: int | None = None, timeout: int = 25
    ) -> list[dict[str, Any]]:
        payload: dict[str, Any] = {"timeout": timeout, "allowed_updates": ["message", "callback_query"]}
        if offset is not None:
            payload["offset"] = offset
        result = await self._call("getUpdates", payload)
        return result if isinstance(result, list) else []

    async def set_webhook(self, url: str, secret: str = "") -> Any:
        payload: dict[str, Any] = {
            "url": url,
            "allowed_updates": ["message", "callback_query"],
        }
        if secret:
            payload["secret_token"] = secret
        return await self._call("setWebhook", payload)

    async def delete_webhook(self) -> Any:
        return await self._call("deleteWebhook", {"drop_pending_updates": False})
