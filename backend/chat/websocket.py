import json
import uuid
from datetime import datetime, timezone
from fastapi import WebSocket, WebSocketDisconnect
import aiosqlite
from chat.claude_code import call_claude_code
from sessions.brain import build_context_prompt
from config import settings


async def chat_handler(websocket: WebSocket, username: str):
    """Handle a WebSocket chat connection."""
    await websocket.accept()

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type", "message")

            if msg_type != "message":
                continue

            content = data.get("content", "").strip()
            attachments = data.get("attachments", [])
            session_id = data.get("session_id")
            is_first_message = data.get("is_first_message", False)

            if not content and not attachments:
                await websocket.send_json({"type": "error", "message": "Empty message"})
                continue

            # Build the prompt — inject brain context only on first message
            is_new_session = not session_id
            full_prompt = build_context_prompt(content, is_first_message=is_new_session or is_first_message)

            # If attachments include file paths, append them to prompt
            for att in attachments:
                path = att.get("path", "")
                if path:
                    full_prompt += f"\n\n[Attached file: {path}]"

            # Create or reuse session
            now = datetime.now(timezone.utc).isoformat()
            if not session_id:
                session_id = str(uuid.uuid4())
                async with aiosqlite.connect(settings.DATABASE_PATH) as db:
                    await db.execute(
                        "INSERT INTO sessions (id, created_at, updated_at, title) VALUES (?, ?, ?, ?)",
                        (session_id, now, now, content[:50]),
                    )
                    await db.commit()

            # Save user message
            async with aiosqlite.connect(settings.DATABASE_PATH) as db:
                await db.execute(
                    "INSERT INTO messages (session_id, role, content, attachments, timestamp) VALUES (?, ?, ?, ?, ?)",
                    (session_id, "user", content, json.dumps(attachments), now),
                )
                await db.commit()

            # Notify client of session_id
            await websocket.send_json({"type": "session_id", "session_id": session_id})

            # Stream Claude Code output with type classification
            final_result = ""
            try:
                async for chunk_text, chunk_type in call_claude_code(full_prompt):
                    if chunk_type == "result":
                        # Final result from Claude - this is the definitive answer
                        final_result = chunk_text
                    await websocket.send_json({
                        "type": "chunk",
                        "content": chunk_text,
                        "chunk_type": chunk_type,  # "text", "tool_use", "tool_result", "error", "result"
                    })
            except Exception as e:
                await websocket.send_json({"type": "error", "message": str(e)})
                continue

            # Save assistant message - use final_result if available
            assistant_content = final_result
            async with aiosqlite.connect(settings.DATABASE_PATH) as db:
                await db.execute(
                    "INSERT INTO messages (session_id, role, content, attachments, timestamp) VALUES (?, ?, ?, ?, ?)",
                    (session_id, "assistant", assistant_content, "[]", datetime.now(timezone.utc).isoformat()),
                )
                await db.execute("UPDATE sessions SET updated_at = ? WHERE id = ?", (datetime.now(timezone.utc).isoformat(), session_id))
                await db.commit()

            await websocket.send_json({"type": "done", "session_id": session_id})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
