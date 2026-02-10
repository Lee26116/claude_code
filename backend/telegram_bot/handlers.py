import asyncio
import os
import re as re_module
import json
import shutil
import logging
from telegram import Update
from telegram.ext import ContextTypes
from telegram.constants import ParseMode, ChatAction

from chat.claude_code import call_claude_code
from sessions.brain import build_context_prompt
from telegram_bot.security import is_authorized
from telegram_bot.formatters import format_for_telegram, split_message
from config import settings

logger = logging.getLogger(__name__)

# Per-user state
_user_work_dirs: dict[int, str] = {}
_active_tasks: dict[int, asyncio.Task] = {}
_user_new_session: dict[int, bool] = {}  # True = next message starts fresh (no --continue)

# Global auth process — must stay alive for OAuth callback
_auth_process: asyncio.subprocess.Process | None = None
_auth_wait_task: asyncio.Task | None = None


# --------------- Claude Code Auth Helpers ---------------

def _extract_urls(text: str) -> list[str]:
    """Extract URLs from text (for capturing OAuth links)."""
    return re_module.findall(r'https?://[^\s<>"\')\]]+', text)


def _is_auth_error(text: str) -> bool:
    """Check if text indicates an authentication error."""
    lower = text.lower()
    auth_patterns = [
        "not logged in",
        "please run /login",
        "unauthorized",
        "token expired",
        "authentication required",
        "auth",
        "login required",
        "401",
        "403",
        "credential",
        "not authenticated",
    ]
    return any(p in lower for p in auth_patterns)


async def _check_claude_auth() -> dict:
    """
    Quick check if Claude Code CLI is authenticated.
    Returns {"ok": True/False, "detail": str}
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            "claude", "-p", "hi", "--output-format", "json",
            "--max-turns", "1", "--dangerously-skip-permissions",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)

        if proc.returncode == 0:
            return {"ok": True, "detail": "Authenticated and working."}

        combined = stdout.decode("utf-8", errors="replace") + "\n" + stderr.decode("utf-8", errors="replace")
        return {"ok": False, "detail": combined.strip()[:500]}

    except asyncio.TimeoutError:
        return {"ok": False, "detail": "Timed out (30s). May be stuck on an auth prompt."}
    except FileNotFoundError:
        return {"ok": False, "detail": "Claude Code CLI not found. Is it installed?"}
    except Exception as e:
        return {"ok": False, "detail": f"Error: {str(e)}"}


async def _trigger_reauth(notify_chat_id: int = None, bot=None) -> dict:
    """
    Run 'claude auth login', capture the OAuth URL, and keep the process
    alive so the OAuth callback can complete.

    Returns {"auth_url": str|None, "output": str}
    """
    global _auth_process, _auth_wait_task

    # Kill any previous auth process
    if _auth_process and _auth_process.returncode is None:
        try:
            _auth_process.kill()
        except ProcessLookupError:
            pass

    env = os.environ.copy()
    # Prevent CLI from trying to open a browser
    env["BROWSER"] = "echo"
    env.pop("DISPLAY", None)

    try:
        proc = await asyncio.create_subprocess_exec(
            "claude", "auth", "login",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
    except FileNotFoundError:
        return {"auth_url": None, "output": "Claude Code CLI not found."}

    _auth_process = proc

    # Collect output and look for URL
    auth_url = None
    all_output = []
    url_found = asyncio.Event()

    async def _read_stream(stream):
        nonlocal auth_url
        try:
            while True:
                line = await stream.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace")
                all_output.append(text)
                logger.info(f"claude auth: {text.strip()}")
                if auth_url is None:
                    urls = _extract_urls(text)
                    if urls:
                        auth_url = urls[0]
                        url_found.set()
        except Exception:
            pass

    read_stdout = asyncio.create_task(_read_stream(proc.stdout))
    read_stderr = asyncio.create_task(_read_stream(proc.stderr))

    # Wait up to 15s for a URL to appear in output
    try:
        await asyncio.wait_for(url_found.wait(), timeout=15)
    except asyncio.TimeoutError:
        pass

    if auth_url:
        # URL found — keep process alive for up to 5 minutes for OAuth callback
        async def _wait_for_callback():
            try:
                await asyncio.wait_for(proc.wait(), timeout=300)
                await asyncio.gather(read_stdout, read_stderr, return_exceptions=True)
                if proc.returncode == 0:
                    logger.info("Claude OAuth completed successfully!")
                    if notify_chat_id and bot:
                        try:
                            await bot.send_message(
                                chat_id=notify_chat_id,
                                text="Login successful! You can send messages now.",
                            )
                        except Exception:
                            pass
                else:
                    logger.warning(f"claude auth login exited with code {proc.returncode}")
            except asyncio.TimeoutError:
                logger.warning("Auth process timed out after 5 minutes, killing.")
                try:
                    proc.kill()
                except ProcessLookupError:
                    pass

        _auth_wait_task = asyncio.create_task(_wait_for_callback())
        return {"auth_url": auth_url, "output": "".join(all_output).strip()}
    else:
        # No URL found, clean up
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        await asyncio.gather(read_stdout, read_stderr, return_exceptions=True)
        return {"auth_url": None, "output": "".join(all_output).strip() or "No auth URL found in CLI output."}


def _get_work_dir(user_id: int) -> str:
    return _user_work_dirs.get(user_id, settings.TELEGRAM_DEFAULT_WORK_DIR)


def _auth_check(user_id: int) -> bool:
    if not is_authorized(user_id):
        return False
    return True


async def _send_long_text(update: Update, text: str):
    """Send text, splitting if needed. Try MarkdownV2 first, fallback to plain text."""
    chunks = split_message(text)
    for chunk in chunks:
        try:
            formatted = format_for_telegram(chunk)
            await update.message.reply_text(formatted, parse_mode=ParseMode.MARKDOWN_V2)
        except Exception:
            # Fallback to plain text
            try:
                await update.message.reply_text(chunk)
            except Exception as e:
                logger.error(f"Failed to send message: {e}")


async def start_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /start command."""
    if not _auth_check(update.effective_user.id):
        await update.message.reply_text("Unauthorized.")
        return

    text = (
        "Claude Code Telegram Bot\n\n"
        "Send me any message, I'll forward it to Claude Code on your server.\n\n"
        "Commands:\n"
        "/new - Start a new conversation (clear context)\n"
        "/cd <path> - Switch working directory\n"
        "/pwd - Show current working directory\n"
        "/projects - List available projects\n"
        "/status - Server status\n"
        "/auth - Check/refresh Claude Code authentication\n"
        "/cancel - Cancel current task\n"
        "/help - Show this help"
    )
    await update.message.reply_text(text)


async def help_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /help command."""
    if not _auth_check(update.effective_user.id):
        await update.message.reply_text("Unauthorized.")
        return
    await start_handler(update, context)


async def pwd_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /pwd command."""
    if not _auth_check(update.effective_user.id):
        await update.message.reply_text("Unauthorized.")
        return

    work_dir = _get_work_dir(update.effective_user.id)
    await update.message.reply_text(f"Current directory: {work_dir}")


async def cd_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /cd <path> command."""
    if not _auth_check(update.effective_user.id):
        await update.message.reply_text("Unauthorized.")
        return

    if not context.args:
        await update.message.reply_text("Usage: /cd <path>")
        return

    new_path = " ".join(context.args)
    new_path = os.path.expanduser(new_path)

    # Resolve relative paths against current work dir
    if not os.path.isabs(new_path):
        new_path = os.path.join(_get_work_dir(update.effective_user.id), new_path)
    new_path = os.path.normpath(new_path)

    if not os.path.isdir(new_path):
        await update.message.reply_text(f"Directory not found: {new_path}")
        return

    _user_work_dirs[update.effective_user.id] = new_path
    await update.message.reply_text(f"Switched to: {new_path}")


async def projects_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /projects command."""
    if not _auth_check(update.effective_user.id):
        await update.message.reply_text("Unauthorized.")
        return

    projects_file = os.path.join(settings.CLAUDE_BRAIN_PATH, "projects.json")
    if not os.path.exists(projects_file):
        await update.message.reply_text("No projects configured.")
        return

    with open(projects_file, "r") as f:
        data = json.load(f)

    projects = data.get("projects", [])
    active = data.get("active")

    if not projects:
        await update.message.reply_text("No projects configured.")
        return

    lines = ["Projects:\n"]
    for p in projects:
        marker = " [active]" if p.get("name") == active else ""
        lines.append(f"  {p['name']}: {p['path']}{marker}")
    lines.append(f"\nUse /cd <path> to switch directory")
    await update.message.reply_text("\n".join(lines))


async def status_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /status command."""
    if not _auth_check(update.effective_user.id):
        await update.message.reply_text("Unauthorized.")
        return

    # Gather system info
    import platform
    try:
        load_avg = os.getloadavg()
        load_str = f"{load_avg[0]:.1f} / {load_avg[1]:.1f} / {load_avg[2]:.1f}"
    except OSError:
        load_str = "N/A"

    disk = shutil.disk_usage("/")
    disk_total = disk.total / (1024 ** 3)
    disk_used = disk.used / (1024 ** 3)
    disk_pct = (disk.used / disk.total) * 100

    # Check Claude Code availability
    claude_ok = shutil.which("claude") is not None

    user_id = update.effective_user.id
    work_dir = _get_work_dir(user_id)
    has_active = user_id in _active_tasks and not _active_tasks[user_id].done()

    text = (
        f"Server Status\n\n"
        f"OS: {platform.system()} {platform.release()}\n"
        f"Load: {load_str}\n"
        f"Disk: {disk_used:.1f}G / {disk_total:.1f}G ({disk_pct:.0f}%)\n"
        f"Claude CLI: {'Available' if claude_ok else 'Not found'}\n"
        f"Work dir: {work_dir}\n"
        f"Active task: {'Yes' if has_active else 'No'}"
    )
    await update.message.reply_text(text)


async def new_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /new command — start a fresh conversation (clear context)."""
    if not _auth_check(update.effective_user.id):
        await update.message.reply_text("Unauthorized.")
        return

    _user_new_session[update.effective_user.id] = True
    await update.message.reply_text("Context cleared. Next message starts a new conversation.")


async def cancel_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /cancel command."""
    if not _auth_check(update.effective_user.id):
        await update.message.reply_text("Unauthorized.")
        return

    user_id = update.effective_user.id
    task = _active_tasks.get(user_id)
    if task and not task.done():
        task.cancel()
        del _active_tasks[user_id]
        await update.message.reply_text("Task cancelled.")
    else:
        await update.message.reply_text("No active task to cancel.")


async def auth_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /auth or /login command — check auth and send OAuth link if needed."""
    if not _auth_check(update.effective_user.id):
        await update.message.reply_text("Unauthorized.")
        return

    await update.message.reply_text("Checking Claude Code authentication...")

    result = await _check_claude_auth()

    if result["ok"]:
        await update.message.reply_text("Claude Code is authenticated and working!")
        return

    # Not authenticated — trigger login and get URL
    await update.message.reply_text("Not authenticated. Getting login link...")

    chat_id = update.effective_chat.id
    reauth = await _trigger_reauth(notify_chat_id=chat_id, bot=context.bot)

    if reauth["auth_url"]:
        await update.message.reply_text(
            "Open this link in your browser to log in:\n\n"
            f"{reauth['auth_url']}\n\n"
            "After you log in, I'll notify you automatically."
        )
    else:
        msg = "Could not get a login link.\n\n"
        if reauth["output"]:
            msg += f"CLI output:\n{reauth['output'][:500]}"
        await update.message.reply_text(msg)


async def message_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle regular text messages - send to Claude Code."""
    user_id = update.effective_user.id
    if not _auth_check(user_id):
        await update.message.reply_text("Unauthorized.")
        return

    content = update.message.text or ""
    if not content.strip():
        return

    # Check if there's already an active task
    existing = _active_tasks.get(user_id)
    if existing and not existing.done():
        await update.message.reply_text("A task is already running. Use /cancel to stop it first.")
        return

    # Send processing indicator
    status_msg = await update.message.reply_text("Processing...")

    async def run_claude():
        try:
            await context.bot.send_chat_action(
                chat_id=update.effective_chat.id,
                action=ChatAction.TYPING
            )

            work_dir = _get_work_dir(user_id)

            # Determine if we should continue the previous conversation
            start_fresh = _user_new_session.pop(user_id, False)
            use_continue = not start_fresh

            full_prompt = build_context_prompt(content, is_first_message=start_fresh)

            # Collect the full output
            final_result = ""
            full_output_parts = []

            async for chunk_text, chunk_type in call_claude_code(full_prompt, working_dir=work_dir, continue_session=use_continue):
                if chunk_type == "result":
                    final_result = chunk_text
                elif chunk_type in ("text", "tool_use", "tool_result", "error"):
                    full_output_parts.append(chunk_text)

            # Use final_result if available, otherwise join all parts
            response = final_result if final_result else "\n".join(full_output_parts)

            if not response.strip():
                response = "(No output from Claude Code)"

            # Delete the "Processing..." message
            try:
                await status_msg.delete()
            except Exception:
                pass

            # Detect auth errors and auto-trigger login
            if _is_auth_error(response):
                await update.message.reply_text(
                    "Claude Code is not logged in. Getting login link..."
                )
                chat_id = update.effective_chat.id
                reauth = await _trigger_reauth(notify_chat_id=chat_id, bot=context.bot)

                if reauth["auth_url"]:
                    await update.message.reply_text(
                        "Open this link in your browser to log in:\n\n"
                        f"{reauth['auth_url']}\n\n"
                        "After you log in, resend your message."
                    )
                else:
                    await update.message.reply_text(
                        "Could not get login link. Run /auth to try again.\n\n"
                        f"CLI output:\n{reauth['output'][:300]}"
                    )
                return

            else:
                # Send the response
                await _send_long_text(update, response)

            # Check if Claude generated any files we should send
            await _check_and_send_files(update, response, work_dir)

        except asyncio.CancelledError:
            try:
                await status_msg.edit_text("Task cancelled.")
            except Exception:
                pass
        except FileNotFoundError as e:
            logger.error(f"Claude Code not found: {e}")
            try:
                error_msg = (
                    "Claude Code CLI not found.\n\n"
                    "Please install it:\n"
                    "npm install -g @anthropic-ai/claude-code\n\n"
                    "Or check that the working directory exists:\n"
                    f"{_get_work_dir(user_id)}"
                )
                await status_msg.edit_text(error_msg)
            except Exception:
                pass
        except Exception as e:
            logger.error(f"Claude Code error: {e}")
            try:
                await status_msg.edit_text(f"Error: {str(e)[:500]}")
            except Exception:
                pass
        finally:
            _active_tasks.pop(user_id, None)

    task = asyncio.create_task(run_claude())
    _active_tasks[user_id] = task


async def photo_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle photo messages - save and pass to Claude Code."""
    user_id = update.effective_user.id
    if not _auth_check(user_id):
        await update.message.reply_text("Unauthorized.")
        return

    # Get the highest resolution photo
    photo = update.message.photo[-1]
    file = await context.bot.get_file(photo.file_id)

    # Save to uploads dir
    upload_dir = settings.UPLOAD_PATH
    os.makedirs(upload_dir, exist_ok=True)
    file_path = os.path.join(upload_dir, f"tg_{photo.file_id}.jpg")
    await file.download_to_drive(file_path)

    caption = update.message.caption or "Please analyze this image."
    prompt = f"{caption}\n\n[Attached image: {file_path}]"

    # Reuse message handler logic
    update.message.text = prompt
    await message_handler(update, context)


async def document_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle document uploads - save and pass to Claude Code."""
    user_id = update.effective_user.id
    if not _auth_check(user_id):
        await update.message.reply_text("Unauthorized.")
        return

    doc = update.message.document
    file = await context.bot.get_file(doc.file_id)

    upload_dir = settings.UPLOAD_PATH
    os.makedirs(upload_dir, exist_ok=True)
    file_name = doc.file_name or f"tg_{doc.file_id}"
    file_path = os.path.join(upload_dir, file_name)
    await file.download_to_drive(file_path)

    caption = update.message.caption or f"I've uploaded a file: {file_name}. Please review it."
    prompt = f"{caption}\n\n[Attached file: {file_path}]"

    update.message.text = prompt
    await message_handler(update, context)


async def _check_and_send_files(update: Update, response: str, work_dir: str):
    """
    Check if the Claude Code response mentions created/modified files and send them.
    Looks for common patterns like 'Created file: ...', 'Wrote to ...', etc.
    """
    import re
    patterns = [
        r"(?:Created|Wrote to|Saved to|Generated|Output to)[:\s]+[`'\"]?([^\s`'\"]+\.\w+)",
        r"\[Write\]\s+([^\s]+\.\w+)",
    ]
    files_to_send = set()
    for pattern in patterns:
        for match in re.finditer(pattern, response, re.IGNORECASE):
            fpath = match.group(1)
            if not os.path.isabs(fpath):
                fpath = os.path.join(work_dir, fpath)
            if os.path.isfile(fpath):
                files_to_send.add(fpath)

    for fpath in list(files_to_send)[:5]:  # Limit to 5 files
        try:
            file_size = os.path.getsize(fpath)
            if file_size > 50 * 1024 * 1024:  # Skip files > 50MB
                continue
            ext = os.path.splitext(fpath)[1].lower()
            if ext in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
                await update.message.reply_photo(
                    photo=open(fpath, "rb"),
                    caption=os.path.basename(fpath)
                )
            else:
                await update.message.reply_document(
                    document=open(fpath, "rb"),
                    filename=os.path.basename(fpath)
                )
        except Exception as e:
            logger.warning(f"Failed to send file {fpath}: {e}")
