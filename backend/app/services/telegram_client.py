"""Thin async client for the Telegram Bot API.

Only the endpoints Axtra needs are wrapped. Messages use ``parse_mode=HTML``
(only ``&``, ``<``, ``>`` need escaping) because MarkdownV2's escaping rules are
error-prone for dynamic content. Long text is split to Telegram's 4096-char cap.

LLM answers arrive as Markdown, which Telegram does not render, so
:func:`markdown_to_telegram_html` converts the common subset (bold, italic,
strikethrough, links, headings, lists, quotes, code) into the HTML tags Telegram
understands.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx

logger = logging.getLogger("axtra.telegram")

_API_BASE = "https://api.telegram.org"
_MAX_MESSAGE_CHARS = 4096
# Headroom below the hard cap so a trailing entity/chunk stays valid.
_SPLIT_CHARS = 3800

_HTML_TAG_RE = re.compile(r"<(/?)([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^>]*)?>")
_FENCE_RE = re.compile(r"```([^\n`]*)\n(.*?)```", re.DOTALL)
_FENCE_INLINE_RE = re.compile(r"```([^\n`]*)```")
_INLINE_CODE_RE = re.compile(r"`([^`\n]+)`")
_HEADING_RE = re.compile(r"^#{1,6}[ \t]+(.+?)[ \t]*$")
_HR_RE = re.compile(r"^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$")
_ULIST_RE = re.compile(r"^([ \t]*)[-*+][ \t]+(.+)$")
_OLIST_RE = re.compile(r"^([ \t]*)(\d+)\.[ \t]+(.+)$")
_QUOTE_RE = re.compile(r"^&gt;[ \t]?(.*)$")
_LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")
_BOLD_RE = re.compile(r"\*\*(.+?)\*\*", re.DOTALL)
_BOLD_US_RE = re.compile(r"(?<!\w)__(.+?)__(?!\w)", re.DOTALL)
_STRIKE_RE = re.compile(r"~~(.+?)~~", re.DOTALL)
_ITALIC_STAR_RE = re.compile(r"(?<!\*)\*(?!\s)(.+?)(?<![\s*])\*(?!\*)", re.DOTALL)
_ITALIC_US_RE = re.compile(
    r"(?<![_\w])_(?!\s)(.+?)(?<![\s_])_(?![_\w])", re.DOTALL
)


class TelegramError(RuntimeError):
    """Raised when the Bot API returns ``ok: false`` or the request fails."""

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


def escape_html(text: str) -> str:
    """Escape the three characters Telegram's HTML parser treats as markup."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def markdown_to_telegram_html(markdown_text: str) -> str:
    """Convert common Markdown into the HTML subset Telegram renders.

    Telegram ignores Markdown syntax, so raw ``**bold**`` and headings would be
    shown literally. Code spans/blocks are protected first, the remaining text
    is HTML-escaped, and only then are tags inserted, so model output can never
    inject markup.
    """
    text = markdown_text.replace("\r\n", "\n").replace("\r", "\n")
    placeholders: dict[str, str] = {}

    def stash(html: str) -> str:
        key = f"\x00{len(placeholders)}\x00"
        placeholders[key] = html
        return key

    def fence_repl(match: re.Match[str]) -> str:
        lang = (match.group(1) or "").strip()
        code = escape_html(match.group(2).rstrip("\n"))
        if lang and re.fullmatch(r"[A-Za-z0-9+#.\-]+", lang):
            return stash(f'<pre><code class="language-{lang}">{code}</code></pre>')
        return stash(f"<pre>{code}</pre>")

    text = _FENCE_RE.sub(fence_repl, text)
    text = _FENCE_INLINE_RE.sub(
        lambda m: stash(f"<code>{escape_html(m.group(1))}</code>"), text
    )
    text = _INLINE_CODE_RE.sub(
        lambda m: stash(f"<code>{escape_html(m.group(1))}</code>"), text
    )

    # Escape before inserting any tag so raw model HTML is neutralised.
    text = escape_html(text)

    lines: list[str] = []
    quote_buffer: list[str] = []

    def flush_quote() -> None:
        if quote_buffer:
            lines.append("<blockquote>" + "\n".join(quote_buffer) + "</blockquote>")
            quote_buffer.clear()

    for line in text.split("\n"):
        quote = _QUOTE_RE.match(line)
        if quote:
            quote_buffer.append(quote.group(1))
            continue
        flush_quote()
        heading = _HEADING_RE.match(line)
        if heading:
            lines.append(f"<b>{heading.group(1)}</b>")
            continue
        if _HR_RE.match(line):
            lines.append("──────────")
            continue
        ulist = _ULIST_RE.match(line)
        if ulist:
            lines.append(f"{ulist.group(1)}• {ulist.group(2)}")
            continue
        olist = _OLIST_RE.match(line)
        if olist:
            lines.append(f"{olist.group(1)}{olist.group(2)}. {olist.group(3)}")
            continue
        lines.append(line)
    flush_quote()
    text = "\n".join(lines)

    text = _LINK_RE.sub(lambda m: f'<a href="{m.group(2)}">{m.group(1)}</a>', text)
    text = _BOLD_RE.sub(r"<b>\1</b>", text)
    text = _BOLD_US_RE.sub(r"<b>\1</b>", text)
    text = _STRIKE_RE.sub(r"<s>\1</s>", text)
    text = _ITALIC_STAR_RE.sub(r"<i>\1</i>", text)
    text = _ITALIC_US_RE.sub(r"<i>\1</i>", text)

    for key, html in placeholders.items():
        text = text.replace(key, html)
    return text


def _safe_cut(text: str, limit: int) -> int:
    """Pick a hard-cut point that does not fall inside an HTML tag."""
    lt = text.rfind("<", 0, limit)
    gt = text.rfind(">", 0, limit)
    if lt > gt:  # an opening '<' has no closing '>' before the limit
        return gt + 1 if gt >= 0 else limit
    return limit


def _split_raw(text: str, limit: int) -> list[str]:
    chunks: list[str] = []
    remaining = text
    while len(remaining) > limit:
        cut = remaining.rfind("\n", 0, limit)
        if cut <= 0:
            cut = _safe_cut(remaining, limit)
        chunks.append(remaining[:cut].rstrip())
        remaining = remaining[cut:].lstrip("\n")
    if remaining:
        chunks.append(remaining)
    return chunks


def _balance_html(chunks: list[str]) -> list[str]:
    """Close open HTML tags at each chunk boundary and reopen them next chunk."""
    result: list[str] = []
    carry: list[str] = []
    for chunk in chunks:
        content = "".join(carry) + chunk
        stack: list[tuple[str, str]] = []
        for match in _HTML_TAG_RE.finditer(content):
            closing = match.group(1) == "/"
            name = match.group(2).lower()
            full = match.group(0)
            if closing:
                for index in range(len(stack) - 1, -1, -1):
                    if stack[index][0] == name:
                        del stack[index]
                        break
            else:
                stack.append((name, full))
        if stack:
            content += "".join(f"</{name}>" for name, _ in reversed(stack))
        result.append(content)
        carry = [full for _, full in stack]
    return result


def split_message(text: str, limit: int = _SPLIT_CHARS) -> list[str]:
    """Split long text on newlines for Telegram, keeping HTML tags balanced."""
    if len(text) <= limit:
        return [text]
    return _balance_html(_split_raw(text, limit))


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
