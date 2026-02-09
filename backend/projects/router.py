import os
import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from auth.jwt import verify_token
from config import settings

router = APIRouter(prefix="/api/projects", tags=["projects"])

PROJECTS_FILE = os.path.join(settings.CLAUDE_BRAIN_PATH, "projects.json")
DEFAULT_DATA = {"projects": [], "active": None}


class ProjectCreate(BaseModel):
    name: str
    path: str


class ProjectUpdate(BaseModel):
    name: str | None = None
    path: str | None = None
    active: bool | None = None


def _read_projects() -> dict:
    if not os.path.exists(PROJECTS_FILE):
        os.makedirs(os.path.dirname(PROJECTS_FILE), exist_ok=True)
        with open(PROJECTS_FILE, "w") as f:
            json.dump(DEFAULT_DATA, f, indent=2)
        return DEFAULT_DATA.copy()
    with open(PROJECTS_FILE, "r") as f:
        return json.load(f)


def _write_projects(data: dict):
    os.makedirs(os.path.dirname(PROJECTS_FILE), exist_ok=True)
    with open(PROJECTS_FILE, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


@router.get("")
async def list_projects(username: str = Depends(verify_token)):
    data = _read_projects()
    return data


@router.post("")
async def add_project(body: ProjectCreate, username: str = Depends(verify_token)):
    data = _read_projects()
    for p in data["projects"]:
        if p["name"] == body.name:
            raise HTTPException(status_code=400, detail="Project with this name already exists")
    project = {"name": body.name, "path": body.path, "active": False}
    data["projects"].append(project)
    _write_projects(data)
    return project


@router.put("/{name}")
async def update_project(name: str, body: ProjectUpdate, username: str = Depends(verify_token)):
    data = _read_projects()
    for i, p in enumerate(data["projects"]):
        if p["name"] == name:
            if body.name is not None:
                p["name"] = body.name
            if body.path is not None:
                p["path"] = body.path
            if body.active is not None:
                p["active"] = body.active
            data["projects"][i] = p
            _write_projects(data)
            return p
    raise HTTPException(status_code=404, detail="Project not found")


@router.delete("/{name}")
async def delete_project(name: str, username: str = Depends(verify_token)):
    data = _read_projects()
    original_len = len(data["projects"])
    data["projects"] = [p for p in data["projects"] if p["name"] != name]
    if len(data["projects"]) == original_len:
        raise HTTPException(status_code=404, detail="Project not found")
    if data["active"] == name:
        data["active"] = None
    _write_projects(data)
    return {"detail": "Deleted"}


@router.post("/{name}/activate")
async def activate_project(name: str, username: str = Depends(verify_token)):
    data = _read_projects()
    found = False
    for p in data["projects"]:
        if p["name"] == name:
            p["active"] = True
            found = True
        else:
            p["active"] = False
    if not found:
        raise HTTPException(status_code=404, detail="Project not found")
    data["active"] = name
    _write_projects(data)
    return {"active": name}
