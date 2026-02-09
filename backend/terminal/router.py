import asyncio
import json
import os
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from auth.jwt import verify_token_from_string

router = APIRouter(tags=["terminal"])

# Dangerous command patterns to block
BLOCKED_COMMANDS = [
    "rm -rf /",
    "rm -rf /*",
    "mkfs",
    ":(){:|:&};:",
    "dd if=/dev/zero of=/dev/sda",
    "chmod -R 777 /",
]


def is_blocked(command: str) -> bool:
    cmd = command.strip().lower()
    for blocked in BLOCKED_COMMANDS:
        if blocked in cmd:
            return True
    return False


@router.websocket("/api/terminal/ws")
async def terminal_websocket(websocket: WebSocket, token: str = ""):
    """WebSocket endpoint for interactive terminal."""
    try:
        username = verify_token_from_string(token)
    except ValueError:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    await websocket.accept()

    # Track current working directory across commands
    cwd = os.path.expanduser("~")

    try:
        # Send initial prompt
        await websocket.send_json({
            "type": "prompt",
            "cwd": cwd,
        })

        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)

            if data.get("type") != "command":
                continue

            command = data.get("content", "").strip()
            if not command:
                await websocket.send_json({"type": "prompt", "cwd": cwd})
                continue

            # Security check
            if is_blocked(command):
                await websocket.send_json({
                    "type": "output",
                    "content": "Blocked: this command is not allowed for safety reasons.\n",
                })
                await websocket.send_json({"type": "exit", "code": 1, "cwd": cwd})
                continue

            # Handle 'cd' specially to maintain directory state
            if command == "cd" or command.startswith("cd "):
                parts = command.split(None, 1)
                target = parts[1] if len(parts) > 1 else os.path.expanduser("~")
                target = os.path.expanduser(target)
                if not os.path.isabs(target):
                    target = os.path.join(cwd, target)
                target = os.path.realpath(target)
                if os.path.isdir(target):
                    cwd = target
                    await websocket.send_json({"type": "exit", "code": 0, "cwd": cwd})
                else:
                    await websocket.send_json({
                        "type": "output",
                        "content": f"cd: no such file or directory: {parts[1] if len(parts) > 1 else '~'}\n",
                    })
                    await websocket.send_json({"type": "exit", "code": 1, "cwd": cwd})
                continue

            # Execute command
            try:
                process = await asyncio.create_subprocess_shell(
                    command,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    cwd=cwd,
                    env={**os.environ, "TERM": "dumb", "COLUMNS": "120"},
                )

                # Stream output
                while True:
                    chunk = await process.stdout.read(512)
                    if not chunk:
                        break
                    await websocket.send_json({
                        "type": "output",
                        "content": chunk.decode("utf-8", errors="replace"),
                    })

                await process.wait()
                await websocket.send_json({
                    "type": "exit",
                    "code": process.returncode,
                    "cwd": cwd,
                })
            except Exception as e:
                await websocket.send_json({
                    "type": "output",
                    "content": f"Error: {str(e)}\n",
                })
                await websocket.send_json({"type": "exit", "code": 1, "cwd": cwd})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "output", "content": f"Terminal error: {e}\n"})
        except Exception:
            pass
