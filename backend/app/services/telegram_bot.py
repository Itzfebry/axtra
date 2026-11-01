"""Telegram bot command handling for the single-owner Axtra instance.

Inbound updates arrive from either the webhook (production) or the polling
script (local dev); both call :class:`TelegramBot.handle_update`.
"""

from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any, Awaitable, Callable

from supabase import AsyncClient

from app.config import Settings
from app.llm import LLMProviderError
from app.memory_service_provider import build_memory_extractor, build_memory_service
from app.schemas import GoalCreate, JournalEntryCreate
from app.services.chat_service import ChatService
from app.services.crawl_provider import crawl, firecrawl_ready, resolve_user_provider
from app.services.crawlers import firecrawl
from app.services.digest_service import build_daily_report
from app.services.image_service import (
    ImageGenerationError,
    generate_image,
    load_image_preference,
)
from app.services.journal_service import JournalService, today_wib
from app.services.llm_router import resolve_active_llm
from app.services.telegram_client import (
    TelegramClient,
    TelegramError,
    escape_html,
    markdown_to_telegram_html,
)
from app.services.telegram_store import (
    ensure_conversation,
    ensure_link,
    get_link,
    is_allowed,
)
from app.services.usage_service import get_usage
from app.services.web_crawler import CrawlError

logger = logging.getLogger("axtra.telegram")

_URL_RE = re.compile(r"^https?://", re.IGNORECASE)

HELP_TEXT = """<b>Axtra di Telegram</b>

<b>Chat & ingatan</b>
/chat &lt;teks&gt; — ngobrol dengan Axtra (atau kirim teks biasa)
/ingat &lt;fakta&gt; — simpan memori
/memori &lt;kata kunci&gt; — cari memori

<b>Riset & gambar</b>
/riset &lt;url|kata kunci&gt; — crawl halaman atau cari web
/gambar &lt;prompt&gt; — buat gambar

<b>Produktivitas</b>
/jurnal [catatan] — catat atau lihat jurnal hari ini
/target [judul] — lihat atau buat target
/selesai &lt;nomor&gt; — tandai target selesai
/jobs [status] — daftar lamaran kerja

<b>Lainnya</b>
/laporan — laporan harian sekarang
/pemakaian — token terpakai hari ini
/pengaturan — status integrasi
/help — bantuan ini"""

Handler = Callable[[str, dict[str, Any], str], Awaitable[None]]


class TelegramBot:
    def __init__(
        self, settings: Settings, client: AsyncClient, telegram: TelegramClient
    ) -> None:
        self.settings = settings
        self.client = client
        self.telegram = telegram
        self.user_id = settings.owner_user_id

    # ------------------------------------------------------------------
    # Entrypoints
    # ------------------------------------------------------------------
    async def handle_update(self, update: dict[str, Any]) -> bool:
        if "callback_query" in update:
            return await self._handle_callback(update["callback_query"])
        message = update.get("message")
        if not isinstance(message, dict):
            return False
        chat = message.get("chat") or {}
        chat_id = str(chat.get("id") or "")
        if not chat_id:
            return False

        link = await get_link(self.client, chat_id)
        if not is_allowed(self.settings, chat_id, link):
            await self._send(
                chat_id,
                "Akses ditolak. Tambahkan chat id ini ke "
                "<code>TELEGRAM_ALLOWED_CHAT_IDS</code> di server.",
            )
            return False
        if link is None:
            link = await ensure_link(
                self.client,
                user_id=self.user_id,
                chat_id=chat_id,
                username=str(chat.get("username") or ""),
                first_name=str(chat.get("first_name") or ""),
                default_mode=self.settings.telegram_default_mode,
                settings=self.settings,
            )
            if link is None:
                await self._send(chat_id, "Gagal menautkan chat. Coba lagi nanti.")
                return False

        text = str(message.get("text") or "").strip()
        if not text:
            await self._send(chat_id, "Saat ini hanya pesan teks yang didukung.")
            return True

        try:
            await self._dispatch(chat_id, link, text)
        except TelegramError as exc:
            logger.warning("Telegram send error: %s", exc)
        except Exception as exc:  # noqa: BLE001 - never leak internals to chat
            logger.exception("Telegram handler failed: %s", exc)
            await self._send(
                chat_id, "Terjadi kesalahan saat memproses permintaan. Coba lagi."
            )
        return True

    async def _dispatch(self, chat_id: str, link: dict[str, Any], text: str) -> None:
        if not text.startswith("/"):
            await self._cmd_chat(chat_id, link, text)
            return

        command, _, args = text.partition(" ")
        command = command.split("@", 1)[0].lower()
        args = args.strip()

        handlers: dict[str, Handler] = {
            "/start": self._cmd_help,
            "/help": self._cmd_help,
            "/menu": self._cmd_help,
            "/chat": self._cmd_chat,
            "/ingat": self._cmd_remember,
            "/memori": self._cmd_memories,
            "/gambar": self._cmd_image,
            "/riset": self._cmd_research,
            "/jobs": self._cmd_jobs,
            "/jurnal": self._cmd_journal,
            "/target": self._cmd_goals,
            "/selesai": self._cmd_complete_goal,
            "/laporan": self._cmd_report,
            "/pemakaian": self._cmd_usage,
            "/pengaturan": self._cmd_settings,
        }
        handler = handlers.get(command)
        if handler is None:
            await self._send(
                chat_id, "Perintah tidak dikenal. Kirim /help untuk daftar perintah."
            )
            return
        await handler(chat_id, link, args)

    # ------------------------------------------------------------------
    # Commands
    # ------------------------------------------------------------------
    async def _cmd_help(self, chat_id: str, link: dict[str, Any], args: str) -> None:
        await self._send(chat_id, HELP_TEXT, disable_preview=True)

    async def _cmd_chat(self, chat_id: str, link: dict[str, Any], args: str) -> None:
        if not args:
            await self._send(chat_id, "Tulis pesan setelah /chat, atau kirim teks biasa.")
            return
        await self.telegram.send_chat_action(chat_id, "typing")
        try:
            llm, model = await resolve_active_llm(self.settings, self.client, self.user_id)
        except LLMProviderError as exc:
            await self._send(chat_id, f"Provider LLM belum siap: {escape_html(str(exc))}")
            return

        service = ChatService(
            settings=self.settings,
            llm=llm,
            memory_service_factory=build_memory_service,
            extractor=build_memory_extractor(llm),
        )
        conversation_id = await ensure_conversation(
            self.client, user_id=self.user_id, link=link
        )
        mode = str(link.get("default_mode") or self.settings.telegram_default_mode)

        content = ""
        error = ""
        try:
            async for event in service.stream_response(
                client=self.client,
                user_id=self.user_id,
                conversation_id=conversation_id,
                user_message=args,
                model=model,
                use_memory=True,
                mode=mode,
            ):
                if event["event"] == "done":
                    content = str(json.loads(event["data"]).get("content") or "")
                elif event["event"] == "error":
                    error = str(json.loads(event["data"]).get("detail") or "")
        except Exception as exc:  # noqa: BLE001 - surface a safe message
            logger.warning("Telegram chat failed: %s", exc)
            error = str(exc)

        if error and not content:
            await self._send(chat_id, f"Gagal menjawab: {escape_html(error)}")
            return
        if not content.strip():
            content = "(jawaban kosong)"
        await self._send(chat_id, markdown_to_telegram_html(content))

    async def _cmd_remember(self, chat_id: str, link: dict[str, Any], args: str) -> None:
        if not args:
            await self._send(chat_id, "Format: /ingat <fakta yang ingin diingat>")
            return
        service = build_memory_service(self.client)
        memory = await service.create(
            self.user_id,
            type_="semantic",
            content=args,
            source="telegram",
            source_ref={"chat_id": chat_id},
        )
        await self._send(chat_id, f"Memori tersimpan: <i>{escape_html(memory.content[:400])}</i>")

    async def _cmd_memories(self, chat_id: str, link: dict[str, Any], args: str) -> None:
        service = build_memory_service(self.client)
        if args:
            results = await service.retrieve(self.user_id, args, limit=8)
        else:
            results = await service.list_memories(self.user_id, limit=8)
        if not results:
            await self._send(chat_id, "Tidak ada memori yang cocok.")
            return

        lines = ["<b>Memori</b>"]
        keyboard: list[list[dict[str, str]]] = []
        for item in results[:8]:
            lines.append(f"• [{escape_html(item.type)}] {escape_html(item.content[:300])}")
            keyboard.append(
                [
                    {
                        "text": f"Hapus: {item.content[:26]}",
                        "callback_data": f"mem:del:{item.id}",
                    }
                ]
            )
        await self._send(
            chat_id,
            "\n".join(lines),
            reply_markup={"inline_keyboard": keyboard},
        )

    async def _cmd_image(self, chat_id: str, link: dict[str, Any], args: str) -> None:
        if not args:
            await self._send(chat_id, "Format: /gambar <prompt>")
            return
        await self.telegram.send_chat_action(chat_id, "upload_photo")
        provider, model, style = await load_image_preference(self.client, self.user_id)
        try:
            result = await generate_image(
                self.settings,
                self.client,
                self.user_id,
                prompt=args,
                provider=provider,
                model=model,
                style=style,
                n=1,
            )
        except ImageGenerationError as exc:
            await self._send(chat_id, f"Gagal membuat gambar: {escape_html(str(exc))}")
            return
        images = result.get("images") or []
        if not images:
            await self._send(chat_id, "Provider tidak mengembalikan gambar.")
            return
        data_url = str(images[0].get("data_url") or "")
        try:
            raw = data_url.split(",", 1)[1] if "," in data_url else data_url
            data = base64.b64decode(raw)
        except (IndexError, ValueError):
            await self._send(chat_id, "Gambar tidak bisa dibaca.")
            return
        await self.telegram.send_photo(
            chat_id,
            data,
            caption=f"<b>{escape_html(args[:200])}</b>\n{escape_html(result.get('model') or '')}",
        )

    async def _cmd_research(self, chat_id: str, link: dict[str, Any], args: str) -> None:
        if not args:
            await self._send(chat_id, "Format: /riset <url atau kata kunci>")
            return
        await self.telegram.send_chat_action(chat_id, "typing")
        if _URL_RE.match(args):
            provider = await resolve_user_provider(self.client, self.user_id, self.settings)
            try:
                outcome = await crawl(
                    args,
                    settings=self.settings,
                    client=self.client,
                    user_id=self.user_id,
                    provider=provider,
                )
            except CrawlError as exc:
                await self._send(chat_id, f"Gagal crawl: {escape_html(str(exc))}")
                return
            page = outcome.page
            body = (page.text or "").strip()
            if len(body) > 3000:
                body = body[:3000].rstrip() + "…"
            note = f"\n<i>{escape_html(outcome.notice)}</i>" if outcome.notice else ""
            await self._send(
                chat_id,
                f"<b>{escape_html(page.title or page.url)}</b>\n"
                f"<a href=\"{escape_html(page.url)}\">{escape_html(page.url)}</a>\n\n"
                f"{escape_html(body)}{note}",
            )
            return

        if not firecrawl_ready(self.settings):
            await self._send(
                chat_id,
                "Pencarian web butuh Firecrawl. Kirim URL langsung untuk crawl, "
                "atau isi <code>FIRECRAWL_API_KEY</code>.",
            )
            return
        try:
            result = await firecrawl.search(
                args, settings=self.settings, limit=self.settings.research_search_limit
            )
        except Exception as exc:  # noqa: BLE001
            await self._send(chat_id, f"Pencarian gagal: {escape_html(str(exc))}")
            return
        if not result.pages:
            await self._send(chat_id, "Tidak ada hasil.")
            return
        lines = [f"<b>Hasil: {escape_html(args)}</b>"]
        for page in result.pages[:5]:
            snippet = " ".join((page.text or "").split())[:300]
            lines.append(
                f"\n<a href=\"{escape_html(page.url)}\">{escape_html(page.title or page.url)}</a>\n"
                f"{escape_html(snippet)}"
            )
        await self._send(chat_id, "\n".join(lines))

    async def _cmd_jobs(self, chat_id: str, link: dict[str, Any], args: str) -> None:
        query = (
            self.client.table("job_applications")
            .select("id,company,role,status,deadline")
            .eq("user_id", self.user_id)
            .order("updated_at", desc=True)
            .limit(20)
        )
        if args:
            query = query.eq("status", args.lower())
        response = await query.execute()
        rows = response.data or []
        if not rows:
            await self._send(chat_id, "Belum ada lamaran tersimpan.")
            return
        lines = ["<b>Lamaran kerja</b>"]
        for row in rows:
            deadline = f" · {escape_html(str(row.get('deadline')))}" if row.get("deadline") else ""
            lines.append(
                f"• <b>{escape_html(str(row.get('company') or '?'))}</b> — "
                f"{escape_html(str(row.get('role') or '?'))} "
                f"[{escape_html(str(row.get('status') or '?'))}]{deadline}"
            )
        await self._send(chat_id, "\n".join(lines))

    async def _cmd_journal(self, chat_id: str, link: dict[str, Any], args: str) -> None:
        journal = JournalService(self.client)
        if args:
            entry = await journal.create_entry(
                self.user_id,
                JournalEntryCreate(content=args),
                source="telegram",
                source_ref={"chat_id": chat_id},
            )
            await self._send(
                chat_id,
                f"Jurnal {entry.entry_date.isoformat()} tersimpan:\n"
                f"<i>{escape_html(entry.content[:800])}</i>",
            )
            return
        entries = await journal.list_entries(self.user_id, day=today_wib(), limit=20)
        if not entries:
            await self._send(
                chat_id, "Belum ada jurnal hari ini. Catat dengan /jurnal <teks>."
            )
            return
        lines = [f"<b>Jurnal {today_wib().isoformat()}</b>"]
        for entry in entries:
            lines.append(f"• {escape_html(entry.content[:500])}")
        await self._send(chat_id, "\n".join(lines))

    async def _cmd_goals(self, chat_id: str, link: dict[str, Any], args: str) -> None:
        journal = JournalService(self.client)
        if args:
            goal = await journal.create_goal(
                self.user_id,
                GoalCreate(title=args[:200]),
                source="telegram",
                source_ref={"chat_id": chat_id},
            )
            await self._send(chat_id, f"Target dibuat: <b>{escape_html(goal.title)}</b>")
            return
        goals = await journal.list_goals(self.user_id, status="active", limit=20)
        if not goals:
            await self._send(chat_id, "Belum ada target aktif. Buat dengan /target <judul>.")
            return
        lines = ["<b>Target aktif</b>"]
        keyboard: list[list[dict[str, str]]] = []
        for index, goal in enumerate(goals, start=1):
            lines.append(f"{index}. {escape_html(goal.title)} ({goal.progress}%)")
            keyboard.append(
                [
                    {
                        "text": f"Selesai: {goal.title[:24]}",
                        "callback_data": f"goal:done:{goal.id}",
                    }
                ]
            )
        await self._send(
            chat_id,
            "\n".join(lines),
            reply_markup={"inline_keyboard": keyboard},
        )

    async def _cmd_complete_goal(
        self, chat_id: str, link: dict[str, Any], args: str
    ) -> None:
        journal = JournalService(self.client)
        goals = await journal.list_goals(self.user_id, status="active", limit=20)
        if not args.isdigit():
            await self._send(chat_id, "Format: /selesai <nomor target>")
            return
        index = int(args)
        if index < 1 or index > len(goals):
            await self._send(chat_id, "Nomor target tidak valid.")
            return
        goal = goals[index - 1]
        from app.schemas import GoalUpdate

        updated = await journal.update_goal(
            self.user_id, goal.id, GoalUpdate(status="done")
        )
        await self._send(chat_id, f"Target selesai: <b>{escape_html(updated.title)}</b>")

    async def _cmd_report(self, chat_id: str, link: dict[str, Any], args: str) -> None:
        report = await build_daily_report(self.settings, self.client, self.user_id)
        await self._send(chat_id, report)

    async def _cmd_usage(self, chat_id: str, link: dict[str, Any], args: str) -> None:
        usage = await get_usage(self.client)
        await self._send(
            chat_id,
            (
                f"<b>Pemakaian token</b>\n"
                f"Hari ini: <b>{usage.day_tokens:,}</b>\n"
                f"Menit terakhir: <b>{usage.minute_tokens:,}</b>"
            ).replace(",", "."),
        )

    async def _cmd_settings(self, chat_id: str, link: dict[str, Any], args: str) -> None:
        mode = str(link.get("default_mode") or "general")
        await self._send(
            chat_id,
            "<b>Integrasi Telegram</b>\n"
            f"Chat id: <code>{escape_html(chat_id)}</code>\n"
            f"Mode chat: <b>{escape_html(mode)}</b>\n"
            f"Laporan harian: {'aktif' if link.get('daily_report') else 'nonaktif'}\n"
            f"Laporan mingguan: {'aktif' if link.get('weekly_report') else 'nonaktif'}\n"
            f"Jam laporan: {link.get('report_hour')}:00 WIB\n"
            f"Jam tenang: {link.get('quiet_start')}:00–{link.get('quiet_end')}:00 WIB\n\n"
            "Ubah lewat API <code>PATCH /api/telegram/settings</code>.",
        )

    # ------------------------------------------------------------------
    # Callback queries (inline keyboards)
    # ------------------------------------------------------------------
    async def _handle_callback(self, callback: dict[str, Any]) -> bool:
        callback_id = str(callback.get("id") or "")
        message = callback.get("message") or {}
        chat = message.get("chat") or {}
        chat_id = str(chat.get("id") or "")
        data = str(callback.get("data") or "")
        if not chat_id:
            return False
        link = await get_link(self.client, chat_id)
        if not is_allowed(self.settings, chat_id, link):
            await self.telegram.answer_callback_query(callback_id, "Akses ditolak.")
            return False

        try:
            if data.startswith("goal:done:"):
                goal_id = data.split(":", 2)[2]
                from app.schemas import GoalUpdate

                await JournalService(self.client).update_goal(
                    self.user_id, goal_id, GoalUpdate(status="done")
                )
                await self.telegram.answer_callback_query(callback_id, "Target selesai.")
                await self._send(chat_id, "Target ditandai selesai.")
            elif data.startswith("mem:del:"):
                memory_id = data.split(":", 2)[2]
                await build_memory_service(self.client).delete(self.user_id, memory_id)
                await self.telegram.answer_callback_query(callback_id, "Memori dihapus.")
                await self._send(chat_id, "Memori dihapus.")
            else:
                await self.telegram.answer_callback_query(callback_id, "Aksi tidak dikenal.")
        except Exception as exc:  # noqa: BLE001
            logger.warning("Telegram callback failed: %s", exc)
            await self.telegram.answer_callback_query(callback_id, "Gagal memproses.")
        return True

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    async def _send(
        self,
        chat_id: str,
        text: str,
        *,
        reply_markup: dict[str, Any] | None = None,
        disable_preview: bool = True,
    ) -> None:
        try:
            await self.telegram.send_message(
                chat_id,
                text,
                reply_markup=reply_markup,
                disable_preview=disable_preview,
            )
        except TelegramError as exc:
            logger.warning("Could not send Telegram message: %s", exc)