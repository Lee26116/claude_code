import { useEffect, useRef, useCallback, useState, useImperativeHandle, forwardRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Upload, Loader2, FileUp, Paperclip, Send, ArrowDown, ChevronUp, ChevronDown, CornerDownLeft } from "lucide-react";
import { api } from "@/utils/api";
import "@xterm/xterm/css/xterm.css";

const RECONNECT_DELAY = 3000;

export interface ClaudeTerminalHandle {
  sendCommand: (cmd: string) => void;
}

const ClaudeTerminal = forwardRef<ClaudeTerminalHandle>((_props, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("disconnected");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadInfo, setUploadInfo] = useState("");
  const [mobileInput, setMobileInput] = useState("");
  const [showInput, setShowInput] = useState(true);

  useImperativeHandle(ref, () => ({
    sendCommand: (cmd: string) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(cmd);
      }
    },
  }));

  // Send raw escape sequence to terminal
  const sendKey = useCallback((seq: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(seq);
    }
  }, []);

  // Send text from mobile input bar
  const handleMobileSend = useCallback(() => {
    const text = mobileInput.trim();
    if (!text) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(text + "\n");
    }
    setMobileInput("");
    // Scroll terminal to bottom
    termRef.current?.scrollToBottom();
  }, [mobileInput]);

  // Scroll terminal to bottom
  const handleScrollToBottom = useCallback(() => {
    termRef.current?.scrollToBottom();
  }, []);

  // Upload a file and type its path into the terminal
  const handleFileUpload = useCallback(async (file: File) => {
    setUploading(true);
    setUploadInfo(file.name);
    try {
      const result = await api.uploadFile(file);
      // Type the file path into the terminal
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(result.path);
      }
      const term = termRef.current;
      if (term) {
        // Show a subtle notification above the terminal
      }
    } catch (e) {
      const term = termRef.current;
      if (term) {
        term.write(`\r\n\x1b[31m[Upload failed: ${file.name}]\x1b[0m`);
      }
    } finally {
      setUploading(false);
      setUploadInfo("");
    }
  }, []);

  // Handle multiple files
  const handleFiles = useCallback((files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      handleFileUpload(file);
    }
  }, [handleFileUpload]);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  // Paste handler (for screenshots from clipboard)
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }

      if (files.length > 0) {
        // Only intercept paste if it contains files (images)
        // Let normal text paste go through to xterm
        e.preventDefault();
        e.stopPropagation();
        handleFiles(files);
      }
    };

    wrapper.addEventListener("paste", handlePaste, true);
    return () => wrapper.removeEventListener("paste", handlePaste, true);
  }, [handleFiles]);

  const connect = useCallback(() => {
    const token = localStorage.getItem("token");
    if (!token || !termRef.current) return;

    setStatus("connecting");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/api/pty/ws?token=${token}`
    );
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      setStatus("connected");
      const term = termRef.current;
      if (term) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    ws.onmessage = (event) => {
      const term = termRef.current;
      if (!term) return;
      if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data));
      } else {
        term.write(event.data);
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      const term = termRef.current;
      if (term) {
        term.write("\r\n\x1b[33m[Disconnected. Reconnecting...]\x1b[0m\r\n");
      }
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
      theme: {
        background: "#030712",
        foreground: "#e5e7eb",
        cursor: "#60a5fa",
        selectionBackground: "#374151",
        black: "#1f2937",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#f3f4f6",
        brightBlack: "#6b7280",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#facc15",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#ffffff",
      },
      allowProposedApi: true,
      scrollback: 5000,
      convertEol: false,
      scrollSensitivity: 3,
      fastScrollSensitivity: 10,
      smoothScrollDuration: 0,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);

    // WebGL renderer for much better performance
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      term.loadAddon(webglAddon);
    } catch {
      // WebGL not available, fall back to default canvas renderer
    }

    termRef.current = term;
    fitRef.current = fitAddon;

    // Fit after layout settles — mobile needs a delay
    const doFit = () => {
      try {
        fitAddon.fit();
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN && term.cols && term.rows) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      } catch {}
    };
    doFit();
    // Retry fit for mobile where layout is async
    const t1 = setTimeout(doFit, 100);
    const t2 = setTimeout(doFit, 500);
    const t3 = setTimeout(doFit, 1500);

    term.onData((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    term.onBinary((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        const buffer = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) {
          buffer[i] = data.charCodeAt(i) & 255;
        }
        ws.send(buffer.buffer);
      }
    });

    connect();

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN && term.cols && term.rows) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      } catch {}
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      resizeObserver.disconnect();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [connect]);

  return (
    <div
      ref={wrapperRef}
      className={`relative flex flex-col h-full min-w-0 overflow-hidden bg-gray-950 transition-colors ${
        dragOver ? "ring-2 ring-blue-500 ring-inset" : ""
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-blue-950/40 pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-blue-400">
            <Upload size={36} />
            <span className="text-sm font-medium">Drop file to upload & paste path</span>
          </div>
        </div>
      )}

      {/* Upload indicator */}
      {uploading && (
        <div className="absolute top-10 right-3 z-20 flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg shadow-lg text-xs text-gray-300">
          <Loader2 size={12} className="animate-spin text-blue-400" />
          <FileUp size={12} />
          <span className="max-w-[150px] truncate">{uploadInfo}</span>
        </div>
      )}

      {/* Status bar */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-gray-800 text-xs text-gray-500">
        <span
          className={`w-2 h-2 rounded-full ${
            status === "connected"
              ? "bg-green-500"
              : status === "connecting"
              ? "bg-yellow-500 animate-pulse"
              : "bg-red-500"
          }`}
        />
        <span>
          {status === "connected"
            ? "Connected"
            : status === "connecting"
            ? "Connecting..."
            : "Disconnected"}
        </span>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="ml-auto flex items-center gap-1.5 text-gray-600 hover:text-gray-400 transition-colors"
        >
          <Paperclip size={12} />
          <span className="hidden sm:inline">Drop or click to upload</span>
          <span className="sm:hidden">Upload</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              handleFiles(e.target.files);
              e.target.value = "";
            }
          }}
        />
      </div>

      {/* Terminal container */}
      <div ref={containerRef} className="flex-1 w-full min-h-0 min-w-0 overflow-hidden px-1" />

      {/* Fixed input bar — always visible */}
      <div className="border-t border-gray-800 bg-gray-900 px-2 py-1.5 flex flex-col gap-1.5">
        {/* Arrow keys + special keys row */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => sendKey("\x1b[A")}
            className="flex items-center justify-center w-9 h-8 bg-gray-800 border border-gray-700 rounded-md text-gray-400 hover:text-gray-200 hover:border-gray-500 active:bg-gray-700 transition-colors"
            title="Up"
          >
            <ChevronUp size={16} />
          </button>
          <button
            onClick={() => sendKey("\x1b[B")}
            className="flex items-center justify-center w-9 h-8 bg-gray-800 border border-gray-700 rounded-md text-gray-400 hover:text-gray-200 hover:border-gray-500 active:bg-gray-700 transition-colors"
            title="Down"
          >
            <ChevronDown size={16} />
          </button>
          <button
            onClick={() => sendKey("\r")}
            className="flex items-center justify-center h-8 px-2.5 bg-gray-800 border border-gray-700 rounded-md text-gray-400 hover:text-gray-200 hover:border-gray-500 active:bg-gray-700 transition-colors text-xs gap-1"
            title="Enter"
          >
            <CornerDownLeft size={13} />
            <span>Enter</span>
          </button>
          <button
            onClick={() => sendKey("\x1b")}
            className="flex items-center justify-center h-8 px-2.5 bg-gray-800 border border-gray-700 rounded-md text-gray-400 hover:text-gray-200 hover:border-gray-500 active:bg-gray-700 transition-colors text-xs"
            title="Escape"
          >
            Esc
          </button>
          <button
            onClick={() => sendKey("\x03")}
            className="flex items-center justify-center h-8 px-2.5 bg-gray-800 border border-gray-700 rounded-md text-gray-400 hover:text-red-400 hover:border-gray-500 active:bg-gray-700 transition-colors text-xs"
            title="Ctrl+C"
          >
            Ctrl+C
          </button>
          <button
            onClick={() => sendKey("c")}
            className="flex items-center justify-center w-9 h-8 bg-gray-800 border border-gray-700 rounded-md text-gray-400 hover:text-gray-200 hover:border-gray-500 active:bg-gray-700 transition-colors text-xs font-mono"
            title="c"
          >
            c
          </button>
          <div className="flex-1" />
          <button
            onClick={handleScrollToBottom}
            className="flex items-center justify-center w-9 h-8 bg-gray-800 border border-gray-700 rounded-md text-gray-400 hover:text-gray-200 hover:border-gray-500 active:bg-gray-700 transition-colors"
            title="Scroll to bottom"
          >
            <ArrowDown size={14} />
          </button>
        </div>
        {/* Text input row */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={mobileInput}
            onChange={(e) => setMobileInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleMobileSend();
              }
            }}
            placeholder="Type a message..."
            className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleMobileSend}
            disabled={!mobileInput.trim()}
            className="p-2 text-blue-500 hover:text-blue-400 disabled:text-gray-700 transition-colors shrink-0"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
});

ClaudeTerminal.displayName = "ClaudeTerminal";
export default ClaudeTerminal;
