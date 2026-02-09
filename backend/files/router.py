import os
import time
from typing import Optional
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Query
from pydantic import BaseModel
from auth.jwt import verify_token
from config import settings

router = APIRouter(prefix="/api/files", tags=["files"])

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
MAX_READ_SIZE = 1 * 1024 * 1024  # 1MB


@router.post("/upload")
async def upload_file(file: UploadFile = File(...), username: str = Depends(verify_token)):
    os.makedirs(settings.UPLOAD_PATH, exist_ok=True)
    # Ensure upload dir is owned by claude user
    try:
        os.chown(settings.UPLOAD_PATH, 1000, 1000)
    except OSError:
        pass

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 10MB)")

    timestamp = int(time.time())
    safe_name = file.filename.replace("/", "_").replace("\\", "_")
    filename = f"{timestamp}_{safe_name}"
    filepath = os.path.join(settings.UPLOAD_PATH, filename)

    with open(filepath, "wb") as f:
        f.write(content)

    # Make file readable by claude user (uid 1000) since FastAPI runs as root
    try:
        os.chown(filepath, 1000, 1000)
    except OSError:
        pass

    return {
        "filename": filename,
        "path": filepath,
        "size": len(content),
        "content_type": file.content_type,
    }


class FileWrite(BaseModel):
    path: str
    content: str


@router.post("/write")
async def write_file(body: FileWrite, username: str = Depends(verify_token)):
    """Write content to a text file."""
    expanded = os.path.expanduser(body.path)

    # Safety: only allow writing under /home/claude
    if not expanded.startswith("/home/claude"):
        raise HTTPException(status_code=403, detail="Writing only allowed under /home/claude")

    os.makedirs(os.path.dirname(expanded), exist_ok=True)

    try:
        with open(expanded, "w") as f:
            f.write(body.content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write file: {str(e)}")

    return {"path": expanded, "size": len(body.content)}


@router.get("/list")
async def list_files(path: str = "", username: str = Depends(verify_token)):
    """List files in a directory (defaults to upload path)."""
    target = path if path else settings.UPLOAD_PATH
    if not os.path.isdir(target):
        raise HTTPException(status_code=404, detail="Directory not found")

    entries = []
    for name in sorted(os.listdir(target)):
        full_path = os.path.join(target, name)
        entries.append({
            "name": name,
            "path": full_path,
            "is_dir": os.path.isdir(full_path),
            "size": os.path.getsize(full_path) if os.path.isfile(full_path) else 0,
        })
    return entries


TEXT_EXTENSIONS = {
    ".txt", ".md", ".py", ".js", ".ts", ".tsx", ".jsx", ".json", ".yaml", ".yml",
    ".toml", ".cfg", ".ini", ".conf", ".sh", ".bash", ".zsh", ".css", ".scss",
    ".html", ".xml", ".svg", ".sql", ".env", ".gitignore", ".dockerfile",
    ".rs", ".go", ".java", ".c", ".cpp", ".h", ".hpp", ".rb", ".php", ".vue",
    ".log", ".csv", ".makefile", ".lock", ".editorconfig",
}


@router.get("/read")
async def read_file(path: str = Query(...), username: str = Depends(verify_token)):
    """Read file content (text files only, max 1MB)."""
    expanded = os.path.expanduser(path)
    if not os.path.isfile(expanded):
        raise HTTPException(status_code=404, detail="File not found")

    size = os.path.getsize(expanded)
    if size > MAX_READ_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 1MB)")

    ext = os.path.splitext(expanded)[1].lower()
    if ext and ext not in TEXT_EXTENSIONS:
        # Try to read anyway but detect binary
        pass

    try:
        with open(expanded, "r", errors="replace") as f:
            content = f.read()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {str(e)}")

    return {
        "path": expanded,
        "name": os.path.basename(expanded),
        "size": size,
        "content": content,
    }


def _build_tree(dir_path: str, current_depth: int, max_depth: int) -> list:
    """Recursively build a directory tree."""
    if current_depth > max_depth:
        return []

    entries = []
    try:
        items = sorted(os.listdir(dir_path))
    except PermissionError:
        return []

    # Skip heavy/irrelevant dirs but show dotfiles like .claude
    SKIP_DIRS = {"node_modules", "__pycache__", ".git", ".npm", ".cache"}
    for name in items:
        if name in SKIP_DIRS:
            continue
        full_path = os.path.join(dir_path, name)
        is_dir = os.path.isdir(full_path)
        entry = {
            "name": name,
            "path": full_path,
            "is_dir": is_dir,
        }
        if is_dir:
            entry["children"] = _build_tree(full_path, current_depth + 1, max_depth)
        else:
            entry["size"] = os.path.getsize(full_path)
        entries.append(entry)

    return entries


@router.get("/tree")
async def file_tree(
    path: str = Query(...),
    depth: int = Query(3, ge=1, le=10),
    username: str = Depends(verify_token),
):
    """Get recursive directory tree."""
    expanded = os.path.expanduser(path)
    if not os.path.isdir(expanded):
        raise HTTPException(status_code=404, detail="Directory not found")

    tree = _build_tree(expanded, 1, depth)
    return {"path": expanded, "depth": depth, "children": tree}
