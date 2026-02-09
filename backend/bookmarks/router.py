import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import aiosqlite
from auth.jwt import verify_token
from database import DB_PATH

router = APIRouter(prefix="/api/bookmarks", tags=["bookmarks"])


async def init_bookmarks_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS server_bookmarks (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                user TEXT NOT NULL DEFAULT 'root',
                description TEXT DEFAULT '',
                created_at TEXT NOT NULL
            )
        """)
        await db.commit()


class ServerCreate(BaseModel):
    name: str
    host: str
    user: str = "root"
    description: str = ""


@router.get("/servers")
async def list_servers(username: str = Depends(verify_token)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM server_bookmarks ORDER BY created_at")
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


@router.post("/servers")
async def create_server(body: ServerCreate, username: str = Depends(verify_token)):
    sid = str(uuid.uuid4())[:8]
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO server_bookmarks (id, name, host, user, description, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (sid, body.name, body.host, body.user, body.description, now),
        )
        await db.commit()
    return {"id": sid, "name": body.name, "host": body.host, "user": body.user, "description": body.description}


@router.delete("/servers/{server_id}")
async def delete_server(server_id: str, username: str = Depends(verify_token)):
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("DELETE FROM server_bookmarks WHERE id = ?", (server_id,))
        await db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Server not found")
    return {"detail": "Deleted"}
