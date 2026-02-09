import json
from fastapi import APIRouter, Depends, HTTPException
import aiosqlite
from auth.jwt import verify_token
from config import settings
from sessions.brain import generate_summary

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.get("")
async def list_sessions(username: str = Depends(verify_token)):
    async with aiosqlite.connect(settings.DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM sessions ORDER BY updated_at DESC")
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


@router.get("/{session_id}")
async def get_session(session_id: str, username: str = Depends(verify_token)):
    async with aiosqlite.connect(settings.DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row

        cursor = await db.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
        session = await cursor.fetchone()
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        cursor = await db.execute(
            "SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp", (session_id,)
        )
        messages = await cursor.fetchall()

        result = dict(session)
        result["messages"] = []
        for m in messages:
            msg = dict(m)
            msg["attachments"] = json.loads(msg["attachments"])
            result["messages"].append(msg)
        return result


@router.post("/{session_id}/summarize")
async def summarize_session(session_id: str, username: str = Depends(verify_token)):
    async with aiosqlite.connect(settings.DATABASE_PATH) as db:
        cursor = await db.execute("SELECT id FROM sessions WHERE id = ?", (session_id,))
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Session not found")

    summary = await generate_summary(session_id)
    return {"summary": summary}


@router.delete("/{session_id}")
async def delete_session(session_id: str, username: str = Depends(verify_token)):
    async with aiosqlite.connect(settings.DATABASE_PATH) as db:
        await db.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
        await db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        await db.commit()
    return {"ok": True}
