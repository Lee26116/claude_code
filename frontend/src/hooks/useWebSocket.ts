import { useCallback, useRef } from "react";
import { useChatStore } from "@/stores/chatStore";

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const sentFirstRef = useRef(false);
  const { setStreaming, appendStreamChunk, resetStreamChunks, addMessage, setCurrentSession } =
    useChatStore();

  const connect = useCallback(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/chat/stream?token=${token}`);

    ws.onopen = () => {
      console.log("WebSocket connected");
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "chunk":
          appendStreamChunk({
            content: data.content,
            type: data.chunk_type || "text",
          });
          break;
        case "done": {
          setStreaming(false);
          const chunks = useChatStore.getState().streamChunks;
          // Use the "result" chunk as the final message, fallback to all text chunks
          const resultChunk = chunks.find((c) => c.type === "result");
          const content = resultChunk
            ? resultChunk.content
            : chunks.filter((c) => c.type === "text").map((c) => c.content).join("");
          if (content) {
            addMessage({
              id: Date.now().toString(),
              role: "assistant",
              content,
              attachments: [],
              timestamp: new Date().toISOString(),
            });
          }
          resetStreamChunks();
          if (data.session_id) {
            setCurrentSession(data.session_id);
          }
          break;
        }
        case "session_id":
          setCurrentSession(data.session_id);
          sentFirstRef.current = true;
          break;
        case "error":
          setStreaming(false);
          resetStreamChunks();
          addMessage({
            id: Date.now().toString(),
            role: "assistant",
            content: `Error: ${data.message}`,
            attachments: [],
            timestamp: new Date().toISOString(),
          });
          break;
      }
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected, reconnecting in 3s...");
      setTimeout(connect, 3000);
    };

    wsRef.current = ws;
  }, []);

  const sendMessage = useCallback(
    (content: string, attachments: { filename: string; path: string }[] = []) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      const sessionId = useChatStore.getState().currentSessionId;
      const isFirstMessage = !sessionId || !sentFirstRef.current;

      addMessage({
        id: Date.now().toString(),
        role: "user",
        content,
        attachments,
        timestamp: new Date().toISOString(),
      });

      setStreaming(true);
      resetStreamChunks();

      wsRef.current.send(
        JSON.stringify({
          type: "message",
          content,
          attachments,
          session_id: sessionId,
          is_first_message: isFirstMessage,
        })
      );
    },
    []
  );

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const resetFirstMessage = useCallback(() => {
    sentFirstRef.current = false;
  }, []);

  return { connect, disconnect, sendMessage, resetFirstMessage };
}
