import os
import pwd
import uuid
import asyncio
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import aiosqlite
from croniter import croniter
from auth.jwt import verify_token
from database import DB_PATH

logger = logging.getLogger("scheduler")
router = APIRouter(prefix="/api/scheduler", tags=["scheduler"])

# Background task handle
_scheduler_task: asyncio.Task | None = None


async def init_scheduler_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS scheduled_tasks (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                cron TEXT NOT NULL,
                prompt TEXT NOT NULL,
                enabled BOOLEAN DEFAULT 1,
                last_run TEXT,
                last_result TEXT,
                created_at TEXT NOT NULL
            )
        """)
        await db.commit()

    # Start background scheduler
    global _scheduler_task
    if _scheduler_task is None or _scheduler_task.done():
        _scheduler_task = asyncio.create_task(_scheduler_loop())
        logger.info("Scheduler background loop started")


# --------------- Background cron loop ---------------

async def _execute_task(task_id: str, prompt: str):
    """Run a Claude Code prompt and save result to DB."""
    now = datetime.now(timezone.utc).isoformat()

    def _demote():
        try:
            pw = pwd.getpwnam("claude")
            os.setgid(pw.pw_gid)
            os.setuid(pw.pw_uid)
        except KeyError:
            pass

    env = os.environ.copy()
    env["HOME"] = "/home/claude"
    env["USER"] = "claude"

    try:
        proc = await asyncio.create_subprocess_exec(
            "claude", "-p", prompt, "--dangerously-skip-permissions",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            preexec_fn=_demote,
            env=env,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
        result = stdout.decode() if stdout else stderr.decode()
    except asyncio.TimeoutError:
        proc.terminate()
        try:
            await asyncio.wait_for(proc.wait(), timeout=5)
        except asyncio.TimeoutError:
            proc.kill()
        result = "Error: Task execution timed out (120s)"
    except FileNotFoundError:
        result = "Error: claude command not found"
    except Exception as e:
        result = f"Error: {str(e)}"

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE scheduled_tasks SET last_run = ?, last_result = ? WHERE id = ?",
            (now, result, task_id),
        )
        await db.commit()

    logger.info(f"Scheduled task '{task_id}' executed, result length: {len(result)}")


async def _scheduler_loop():
    """Check every 30 seconds if any cron task is due."""
    logger.info("Scheduler loop running")
    while True:
        try:
            await asyncio.sleep(30)
            now = datetime.now(timezone.utc)

            async with aiosqlite.connect(DB_PATH) as db:
                db.row_factory = aiosqlite.Row
                cursor = await db.execute(
                    "SELECT * FROM scheduled_tasks WHERE enabled = 1"
                )
                tasks = await cursor.fetchall()

            for task in tasks:
                try:
                    cron = croniter(task["cron"], now)
                    prev_fire = cron.get_prev(datetime)

                    # Check if last_run is before prev_fire (meaning we missed a run)
                    last_run = None
                    if task["last_run"]:
                        last_run_str = task["last_run"]
                        # Handle both formats
                        if last_run_str.endswith("Z"):
                            last_run_str = last_run_str[:-1] + "+00:00"
                        last_run = datetime.fromisoformat(last_run_str)
                        if last_run.tzinfo is None:
                            last_run = last_run.replace(tzinfo=timezone.utc)

                    if last_run is None or last_run < prev_fire.replace(tzinfo=timezone.utc):
                        logger.info(f"Cron triggered task '{task['name']}' (id={task['id']})")
                        # Run in background to not block the loop
                        asyncio.create_task(_execute_task(task["id"], task["prompt"]))

                except (ValueError, KeyError) as e:
                    logger.warning(f"Invalid cron for task {task['id']}: {e}")

        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Scheduler loop error: {e}")
            await asyncio.sleep(10)


# --------------- API endpoints ---------------

class TaskCreate(BaseModel):
    name: str
    cron: str
    prompt: str


class TaskUpdate(BaseModel):
    name: str | None = None
    cron: str | None = None
    prompt: str | None = None
    enabled: bool | None = None


@router.get("/tasks")
async def list_tasks(username: str = Depends(verify_token)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM scheduled_tasks ORDER BY created_at DESC")
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


@router.post("/tasks")
async def create_task(body: TaskCreate, username: str = Depends(verify_token)):
    # Validate cron expression
    if not croniter.is_valid(body.cron):
        raise HTTPException(status_code=400, detail="Invalid cron expression")

    task_id = str(uuid.uuid4())[:8]
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO scheduled_tasks (id, name, cron, prompt, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)",
            (task_id, body.name, body.cron, body.prompt, now),
        )
        await db.commit()
    return {"id": task_id, "name": body.name, "cron": body.cron, "prompt": body.prompt, "enabled": True, "last_run": None, "last_result": None, "created_at": now}


@router.put("/tasks/{task_id}")
async def update_task(task_id: str, body: TaskUpdate, username: str = Depends(verify_token)):
    if body.cron is not None and not croniter.is_valid(body.cron):
        raise HTTPException(status_code=400, detail="Invalid cron expression")

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM scheduled_tasks WHERE id = ?", (task_id,))
        task = await cursor.fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        updates = {}
        if body.name is not None:
            updates["name"] = body.name
        if body.cron is not None:
            updates["cron"] = body.cron
        if body.prompt is not None:
            updates["prompt"] = body.prompt
        if body.enabled is not None:
            updates["enabled"] = body.enabled

        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            values = list(updates.values()) + [task_id]
            await db.execute(f"UPDATE scheduled_tasks SET {set_clause} WHERE id = ?", values)
            await db.commit()

        cursor = await db.execute("SELECT * FROM scheduled_tasks WHERE id = ?", (task_id,))
        task = await cursor.fetchone()
        return dict(task)


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, username: str = Depends(verify_token)):
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("DELETE FROM scheduled_tasks WHERE id = ?", (task_id,))
        await db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Task not found")
    return {"detail": "Deleted"}


@router.post("/tasks/{task_id}/run")
async def run_task(task_id: str, username: str = Depends(verify_token)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM scheduled_tasks WHERE id = ?", (task_id,))
        task = await cursor.fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

    await _execute_task(task_id, task["prompt"])

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM scheduled_tasks WHERE id = ?", (task_id,))
        updated = await cursor.fetchone()
        return dict(updated)


@router.post("/tasks/{task_id}/toggle")
async def toggle_task(task_id: str, username: str = Depends(verify_token)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM scheduled_tasks WHERE id = ?", (task_id,))
        task = await cursor.fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        new_enabled = not task["enabled"]
        await db.execute("UPDATE scheduled_tasks SET enabled = ? WHERE id = ?", (new_enabled, task_id))
        await db.commit()

    return {"id": task_id, "enabled": new_enabled}
