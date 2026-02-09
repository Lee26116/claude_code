from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from auth.jwt import verify_token
from sessions.brain import get_context, generate_summary

router = APIRouter(prefix="/api/brain", tags=["brain"])


class ContextResponse(BaseModel):
    context: str


class SummarizeRequest(BaseModel):
    session_id: str


class SummarizeResponse(BaseModel):
    summary: str


@router.get("/context", response_model=ContextResponse)
async def brain_context(username: str = Depends(verify_token)):
    """Return brain context (preferences + recent session summaries)."""
    return {"context": get_context()}


@router.post("/summarize", response_model=SummarizeResponse)
async def brain_summarize(req: SummarizeRequest, username: str = Depends(verify_token)):
    """Trigger session summary generation via Claude Code."""
    summary = await generate_summary(req.session_id)
    if not summary:
        raise HTTPException(status_code=400, detail="No messages to summarize")
    return {"summary": summary}
