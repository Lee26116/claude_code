import asyncio
import logging
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    filters,
)
from config import settings
from telegram_bot.handlers import (
    start_handler,
    help_handler,
    pwd_handler,
    cd_handler,
    projects_handler,
    status_handler,
    cancel_handler,
    auth_handler,
    message_handler,
    photo_handler,
    document_handler,
)

logger = logging.getLogger(__name__)


async def start_telegram_bot():
    """Start the Telegram bot as a background task within the FastAPI event loop."""
    token = settings.TELEGRAM_BOT_TOKEN
    if not token:
        logger.warning("TELEGRAM_BOT_TOKEN not set, Telegram bot disabled")
        return

    logger.info("Starting Telegram bot...")

    app = Application.builder().token(token).build()

    # Register command handlers
    app.add_handler(CommandHandler("start", start_handler))
    app.add_handler(CommandHandler("help", help_handler))
    app.add_handler(CommandHandler("pwd", pwd_handler))
    app.add_handler(CommandHandler("cd", cd_handler))
    app.add_handler(CommandHandler("projects", projects_handler))
    app.add_handler(CommandHandler("status", status_handler))
    app.add_handler(CommandHandler("cancel", cancel_handler))
    app.add_handler(CommandHandler("auth", auth_handler))
    app.add_handler(CommandHandler("login", auth_handler))

    # Register message handlers
    app.add_handler(MessageHandler(filters.PHOTO, photo_handler))
    app.add_handler(MessageHandler(filters.Document.ALL, document_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, message_handler))

    # Initialize and start polling
    await app.initialize()
    await app.start()
    await app.updater.start_polling(drop_pending_updates=True)

    logger.info("Telegram bot started successfully")

    # Keep running until cancelled
    try:
        while True:
            await asyncio.sleep(1)
    except asyncio.CancelledError:
        logger.info("Stopping Telegram bot...")
        await app.updater.stop()
        await app.stop()
        await app.shutdown()
        logger.info("Telegram bot stopped")
