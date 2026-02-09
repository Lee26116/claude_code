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


# --------------- Claude Code Auth Helpers ---------------

def _extract_urls(text: str) -> list[str]:
    """Extract URLs from text (for capturing OAuth links)."""
    return re_module.findall(r'https?://[^\s<>"\']+', text)


async def _check_claude_auth() -> dict:
    """
    Check if Claude Code CLI is authenticated.
    Returns {"ok": True/False, "detail": str, "auth_url": str|None}
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            "claude", "-p", "hi", "--output-format", "json",
            "--max-turns", "1", "--dangerously-skip-permissions",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        stdout_text = stdout.decode("utf-8", errors="replace")
        stderr_text = stderr.decode("utf-8", errors="replace")

        if proc.returncode == 0:
            return {"ok": True, "detail": "Claude Code is authenticated and working.", "auth_url": None}

        # Auth failure - look for OAuth URL in output
        combined = stdout_text + "\n" + stderr_text
        urls = _extract_urls(combined)
        auth_url = None
        for url in urls:
            if "anthropic.com" in url or "claude.ai" in url or "oauth" in url.lower() or "login" in url.lower() or "auth" in url.lower():
                auth_url = url
                break

        # Check for common auth error messages
        auth_keywords = ["unauthorized", "auth", "token", "expired", "login", "credential", "401", "403"]
        is_auth_error = any(kw in combined.lower() for kw in auth_keywords)

        if is_auth_error:
            return {
                "ok": False,
                "detail": f"Authentication failed.\n\n{stderr_text[:500]}",
                "auth_url": auth_url,
            }
        else:
            return {
                "ok": False,
                "detail": f"Claude Code error (exit code {proc.returncode}):\n{stderr_text[:500]}",
                "auth_url": auth_url,
            }

    except asyncio.TimeoutError:
        return {"ok": False, "detail": "Claude Code timed out (30s). It may be hanging on an auth prompt.", "auth_url": None}
    except FileNotFoundError:
        return {"ok": False, "detail": "Claude Code CLI not found. Is it installed?", "auth_url": None}
    except Exception as e:
        return {"ok": False, "detail": f"Error checking auth: {str(e)}", "auth_url": None}


async def _trigger_reauth() -> dict:
    """
    Trigger Claude Code re-authentication and capture the OAuth URL.
    Returns {"auth_url": str|None, "output": str}
    """
    try:
        # Try 'claude auth login' to get OAuth URL
        proc = await asyncio.create_subprocess_exec(
            "claude", "auth", "login",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            stdin=asyncio.subprocess.PIPE,
        )
        # Give it a few seconds to output the URL, then kill it
        # (it would otherwise wait for browser callback)
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(input=b""), timeout=15)
        except asyncio.TimeoutError:
            proc.kill()
            stdout, stderr = await proc.communicate()

        combined = (stdout or b"").decode("utf-8", errors="replace") + "\n" + (stderr or b"").decode("utf-8", errors="replace")
        urls = _extract_urls(combined)

        auth_url = None
        for url in urls:
            if "anthropic.com" in url or "claude.ai" in url or "oauth" in url.lower() or "login" in url.lower():
                auth_url = url
                break

        return {"auth_url": auth_url, "output": combined.strip()}

    except FileNotFoundError:
        return {"auth_url": None, "output": "Claude Code CLI not found."}
    except Exception as e:
        return {"auth_url": None, "output": f"Error: {str(e)}"}


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
    """Handle /auth command - check and refresh Claude Code authentication."""
    if not _auth_check(update.effective_user.id):
        await update.message.reply_text("Unauthorized.")
        return

    await update.message.reply_text("Checking Claude Code authentication...")

    result = await _check_claude_auth()

    if result["ok"]:
        await update.message.reply_text("Claude Code auth OK.")
        return

    # Auth failed - show details
    msg = f"Auth issue detected:\n{result['detail']}"

    if result["auth_url"]:
        msg += f"\n\nClick to re-authenticate:\n{result['auth_url']}"
        await update.message.reply_text(msg)
        return

    # No URL found from check, try triggering re-auth
    await update.message.reply_text(msg + "\n\nAttempting to get re-auth link...")
    reauth = await _trigger_reauth()

    if reauth["auth_url"]:
        await update.message.reply_text(f"Click to re-authenticate:\n{reauth['auth_url']}")
    else:
        tip = (
            "Could not get an auto-login link.\n\n"
            "Options:\n"
            "1. SSH into the server and run: claude auth login\n"
            "2. Set ANTHROPIC_API_KEY in .env (no OAuth needed)\n"
        )
        if reauth["output"]:
            tip += f"\nCLI output:\n{reauth['output'][:500]}"
        await update.message.reply_text(tip)


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
            full_prompt = build_context_prompt(content, is_first_message=True)

            # Collect the full output
            final_result = ""
            full_output_parts = []

            async for chunk_text, chunk_type in call_claude_code(full_prompt, working_dir=work_dir):
                if chunk_type == "result":
                    final_result = chunk_text
                elif chunk_type in ("text", "tool_use", "tool_result", "error"):
                    full_output_parts.append(chunk_text)

            # Use final_result if available, otherwise join all parts
            response = final_result if final_result else "\n".join(full_output_parts)

            if not response.strip():
                response = "(No output from Claude Code)"

            # Detect auth errors in the response
            auth_keywords = ["unauthorized", "token expired", "authentication", "401", "403", "auth"]
            response_lower = response.lower()
            is_auth_error = any(kw in response_lower for kw in auth_keywords) and ("error" in response_lower or "fail" in response_lower)

            # Delete the "Processing..." message
            try:
                await status_msg.delete()
            except Exception:
                pass

            if is_auth_error:
                # Auto-detect and push re-auth link
                urls = _extract_urls(response)
                auth_url = None
                for url in urls:
                    if "anthropic.com" in url or "claude.ai" in url or "oauth" in url.lower():
                        auth_url = url
                        break

                msg = "Claude Code authentication issue detected.\n"
                if auth_url:
                    msg += f"\nClick to re-authenticate:\n{auth_url}"
                else:
                    msg += "\nRun /auth to check status and get a re-auth link."
                await update.message.reply_text(msg)
                # Still send the original response for context
                await _send_long_text(update, response)
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
