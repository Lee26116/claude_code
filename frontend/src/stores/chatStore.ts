import { create } from "zustand";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments: { filename: string; path: string }[];
  timestamp: string;
}

export interface StreamChunk {
  content: string;
  type: "text" | "status" | "command" | "error" | "tool_use" | "tool_result" | "result";
}

export interface Session {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  summary: string;
}

interface ChatState {
  sessions: Session[];
  currentSessionId: string | null;
  messages: Message[];
  streaming: boolean;
  streamChunks: StreamChunk[];

  setSessions: (sessions: Session[]) => void;
  setCurrentSession: (id: string | null) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  setStreaming: (streaming: boolean) => void;
  appendStreamChunk: (chunk: StreamChunk) => void;
  resetStreamChunks: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  streaming: false,
  streamChunks: [],

  setSessions: (sessions) => set({ sessions }),
  setCurrentSession: (id) => set({ currentSessionId: id }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  setStreaming: (streaming) => set({ streaming }),
  appendStreamChunk: (chunk) =>
    set((s) => ({ streamChunks: [...s.streamChunks, chunk] })),
  resetStreamChunks: () => set({ streamChunks: [] }),
}));
