import { useState, useEffect, useRef, useCallback } from "react";
import { TerminalSquare } from "lucide-react";

interface TerminalLine {
  type: "input" | "output" | "prompt";
  content: string;
}

const QUICK_COMMANDS = ["ls", "git status", "cd ..", "pwd", "clear"];

export default function TerminalPanel() {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [input, setInput] = useState("");
  const [cwd, setCwd] = useState("~");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const connect = useCallback(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/api/terminal/ws?token=${token}`
    );

    ws.onopen = () => {
      console.log("Terminal WebSocket connected");
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "prompt":
          setCwd(data.cwd);
          break;
        case "output":
          setLines((prev) => [...prev, { type: "output", content: data.content }]);
          break;
        case "exit":
          setRunning(false);
          if (data.cwd) setCwd(data.cwd);
          break;
      }
    };

    ws.onclose = () => {
      console.log("Terminal disconnected, reconnecting in 3s...");
      setTimeout(connect, 3000);
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  const sendCommand = (cmd: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!cmd.trim()) return;

    if (cmd.trim() === "clear") {
      setLines([]);
      return;
    }

    setLines((prev) => [
      ...prev,
      { type: "prompt", content: `${shortPath(cwd)} $` },
      { type: "input", content: cmd },
    ]);
    setRunning(true);
    setHistory((prev) => [...prev, cmd]);
    setHistoryIdx(-1);

    wsRef.current.send(JSON.stringify({ type: "command", content: cmd }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendCommand(input);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const newIdx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(newIdx);
      setInput(history[newIdx]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx === -1) return;
      const newIdx = historyIdx + 1;
      if (newIdx >= history.length) {
        setHistoryIdx(-1);
        setInput("");
      } else {
        setHistoryIdx(newIdx);
        setInput(history[newIdx]);
      }
    }
  };

  const shortPath = (p: string) => {
    const home = "/root";
    if (p === home) return "~";
    if (p.startsWith(home + "/")) return "~" + p.slice(home.length);
    return p;
  };

  return (
    <div
      className="flex flex-col h-full bg-gray-950 font-mono text-sm"
      onClick={() => inputRef.current?.focus()}
    >
      {/* Terminal output */}
      <div className="flex-1 overflow-y-auto p-4 space-y-0">
        {lines.length === 0 && (
          <div className="text-gray-600 flex items-center gap-2">
            <TerminalSquare size={16} />
            Terminal ready. Type a command to begin.
          </div>
        )}
        {lines.map((line, i) => {
          if (line.type === "prompt") {
            return (
              <span key={i} className="text-green-400">
                {line.content}{" "}
              </span>
            );
          }
          if (line.type === "input") {
            return (
              <span key={i} className="text-white">
                {line.content}
                {"\n"}
              </span>
            );
          }
          return (
            <pre key={i} className="text-gray-300 whitespace-pre-wrap m-0">
              {line.content}
            </pre>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Quick commands (mobile friendly) */}
      <div className="flex gap-1 px-4 py-1 border-t border-gray-800 overflow-x-auto md:hidden">
        {QUICK_COMMANDS.map((cmd) => (
          <button
            key={cmd}
            onClick={() => sendCommand(cmd)}
            className="px-2 py-1 text-xs bg-gray-800 text-gray-400 rounded hover:bg-gray-700
                       hover:text-gray-200 whitespace-nowrap flex-shrink-0"
          >
            {cmd}
          </button>
        ))}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 px-4 py-3 border-t border-gray-800"
      >
        <span className="text-green-400 flex-shrink-0">{shortPath(cwd)} $</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={running}
          autoFocus
          className="flex-1 bg-transparent text-white outline-none placeholder-gray-600"
          placeholder={running ? "Running..." : "Enter command..."}
        />
      </form>
    </div>
  );
}
