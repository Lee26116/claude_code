import { useState, useEffect, useCallback } from "react";
import {
  Server,
  Plus,
  Trash2,
  Brain,
  Save,
  Edit3,
  X,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  ExternalLink,
  RefreshCw,
  KeyRound,
  Eye,
  EyeOff,
  Copy,
} from "lucide-react";
import { api } from "@/utils/api";

// ==================== Types ====================

interface ServerBookmark {
  id: string;
  name: string;
  host: string;
  user: string;
  description: string;
}

interface SchedulerTask {
  id: string;
  name: string;
  cron: string;
  enabled: boolean;
  last_run: string | null;
  last_result: string | null;
}

interface QuickPanelProps {
  onSendToTerminal?: (command: string) => void;
}

// ==================== Server Bookmarks ====================

function ServerSection({ onSendToTerminal }: { onSendToTerminal?: (cmd: string) => void }) {
  const [servers, setServers] = useState<ServerBookmark[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [user, setUser] = useState("root");
  const [desc, setDesc] = useState("");

  useEffect(() => {
    api.get<ServerBookmark[]>("/bookmarks/servers").then(setServers).catch(() => setServers([]));
  }, []);

  const handleAdd = async () => {
    if (!name.trim() || !host.trim()) return;
    try {
      const s = await api.post<ServerBookmark>("/bookmarks/servers", {
        name: name.trim(),
        host: host.trim(),
        user: user.trim() || "root",
        description: desc.trim(),
      });
      setServers((prev) => [...prev, s]);
      setName("");
      setHost("");
      setUser("root");
      setDesc("");
      setShowAdd(false);
    } catch {}
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/bookmarks/servers/${id}`);
      setServers((prev) => prev.filter((s) => s.id !== id));
    } catch {}
  };

  const handleConnect = (server: ServerBookmark) => {
    onSendToTerminal?.(`ssh ${server.user}@${server.host}\n`);
  };

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
          <Server size={12} />
          Servers
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
        >
          {showAdd ? <X size={14} /> : <Plus size={14} />}
        </button>
      </div>

      {showAdd && (
        <div className="px-4 pb-3 space-y-2">
          <input
            placeholder="Name (e.g. Production)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
            autoFocus
          />
          <div className="flex gap-2">
            <input
              placeholder="user"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              className="w-16 px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
            <input
              placeholder="host / IP"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className="flex-1 px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>
          <input
            placeholder="Description (optional)"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleAdd}
            className="w-full py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors"
          >
            Add Server
          </button>
        </div>
      )}

      <div className="px-2">
        {servers.length === 0 && !showAdd && (
          <p className="px-2 py-3 text-xs text-gray-600 text-center">No servers saved</p>
        )}
        {servers.map((s) => (
          <div
            key={s.id}
            className="group flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-800/60 cursor-pointer transition-colors"
            onClick={() => handleConnect(s)}
          >
            <div className="w-2 h-2 rounded-full bg-green-500/60 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-200 truncate">{s.name}</div>
              <div className="text-xs text-gray-500 truncate font-mono">
                {s.user}@{s.host}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(s.id);
              }}
              className="p-1 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ==================== Secrets Vault ====================

interface SecretItem {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

function SecretsSection() {
  const [secrets, setSecrets] = useState<SecretItem[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [desc, setDesc] = useState("");
  const [revealedValues, setRevealedValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get<SecretItem[]>("/secrets").then(setSecrets).catch(() => setSecrets([]));
  }, []);

  const handleAdd = async () => {
    if (!name.trim() || !value.trim()) return;
    try {
      const s = await api.post<SecretItem>("/secrets", {
        name: name.trim(),
        value: value.trim(),
        description: desc.trim(),
      });
      setSecrets((prev) => [s, ...prev.filter((p) => p.name !== s.name)]);
      setName("");
      setValue("");
      setDesc("");
      setShowAdd(false);
    } catch {}
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/secrets/${id}`);
      setSecrets((prev) => prev.filter((s) => s.id !== id));
      setRevealedValues((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch {}
  };

  const handleReveal = async (id: string) => {
    if (revealedValues[id] !== undefined) {
      setRevealedValues((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    try {
      const data = await api.get<{ value: string }>(`/secrets/${id}/reveal`);
      setRevealedValues((prev) => ({ ...prev, [id]: data.value }));
    } catch {}
  };

  const handleCopy = async (id: string) => {
    let val = revealedValues[id];
    if (!val) {
      try {
        const data = await api.get<{ value: string }>(`/secrets/${id}/reveal`);
        val = data.value;
      } catch {
        return;
      }
    }
    navigator.clipboard.writeText(val);
  };

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-xs font-medium text-gray-500 uppercase tracking-wider hover:text-gray-300 transition-colors"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <KeyRound size={12} />
          Secrets
        </button>
        <button
          onClick={() => { setShowAdd(!showAdd); setExpanded(true); }}
          className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
        >
          {showAdd ? <X size={14} /> : <Plus size={14} />}
        </button>
      </div>

      {expanded && (
        <>
          {showAdd && (
            <div className="px-4 pb-3 space-y-2">
              <input
                placeholder="NAME (e.g. OPENAI_API_KEY)"
                value={name}
                onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
                className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono"
                autoFocus
              />
              <input
                placeholder="Value (sk-...)"
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono"
              />
              <input
                placeholder="Description (optional)"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={handleAdd}
                className="w-full py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors"
              >
                Save Secret
              </button>
            </div>
          )}

          <div className="px-2">
            {secrets.length === 0 && !showAdd && (
              <p className="px-2 py-3 text-xs text-gray-600 text-center">No secrets saved</p>
            )}
            {secrets.map((s) => (
              <div
                key={s.id}
                className="group px-2 py-2 rounded-lg hover:bg-gray-800/60 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono text-cyan-400 truncate">{s.name}</div>
                    {s.description && (
                      <div className="text-[10px] text-gray-600 truncate">{s.description}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                    <button
                      onClick={() => handleReveal(s.id)}
                      className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
                      title={revealedValues[s.id] !== undefined ? "Hide" : "Reveal"}
                    >
                      {revealedValues[s.id] !== undefined ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                    <button
                      onClick={() => handleCopy(s.id)}
                      className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
                      title="Copy"
                    >
                      <Copy size={12} />
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="p-1 text-gray-500 hover:text-red-400 transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div className="text-[11px] font-mono text-gray-500 mt-0.5">
                  {revealedValues[s.id] !== undefined ? revealedValues[s.id] : "••••••••••••"}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ==================== Memory (CLAUDE.md) ====================

function MemorySection() {
  const [content, setContent] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const loadMemory = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ content: string }>("/files/read?path=/home/claude/.claude/CLAUDE.md");
      setContent(data.content);
    } catch {
      setContent(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMemory();
  }, [loadMemory]);

  const handleEdit = () => {
    setEditContent(content || "");
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.post("/files/write", {
        path: "/home/claude/.claude/CLAUDE.md",
        content: editContent,
      });
      setContent(editContent);
      setEditing(false);
    } catch {
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-xs font-medium text-gray-500 uppercase tracking-wider hover:text-gray-300 transition-colors"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Brain size={12} />
          Memory
        </button>
        <div className="flex items-center gap-1">
          {!editing && content !== null && (
            <button
              onClick={handleEdit}
              className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
            >
              <Edit3 size={12} />
            </button>
          )}
          <button
            onClick={loadMemory}
            className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-3">
          {loading ? (
            <div className="flex items-center gap-2 py-3 text-xs text-gray-500">
              <Loader2 size={12} className="animate-spin" />
              Loading...
            </div>
          ) : editing ? (
            <div className="space-y-2">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full h-40 px-2.5 py-2 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 font-mono resize-none focus:outline-none focus:border-blue-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs rounded transition-colors"
                >
                  {saving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
                  Save
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : content ? (
            <pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto bg-gray-800/50 rounded p-2 leading-relaxed">
              {content}
            </pre>
          ) : (
            <p className="text-xs text-gray-600 py-2">
              No memory yet. Tell Claude to remember something, or click edit to add manually.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ==================== Recent Scheduler Tasks ====================

function RecentTasksSection() {
  const [tasks, setTasks] = useState<SchedulerTask[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [expandedResult, setExpandedResult] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<SchedulerTask[]>("/scheduler/tasks")
      .then((data) => setTasks(data.filter((t) => t.last_run).slice(0, 5)))
      .catch(() => setTasks([]));
  }, []);

  const formatTime = (ts: string | null) => {
    if (!ts) return "";
    try {
      const d = new Date(ts);
      const now = new Date();
      if (d.toDateString() === now.toDateString()) {
        return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      }
      return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
      return ts;
    }
  };

  if (tasks.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider hover:text-gray-300 transition-colors w-full text-left"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Clock size={12} />
        Recent Tasks
      </button>

      {expanded && (
        <div className="px-2 pb-2">
          {tasks.map((task) => (
            <div key={task.id} className="px-2 py-1.5">
              <button
                onClick={() => setExpandedResult(expandedResult === task.id ? null : task.id)}
                className="flex items-center gap-2 w-full text-left"
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    task.last_result?.startsWith("Error") ? "bg-red-500" : "bg-green-500"
                  }`}
                />
                <span className="text-xs text-gray-300 truncate flex-1">{task.name}</span>
                <span className="text-[10px] text-gray-600 shrink-0">{formatTime(task.last_run)}</span>
              </button>
              {expandedResult === task.id && task.last_result && (
                <pre className="mt-1 ml-3.5 p-2 bg-gray-800/50 rounded text-[10px] text-gray-500 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {task.last_result}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ==================== Main QuickPanel ====================

export default function QuickPanel({ onSendToTerminal }: QuickPanelProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto divide-y divide-gray-800/60">
        <ServerSection onSendToTerminal={onSendToTerminal} />
        <SecretsSection />
        <MemorySection />
        <RecentTasksSection />
      </div>
    </div>
  );
}
