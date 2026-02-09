from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from auth.jwt import verify_token_from_string
from chat.websocket import chat_handler

router = APIRouter(tags=["chat"])


@router.websocket("/api/chat/stream")
async def websocket_endpoint(websocket: WebSocket, token: str = ""):
    """WebSocket endpoint for streaming chat with Claude Code."""
    try:
        username = verify_token_from_string(token)
    except ValueError:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    await chat_handler(websocket, username)
