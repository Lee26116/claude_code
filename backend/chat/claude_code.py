import asyncio
import json
import os
import pwd
from typing import AsyncGenerator, Tuple


def _get_claude_user():
    """Get uid/gid for the 'claude' user (non-root) to run CLI commands."""
    try:
        pw = pwd.getpwnam("claude")
        return pw.pw_uid, pw.pw_gid
    except KeyError:
        return None, None


def _parse_stream_event(line: str) -> list[Tuple[str, str]]:
    """Parse a stream-json event line and return (content, type) tuples."""
    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        return [(line, "text")] if line.strip() else []

    event_type = event.get("type", "")
    results = []

    if event_type == "assistant":
        msg = event.get("message", {})
        content_blocks = msg.get("content", [])
        for block in content_blocks:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                text = block.get("text", "")
                if text:
                    results.append((text, "text"))
            elif block.get("type") == "tool_use":
                tool_name = block.get("name", "unknown")
                tool_input = block.get("input", {})
                # Show what tool is being used
                desc = tool_input.get("description", "") or tool_input.get("command", "") or tool_input.get("pattern", "") or tool_input.get("query", "") or tool_input.get("file_path", "") or tool_input.get("prompt", "")
                if desc:
                    results.append((f"[{tool_name}] {desc}", "tool_use"))
                else:
                    results.append((f"[{tool_name}]", "tool_use"))

    elif event_type == "user":
        # Tool result
        tool_result = event.get("tool_use_result")
        msg = event.get("message", {})
        content_blocks = msg.get("content", [])

        if isinstance(tool_result, dict):
            stdout = tool_result.get("stdout", "")
            stderr = tool_result.get("stderr", "")
            if stdout:
                display = stdout[:500] + ("..." if len(stdout) > 500 else "")
                results.append((display, "tool_result"))
            if stderr:
                display = stderr[:300] + ("..." if len(stderr) > 300 else "")
                results.append((display, "error"))
        elif isinstance(tool_result, str) and tool_result:
            display = tool_result[:500] + ("..." if len(tool_result) > 500 else "")
            results.append((display, "tool_result"))
        else:
            # Fallback: parse from content blocks
            for block in content_blocks:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "tool_result":
                    content = block.get("content", "")
                    if isinstance(content, str) and content:
                        display = content[:500] + ("..." if len(content) > 500 else "")
                        results.append((display, "tool_result"))
                    elif isinstance(content, list):
                        # content can be a list of content blocks
                        for item in content:
                            if isinstance(item, dict) and item.get("type") == "text":
                                text = item.get("text", "")
                                if text:
                                    display = text[:500] + ("..." if len(text) > 500 else "")
                                    results.append((display, "tool_result"))

    elif event_type == "result":
        # Final result - we use this as the definitive text
        result_text = event.get("result", "")
        if result_text:
            results.append((result_text, "result"))

    return results


async def call_claude_code(
    prompt: str, working_dir: str = None
) -> AsyncGenerator[Tuple[str, str], None]:
    """
    Call Claude Code CLI with stream-json output and yield (chunk, type) tuples.
    Types: "text", "tool_use", "tool_result", "error", "result"
    """
    uid, gid = _get_claude_user()

    def _demote():
        if uid is not None:
            os.setgid(gid)
            os.setuid(uid)

    cmd = ["claude", "-p", prompt, "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"]

    env = os.environ.copy()
    if uid is not None:
        env["HOME"] = "/home/claude"
        env["USER"] = "claude"

    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=working_dir,
        preexec_fn=_demote if uid is not None else None,
        env=env,
    )

    buffer = ""
    while True:
        chunk = await process.stdout.read(4096)
        if not chunk:
            break
        text = chunk.decode("utf-8", errors="replace")
        buffer += text

        # Process complete JSON lines
        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            if not line.strip():
                continue
            for content, chunk_type in _parse_stream_event(line):
                yield (content, chunk_type)

    # Flush remaining buffer
    if buffer.strip():
        for content, chunk_type in _parse_stream_event(buffer):
            yield (content, chunk_type)

    await process.wait()

    if process.returncode != 0:
        stderr = await process.stderr.read()
        if stderr:
            yield (stderr.decode("utf-8", errors="replace"), "error")
