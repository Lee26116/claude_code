import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import settings
from database import init_db
from auth.router import router as auth_router
from sessions.router import router as sessions_router
from files.router import router as files_router
from sessions.brain_router import router as brain_router
from terminal.router import router as terminal_router
from projects.router import router as projects_router
from presets.router import router as presets_router
from scheduler.router import router as scheduler_router
from scheduler.router import init_scheduler_db
from monitor.router import router as monitor_router
from monitor.router import init_monitor_db
from search.router import router as search_router
from pty_terminal.router import router as pty_router
from bookmarks.router import router as bookmarks_router
from bookmarks.router import init_bookmarks_db
from secrets_vault.router import router as secrets_router
from secrets_vault.router import init_secrets_db, sync_secrets_to_env
from sessions.brain import ensure_brain_dirs
from telegram_bot.bot import start_telegram_bot

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await init_scheduler_db()
    await init_monitor_db()
    await init_bookmarks_db()
    await init_secrets_db()
    await sync_secrets_to_env()
    ensure_brain_dirs()

    # Start Telegram bot as background task
    bot_task = asyncio.create_task(start_telegram_bot())
    yield
    bot_task.cancel()
    try:
        await bot_task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Claude Code Dashboard", version="1.0.0", lifespan=lifespan)

# CORS
origins = settings.ALLOWED_ORIGINS.split(",") if settings.ALLOWED_ORIGINS != "*" else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth_router)
app.include_router(sessions_router)
app.include_router(files_router)
app.include_router(brain_router)
app.include_router(terminal_router)
app.include_router(projects_router)
app.include_router(presets_router)
app.include_router(scheduler_router)
app.include_router(monitor_router)
app.include_router(search_router)
app.include_router(pty_router)
app.include_router(bookmarks_router)
app.include_router(secrets_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
