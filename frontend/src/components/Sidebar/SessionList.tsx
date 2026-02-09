import { useEffect } from "react";
import { MessageSquare, Plus, Trash2 } from "lucide-react";
import { useChatStore, Session } from "@/stores/chatStore";
import { api } from "@/utils/api";

export default function SessionList() {
  const { sessions, currentSessionId, setSessions, setCurrentSession, setMessages } =
    useChatStore();

  const loadSessions = async () => {
    try {
      const data = await api.get<Session[]>("/sessions");
      setSessions(data);
    } catch (e) {
      console.error("Failed to load sessions:", e);
    }
  };

  useEffect(() => {
    loadSessions();
    const interval = setInterval(loadSessions, 10000);
    return () => clearInterval(interval);
  }, []);

  const selectSession = async (id: string) => {
    setCurrentSession(id);
    try {
      const data = await api.get<any>(`/sessions/${id}`);
      setMessages(data.messages || []);
    } catch (e) {
      console.error("Failed to load session:", e);
    }
  };

  const newSession = () => {
    setCurrentSession(null);
    setMessages([]);
  };

  const deleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm("确定删除这个会话？")) return;
    try {
      await api.delete(`/sessions/${id}`);
      if (currentSessionId === id) {
        setCurrentSession(null);
        setMessages([]);
      }
      loadSessions();
    } catch (e) {
      console.error("Failed to delete session:", e);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-gray-800">
        <button
          onClick={newSession}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600
                     hover:bg-blue-500 text-white rounded-lg transition-colors text-sm"
        >
          <Plus size={16} />
          新对话
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sessions.map((session) => (
          <div
            key={session.id}
            onClick={() => selectSession(session.id)}
            className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-800
                        transition-colors group ${
                          currentSessionId === session.id ? "bg-gray-800 border-l-2 border-blue-500" : ""
                        }`}
          >
            <MessageSquare size={16} className="text-gray-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-200 truncate">
                {session.title || "New Session"}
              </p>
              <p className="text-xs text-gray-500">{formatDate(session.updated_at)}</p>
            </div>
            <button
              onClick={(e) => deleteSession(e, session.id)}
              className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 text-gray-500
                         transition-all"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
