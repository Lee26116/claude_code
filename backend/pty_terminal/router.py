import asyncio
import fcntl
import json
import os
import pty
import signal
import struct
import termios
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from auth.jwt import verify_token_from_string

router = APIRouter(tags=["pty_terminal"])


def _set_winsize(fd: int, rows: int, cols: int):
    """Set the terminal window size on a PTY file descriptor."""
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


@router.websocket("/api/pty/ws")
async def pty_websocket(websocket: WebSocket, token: str = ""):
    """Full PTY terminal over WebSocket.

    - Client sends raw keystrokes (binary or text).
    - Client can send JSON: {"type": "resize", "cols": N, "rows": N}
    - Server streams PTY output back as binary/text.
    """
    # Auth
    try:
        username = verify_token_from_string(token)
    except (ValueError, Exception):
        await websocket.close(code=4001, reason="Unauthorized")
        return

    await websocket.accept()

    # Spawn a bash shell via PTY
    master_fd, slave_fd = pty.openpty()

    # Default terminal size
    _set_winsize(master_fd, 24, 80)

    env = os.environ.copy()
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"
    env["LANG"] = "en_US.UTF-8"

    # Determine which user to run as
    # If running as root inside Docker, switch to 'claude' user
    # Start Claude Code CLI; fall back to bash if not available
    import shutil
    claude_path = shutil.which("claude")
    if claude_path:
        shell_cmd = [claude_path, "--dangerously-skip-permissions"]
    else:
        shell_cmd = ["/bin/bash", "--login"]
    pid = os.fork()

    if pid == 0:
        # Child process
        os.close(master_fd)
        os.setsid()

        # Set slave as controlling terminal
        fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)

        # Redirect stdio to slave PTY
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        if slave_fd > 2:
            os.close(slave_fd)

        # If running as root, switch to 'claude' user
        try:
            import pwd
            claude_user = pwd.getpwnam("claude")
            os.setgid(claude_user.pw_gid)
            os.setuid(claude_user.pw_uid)
            env["HOME"] = claude_user.pw_dir
            env["USER"] = "claude"
            env["LOGNAME"] = "claude"
            os.chdir(claude_user.pw_dir)
        except (KeyError, PermissionError):
            # 'claude' user doesn't exist or we can't switch; run as current user
            pass

        os.execvpe(shell_cmd[0], shell_cmd, env)
        # execvpe never returns
    else:
        # Parent process
        os.close(slave_fd)

        loop = asyncio.get_event_loop()
        read_event = asyncio.Event()

        # Register master_fd for reading via event loop
        def _on_readable():
            read_event.set()

        loop.add_reader(master_fd, _on_readable)

        async def read_pty():
            """Read from PTY and forward to WebSocket in small chunks."""
            CHUNK = 1024  # smaller chunks for smoother mobile rendering
            try:
                while True:
                    read_event.clear()
                    await read_event.wait()
                    try:
                        data = os.read(master_fd, 4096)
                        if not data:
                            break
                        # Send in small chunks so the browser can render progressively
                        for i in range(0, len(data), CHUNK):
                            await websocket.send_bytes(data[i:i + CHUNK])
                    except OSError:
                        break
            except Exception:
                pass

        async def write_pty():
            """Read from WebSocket and forward to PTY stdin."""
            try:
                while True:
                    msg = await websocket.receive()

                    if msg.get("type") == "websocket.disconnect":
                        break

                    raw = msg.get("bytes") or msg.get("text")
                    if raw is None:
                        continue

                    if isinstance(raw, str):
                        # Check if it's a JSON control message
                        if raw.startswith("{"):
                            try:
                                ctrl = json.loads(raw)
                                if ctrl.get("type") == "resize":
                                    cols = ctrl.get("cols", 80)
                                    rows = ctrl.get("rows", 24)
                                    _set_winsize(master_fd, rows, cols)
                                    # Send SIGWINCH to the shell process group
                                    os.kill(pid, signal.SIGWINCH)
                                    continue
                            except (json.JSONDecodeError, ValueError):
                                pass
                        raw = raw.encode("utf-8")

                    try:
                        os.write(master_fd, raw)
                    except OSError:
                        break
            except WebSocketDisconnect:
                pass
            except Exception:
                pass

        try:
            # Run read and write concurrently
            done, pending = await asyncio.wait(
                [asyncio.create_task(read_pty()), asyncio.create_task(write_pty())],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
        finally:
            # Cleanup
            loop.remove_reader(master_fd)
            try:
                os.close(master_fd)
            except OSError:
                pass

            # Terminate the shell process
            try:
                os.kill(pid, signal.SIGHUP)
            except ProcessLookupError:
                pass

            # Wait briefly, then force kill
            await asyncio.sleep(0.5)
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

            # Reap zombie process
            try:
                os.waitpid(pid, os.WNOHANG)
            except ChildProcessError:
                pass
