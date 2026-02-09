import os
import glob
from datetime import datetime, timezone
from config import settings

BRAIN_PATH = settings.CLAUDE_BRAIN_PATH
SESSIONS_DIR = os.path.join(BRAIN_PATH, "sessions")


def ensure_brain_dirs():
    """Ensure the brain directory structure exists."""
    os.makedirs(SESSIONS_DIR, exist_ok=True)


def get_context() -> str:
    """
    Build context string from brain data:
    1. preferences.md (if exists)
    2. Latest 3 session summaries (by filename timestamp)
    """
    ensure_brain_dirs()
    parts = []

    # 1. Preferences
    prefs_path = os.path.join(BRAIN_PATH, "preferences.md")
    if os.path.exists(prefs_path):
        with open(prefs_path, "r") as f:
            prefs = f.read().strip()
        if prefs:
            parts.append(f"[你的偏好]\n{prefs}")

    # 2. Recent session summaries (last 3 .md files sorted by name desc)
    md_files = sorted(glob.glob(os.path.join(SESSIONS_DIR, "*.md")), reverse=True)
    recent = md_files[:3]
    if recent:
        summary_parts = []
        for i, filepath in enumerate(recent, 1):
            with open(filepath, "r") as f:
                content = f.read().strip()
            if content:
                summary_parts.append(f"--- Session {i} ---\n{content}")
        if summary_parts:
            parts.append("[最近对话摘要]\n" + "\n\n".join(summary_parts))

    return "\n\n".join(parts)


def build_context_prompt(user_input: str, is_first_message: bool = False) -> str:
    """
    Build prompt with brain context injected before user input.
    Only injects context on the first message of a session.
    """
    if is_first_message:
        context = get_context()
        if context:
            return f"{context}\n\n[当前指令]\n{user_input}"
    return user_input


async def generate_summary(session_id: str) -> str:
    """
    Generate a summary for a session using Claude Code.
    Saves to ~/claude-brain/sessions/{timestamp}.md
    """
    import aiosqlite
    from chat.claude_code import call_claude_code

    async with aiosqlite.connect(settings.DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT role, content FROM messages WHERE session_id = ? ORDER BY timestamp",
            (session_id,),
        )
        messages = await cursor.fetchall()

    if not messages:
        return ""

    conversation = "\n".join([f"{m['role']}: {m['content'][:500]}" for m in messages])
    summary_prompt = f"""请总结以下对话的要点，包括：
1. 做了什么
2. 关键决策
3. 未完成的事项
4. 相关文件
用 Markdown 格式，控制在 200 字以内。

对话内容：
{conversation[:3000]}"""

    result = []
    async for chunk_text, chunk_type in call_claude_code(summary_prompt):
        result.append(chunk_text)

    summary = "".join(result).strip()

    # Save summary to database
    async with aiosqlite.connect(settings.DATABASE_PATH) as db:
        await db.execute("UPDATE sessions SET summary = ? WHERE id = ?", (summary, session_id))
        await db.commit()

    # Save to brain directory with timestamp filename
    ensure_brain_dirs()
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d-%H%M%S")
    summary_path = os.path.join(SESSIONS_DIR, f"{timestamp}.md")
    with open(summary_path, "w") as f:
        f.write(summary)

    return summary
