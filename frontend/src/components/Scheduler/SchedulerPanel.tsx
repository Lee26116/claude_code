import React, { useState, useEffect } from 'react';
import {
  Clock,
  Plus,
  Trash2,
  Play,
  ChevronDown,
  ChevronRight,
  Loader2,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { api } from '@/utils/api';

interface ScheduledTask {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  enabled: boolean;
  last_run: string | null;
  last_result: string | null;
}

const SchedulerPanel: React.FC = () => {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCron, setNewCron] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());
  const [runningTasks, setRunningTasks] = useState<Set<string>>(new Set());
  const [taskResults, setTaskResults] = useState<Record<string, string>>({});

  const fetchTasks = async () => {
    try {
      const data = await api.get<ScheduledTask[]>('/scheduler/tasks');
      setTasks(data);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const handleAdd = async () => {
    if (!newName.trim() || !newCron.trim() || !newPrompt.trim()) return;
    try {
      await api.post('/scheduler/tasks', {
        name: newName.trim(),
        cron: newCron.trim(),
        prompt: newPrompt.trim(),
      });
      setNewName('');
      setNewCron('');
      setNewPrompt('');
      setShowAddForm(false);
      await fetchTasks();
    } catch {
      // ignore
    }
  };

  const handleToggle = async (id: string) => {
    try {
      await api.post(`/scheduler/tasks/${id}/toggle`, {});
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t))
      );
    } catch {
      // ignore
    }
  };

  const handleRunNow = async (id: string) => {
    setRunningTasks((prev) => new Set(prev).add(id));
    try {
      const data = await api.post<{ last_result: string }>(`/scheduler/tasks/${id}/run`, {});
      setTaskResults((prev) => ({ ...prev, [id]: data.last_result }));
      setExpandedResults((prev) => new Set(prev).add(id));
      await fetchTasks();
    } catch {
      // ignore
    } finally {
      setRunningTasks((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/scheduler/tasks/${id}`);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch {
      // ignore
    }
  };

  const toggleResultExpanded = (id: string) => {
    setExpandedResults((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const formatTime = (ts: string | null) => {
    if (!ts) return 'Never';
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return ts;
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-950 rounded-lg border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-blue-400" />
          <h2 className="text-sm font-medium text-gray-200">Scheduled Tasks</h2>
          <span className="text-xs text-gray-500">({tasks.length})</span>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Task
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="p-4 border-b border-gray-800 bg-gray-900/50 space-y-3">
          <input
            type="text"
            placeholder="Task name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
            autoFocus
          />
          <input
            type="text"
            placeholder="Cron expression (e.g. 0 9 * * *)"
            value={newCron}
            onChange={(e) => setNewCron(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <textarea
            placeholder="Prompt to execute..."
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
            >
              Create Task
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setNewName('');
                setNewCron('');
                setNewPrompt('');
              }}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Task list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-12 text-gray-500 text-sm">
            No scheduled tasks. Create one to get started.
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {tasks.map((task) => {
              const isExpanded = expandedResults.has(task.id);
              const isRunning = runningTasks.has(task.id);
              const result = taskResults[task.id] || task.last_result;

              return (
                <div key={task.id} className="p-4">
                  <div className="flex items-start gap-3">
                    {/* Toggle */}
                    <button
                      onClick={() => handleToggle(task.id)}
                      className="mt-0.5 shrink-0"
                    >
                      {task.enabled ? (
                        <ToggleRight className="w-6 h-6 text-green-400" />
                      ) : (
                        <ToggleLeft className="w-6 h-6 text-gray-500" />
                      )}
                    </button>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${task.enabled ? 'text-gray-200' : 'text-gray-500'}`}>
                          {task.name}
                        </span>
                        <span className="px-1.5 py-0.5 bg-gray-800 text-gray-400 text-xs rounded font-mono">
                          {task.cron}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1 truncate">{task.prompt}</p>
                      <p className="text-xs text-gray-600 mt-1">
                        Last run: {formatTime(task.last_run)}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleRunNow(task.id)}
                        disabled={isRunning}
                        className="p-1.5 hover:bg-gray-800 rounded transition-colors text-gray-400 hover:text-green-400 disabled:opacity-50"
                        title="Run Now"
                      >
                        {isRunning ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => handleDelete(task.id)}
                        className="p-1.5 hover:bg-gray-800 rounded transition-colors text-gray-400 hover:text-red-400"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Expandable result */}
                  {result && (
                    <div className="mt-2 ml-9">
                      <button
                        onClick={() => toggleResultExpanded(task.id)}
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                        Last Result
                      </button>
                      {isExpanded && (
                        <pre className="mt-1 p-2 bg-gray-900 border border-gray-800 rounded text-xs text-gray-400 overflow-x-auto whitespace-pre-wrap max-h-48">
                          {result}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SchedulerPanel;
