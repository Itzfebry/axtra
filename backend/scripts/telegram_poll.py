"""Local development Telegram long-polling bridge.

Production uses the webhook (``POST /api/telegram/webhook``). Locally there is no
public HTTPS URL, so this script polls ``getUpdates`` and feeds the same
:class:`TelegramBot` dispatcher.

Usage (from the backend directory):
    .venv\\Scripts\\python scripts\\telegram_poll.py

Telegram refuses getUpdates while a webhook is set, so pass ``--drop-webhook``
once (or delete it from the bot dashboard) before polling.
"""

from __future__ import annotations

import argparse
import asyncio
import logging

from app.config import get_settings
from app.services.telegram_bot import TelegramBot
from app.services.telegram_client import TelegramClient, TelegramError
from app.services.telegram_store import purge_updates, seen_update
from app.supabase_client import get_owner_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("axtra.telegram.poll")


async def main() -> None:
    parser = argparse.ArgumentParser(description="Poll Telegram updates locally")
    parser.add_argument(
        "--drop-webhook",
        action="store_true",
        help="Delete the bot webhook before polling (required if one is set).",
    )
    parser.add_argument("--timeout", type=int, default=25)
    args = parser.parse_args()

    settings = get_settings()
    if not settings.telegram_bot_token:
        raise SystemExit("TELEGRAM_BOT_TOKEN belum diatur.")
    if not settings.telegram_enabled:
        logger.warning("TELEGRAM_ENABLED=false; pesan akan ditolak.")

    telegram = TelegramClient(settings.telegram_bot_token)
    if args.drop_webhook:
        await telegram.delete_webhook()
        logger.info("Webhook dihapus.")

    client = await get_owner_client()
    bot = TelegramBot(settings, client, telegram)
    await purge_updates(client, days=7)

    offset: int | None = None
    logger.info("Mulai polling. Ctrl+C untuk berhenti.")
    while True:
        try:
            updates = await telegram.get_updates(offset=offset, timeout=args.timeout)
        except TelegramError as exc:
            logger.warning("getUpdates gagal: %s", exc)
            await asyncio.sleep(3)
            continue

        for update in updates:
            update_id = update.get("update_id")
            if isinstance(update_id, int):
                offset = update_id + 1
            if await seen_update(client, update_id):
                continue
            try:
                handled = await bot.handle_update(update)
                logger.info("Update %s handled=%s", update_id, handled)
            except Exception as exc:  # noqa: BLE001 - keep polling
                logger.exception("Gagal memproses update %s: %s", update_id, exc)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Berhenti.")