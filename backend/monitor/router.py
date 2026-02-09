import os
import re
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import aiosqlite
from auth.jwt import verify_token
from database import DB_PATH

router = APIRouter(prefix="/api/monitors", tags=["monitors"])


async def init_monitor_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS monitors (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                log_path TEXT NOT NULL,
                pattern TEXT NOT NULL,
                enabled BOOLEAN DEFAULT 1,
                auto_fix BOOLEAN DEFAULT 0,
                last_check TEXT,
                created_at TEXT NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS monitor_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                monitor_id TEXT NOT NULL,
                content TEXT NOT NULL,
                fixed BOOLEAN DEFAULT 0,
                fix_result TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
            )
        """)
        await db.commit()


class MonitorCreate(BaseModel):
    name: str
    log_path: str
    pattern: str
    auto_fix: bool = False


@router.get("")
async def list_monitors(username: str = Depends(verify_token)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM monitors ORDER BY created_at DESC")
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


@router.post("")
async def add_monitor(body: MonitorCreate, username: str = Depends(verify_token)):
    monitor_id = str(uuid.uuid4())[:8]
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO monitors (id, name, log_path, pattern, enabled, auto_fix, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
            (monitor_id, body.name, body.log_path, body.pattern, body.auto_fix, now),
        )
        await db.commit()
    return {
        "id": monitor_id, "name": body.name, "log_path": body.log_path,
        "pattern": body.pattern, "enabled": True, "auto_fix": body.auto_fix,
        "last_check": None, "created_at": now,
    }


@router.delete("/{monitor_id}")
async def delete_monitor(monitor_id: str, username: str = Depends(verify_token)):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM monitor_alerts WHERE monitor_id = ?", (monitor_id,))
        cursor = await db.execute("DELETE FROM monitors WHERE id = ?", (monitor_id,))
        await db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Monitor not found")
    return {"detail": "Deleted"}


@router.post("/{monitor_id}/toggle")
async def toggle_monitor(monitor_id: str, username: str = Depends(verify_token)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM monitors WHERE id = ?", (monitor_id,))
        monitor = await cursor.fetchone()
        if not monitor:
            raise HTTPException(status_code=404, detail="Monitor not found")

        new_enabled = not monitor["enabled"]
        await db.execute("UPDATE monitors SET enabled = ? WHERE id = ?", (new_enabled, monitor_id))
        await db.commit()
    return {"id": monitor_id, "enabled": new_enabled}


@router.get("/{monitor_id}/alerts")
async def get_alerts(monitor_id: str, username: str = Depends(verify_token)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM monitor_alerts WHERE monitor_id = ? ORDER BY created_at DESC LIMIT 100",
            (monitor_id,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


@router.post("/{monitor_id}/check")
async def check_monitor(monitor_id: str, username: str = Depends(verify_token)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM monitors WHERE id = ?", (monitor_id,))
        monitor = await cursor.fetchone()
        if not monitor:
            raise HTTPException(status_code=404, detail="Monitor not found")

    log_path = os.path.expanduser(monitor["log_path"])
    if not os.path.isfile(log_path):
        raise HTTPException(status_code=400, detail=f"Log file not found: {log_path}")

    # Read last 200 lines
    try:
        with open(log_path, "r", errors="replace") as f:
            lines = f.readlines()
        last_lines = lines[-200:] if len(lines) > 200 else lines
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read log file: {str(e)}")

    pattern = monitor["pattern"]
    now = datetime.now(timezone.utc).isoformat()
    matches = []

    try:
        re.compile(pattern)
    except re.error as e:
        raise HTTPException(status_code=400, detail=f"Invalid regex pattern: {str(e)}")

    for line in last_lines:
        if re.search(pattern, line, re.IGNORECASE):
            matches.append(line.strip())

    alerts_created = []
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE monitors SET last_check = ? WHERE id = ?", (now, monitor_id))

        for match in matches:
            await db.execute(
                "INSERT INTO monitor_alerts (monitor_id, content, created_at) VALUES (?, ?, ?)",
                (monitor_id, match, now),
            )
            alerts_created.append({"content": match, "created_at": now})

        await db.commit()

    return {
        "monitor_id": monitor_id,
        "checked_at": now,
        "matches_found": len(matches),
        "alerts": alerts_created,
    }
