import os
import glob
from fastapi import APIRouter, Depends, HTTPException, Query
import aiosqlite
from auth.jwt import verify_token
from config import settings
from database import DB_PATH

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("")
async def search(
    q: str = Query(..., min_length=1),
    type: str = Query("all", pattern="^(sessions|brain|all)$"),
    username: str = Depends(verify_token),
):
    results = []

    if type in ("sessions", "all"):
        session_results = await _search_sessions(q)
        results.extend(session_results)

    if type in ("brain", "all"):
        brain_results = _search_brain(q)
        results.extend(brain_results)

    return {"query": q, "type": type, "total": len(results), "results": results}


async def _search_sessions(keyword: str) -> list:
    results = []
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT m.id, m.session_id, m.content, m.timestamp, m.role
            FROM messages m
            WHERE m.content LIKE ?
            ORDER BY m.timestamp DESC
            LIMIT 50
            """,
            (f"%{keyword}%",),
        )
        rows = await cursor.fetchall()
        for row in rows:
            content = row["content"]
            # Create a snippet around the keyword
            lower_content = content.lower()
            idx = lower_content.find(keyword.lower())
            start = max(0, idx - 80)
            end = min(len(content), idx + len(keyword) + 80)
            snippet = content[start:end]
            if start > 0:
                snippet = "..." + snippet
            if end < len(content):
                snippet = snippet + "..."

            results.append({
                "source": "session",
                "session_id": row["session_id"],
                "message_id": row["id"],
                "role": row["role"],
                "snippet": snippet,
                "timestamp": row["timestamp"],
            })
    return results


def _search_brain(keyword: str) -> list:
    results = []
    brain_sessions_dir = os.path.join(settings.CLAUDE_BRAIN_PATH, "sessions")
    if not os.path.isdir(brain_sessions_dir):
        return results

    md_files = glob.glob(os.path.join(brain_sessions_dir, "*.md"))
    for filepath in md_files:
        try:
            with open(filepath, "r", errors="replace") as f:
                content = f.read()
        except Exception:
            continue

        lower_content = content.lower()
        if keyword.lower() not in lower_content:
            continue

        idx = lower_content.find(keyword.lower())
        start = max(0, idx - 80)
        end = min(len(content), idx + len(keyword) + 80)
        snippet = content[start:end]
        if start > 0:
            snippet = "..." + snippet
        if end < len(content):
            snippet = snippet + "..."

        filename = os.path.basename(filepath)
        results.append({
            "source": "brain",
            "file": filename,
            "path": filepath,
            "snippet": snippet,
            "timestamp": None,
        })

    return results
