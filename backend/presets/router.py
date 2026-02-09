import os
import json
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from auth.jwt import verify_token
from config import settings

router = APIRouter(prefix="/api/presets", tags=["presets"])

PRESETS_FILE = os.path.join(settings.CLAUDE_BRAIN_PATH, "presets.json")

DEFAULT_PRESETS = [
    {"id": "1", "label": "代码审查", "prompt": "请审查当前目录下的代码，找出潜在问题"},
    {"id": "2", "label": "写测试", "prompt": "为最近修改的文件编写单元测试"},
    {"id": "3", "label": "解释代码", "prompt": "解释当前打开的文件的功能和逻辑"},
    {"id": "4", "label": "优化性能", "prompt": "分析并优化当前项目的性能瓶颈"},
]


class PresetCreate(BaseModel):
    label: str
    prompt: str


class PresetUpdate(BaseModel):
    label: str | None = None
    prompt: str | None = None


def _read_presets() -> list:
    if not os.path.exists(PRESETS_FILE):
        os.makedirs(os.path.dirname(PRESETS_FILE), exist_ok=True)
        with open(PRESETS_FILE, "w") as f:
            json.dump(DEFAULT_PRESETS, f, indent=2, ensure_ascii=False)
        return DEFAULT_PRESETS.copy()
    with open(PRESETS_FILE, "r") as f:
        return json.load(f)


def _write_presets(presets: list):
    os.makedirs(os.path.dirname(PRESETS_FILE), exist_ok=True)
    with open(PRESETS_FILE, "w") as f:
        json.dump(presets, f, indent=2, ensure_ascii=False)


@router.get("")
async def list_presets(username: str = Depends(verify_token)):
    return _read_presets()


@router.post("")
async def add_preset(body: PresetCreate, username: str = Depends(verify_token)):
    presets = _read_presets()
    preset = {"id": str(uuid.uuid4())[:8], "label": body.label, "prompt": body.prompt}
    presets.append(preset)
    _write_presets(presets)
    return preset


@router.put("/{preset_id}")
async def update_preset(preset_id: str, body: PresetUpdate, username: str = Depends(verify_token)):
    presets = _read_presets()
    for i, p in enumerate(presets):
        if p["id"] == preset_id:
            if body.label is not None:
                p["label"] = body.label
            if body.prompt is not None:
                p["prompt"] = body.prompt
            presets[i] = p
            _write_presets(presets)
            return p
    raise HTTPException(status_code=404, detail="Preset not found")


@router.delete("/{preset_id}")
async def delete_preset(preset_id: str, username: str = Depends(verify_token)):
    presets = _read_presets()
    original_len = len(presets)
    presets = [p for p in presets if p["id"] != preset_id]
    if len(presets) == original_len:
        raise HTTPException(status_code=404, detail="Preset not found")
    _write_presets(presets)
    return {"detail": "Deleted"}
