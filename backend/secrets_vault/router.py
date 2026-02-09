"""
密钥保险箱 API
Fernet 对称加密，密钥从 JWT_SECRET 派生（SHA256 -> base64）
增删后自动同步到 /home/claude/.env
"""

import os
import uuid
import hashlib
import base64
from datetime import datetime, timezone
from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import aiosqlite
from auth.jwt import verify_token
from config import settings
from database import DB_PATH

router = APIRouter(prefix="/api/secrets", tags=["secrets"])

ENV_PATH = "/home/claude/.env"


# ── 加密工具 ───────────────────────────────────────

def _get_fernet() -> Fernet:
    """从 JWT_SECRET 派生 Fernet 密钥"""
    key = hashlib.sha256(settings.JWT_SECRET.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def _encrypt(value: str) -> str:
    return _get_fernet().encrypt(value.encode()).decode()


def _decrypt(token: str) -> str:
    return _get_fernet().decrypt(token.encode()).decode()


# ── 数据库初始化 ──────────────────────────────────

async def init_secrets_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS secret_vault (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                encrypted_value TEXT NOT NULL,
                description TEXT DEFAULT '',
                created_at TEXT NOT NULL
            )
        """)
        await db.commit()


# ── .env 同步 ─────────────────────────────────────

async def sync_secrets_to_env():
    """解密所有密钥，写入 /home/claude/.env（export NAME=value 格式）"""
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT name, encrypted_value FROM secret_vault ORDER BY name")
            rows = await cursor.fetchall()

        lines = []
        for row in rows:
            value = _decrypt(row["encrypted_value"])
            # 转义双引号
            escaped = value.replace("\\", "\\\\").replace('"', '\\"')
            lines.append(f'export {row["name"]}="{escaped}"')

        env_dir = os.path.dirname(ENV_PATH)
        os.makedirs(env_dir, exist_ok=True)
        with open(ENV_PATH, "w") as f:
            f.write("\n".join(lines) + "\n" if lines else "")
        os.chmod(ENV_PATH, 0o644)
        # FastAPI 以 root 运行，需要把文件归属改为 claude 用户
        try:
            import pwd
            pw = pwd.getpwnam("claude")
            os.chown(ENV_PATH, pw.pw_uid, pw.pw_gid)
        except (KeyError, OSError):
            pass
    except Exception:
        pass  # 启动时可能还没有表，静默忽略


# ── Pydantic 模型 ─────────────────────────────────

class SecretCreate(BaseModel):
    name: str
    value: str
    description: str = ""


# ── API 路由 ──────────────────────────────────────

@router.get("")
async def list_secrets(username: str = Depends(verify_token)):
    """列出所有密钥（只返回 name + description，不返回值）"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT id, name, description, created_at FROM secret_vault ORDER BY created_at DESC"
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


@router.get("/{secret_id}/reveal")
async def reveal_secret(secret_id: str, username: str = Depends(verify_token)):
    """解密返回单个密钥值"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT encrypted_value FROM secret_vault WHERE id = ?", (secret_id,)
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Secret not found")
        value = _decrypt(row["encrypted_value"])
        return {"value": value}


@router.post("")
async def create_secret(body: SecretCreate, username: str = Depends(verify_token)):
    """添加新密钥（加密存储 + 同步 .env）"""
    name = body.name.strip()
    if not name or not body.value:
        raise HTTPException(status_code=400, detail="name and value are required")

    import re
    if not re.match(r"^[A-Z][A-Z0-9_]*$", name):
        raise HTTPException(
            status_code=400,
            detail="Name must start with uppercase letter and contain only A-Z, 0-9, _",
        )

    encrypted = _encrypt(body.value)
    sid = str(uuid.uuid4())[:8]
    now = datetime.now(timezone.utc).isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        # 如果重名则更新
        existing = await db.execute("SELECT id FROM secret_vault WHERE name = ?", (name,))
        row = await existing.fetchone()
        if row:
            await db.execute(
                "UPDATE secret_vault SET encrypted_value = ?, description = ? WHERE name = ?",
                (encrypted, body.description, name),
            )
            sid = row[0]
        else:
            await db.execute(
                "INSERT INTO secret_vault (id, name, encrypted_value, description, created_at) VALUES (?, ?, ?, ?, ?)",
                (sid, name, encrypted, body.description, now),
            )
        await db.commit()

    await sync_secrets_to_env()

    return {"id": sid, "name": name, "description": body.description, "created_at": now}


@router.delete("/{secret_id}")
async def delete_secret(secret_id: str, username: str = Depends(verify_token)):
    """删除密钥 + 同步 .env"""
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("DELETE FROM secret_vault WHERE id = ?", (secret_id,))
        await db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Secret not found")

    await sync_secrets_to_env()
    return {"detail": "Deleted"}
