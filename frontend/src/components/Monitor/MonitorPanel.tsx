import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Plus,
  Trash2,
  Eye,
  Loader2,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  ChevronRight,
  Shield,
} from 'lucide-react';
import { api } from '@/utils/api';

interface Monitor {
  id: string;
  name: string;
  log_path: string;
  pattern: string;
  enabled: boolean;
  auto_fix: boolean;
  last_check: string | null;
}

interface Alert {
  content: string;
  created_at: string;
}

const MonitorPanel: React.FC = () => {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLogPath, setNewLogPath] = useState('');
  const [newPattern, setNewPattern] = useState('');
  const [newAutoFix, setNewAutoFix] = useState(false);
  const [expandedAlerts, setExpandedAlerts] = useState<Set<string>>(new Set());
  const [alertsMap, setAlertsMap] = useState<Record<string, Alert[]>>({});
  const [checkingMonitors, setCheckingMonitors] = useState<Set<string>>(new Set());
  const [loadingAlerts, setLoadingAlerts] = useState<Set<string>>(new Set());

  const fetchMonitors = async () => {
    try {
      const data = await api.get<Monitor[]>('/monitors');
      setMonitors(data);
    } catch {
      setMonitors([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMonitors();
  }, []);

  const handleAdd = async () => {
    if (!newName.trim() || !newLogPath.trim() || !newPattern.trim()) return;
    try {
      await api.post('/monitors', {
        name: newName.trim(),
        log_path: newLogPath.trim(),
        pattern: newPattern.trim(),
        auto_fix: newAutoFix,
      });
      setNewName('');
      setNewLogPath('');
      setNewPattern('');
      setNewAutoFix(false);
      setShowAddForm(false);
      await fetchMonitors();
    } catch {
      // ignore
    }
  };

  const handleToggle = async (id: string) => {
    try {
      await api.post(`/monitors/${id}/toggle`, {});
      setMonitors((prev) =>
        prev.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m))
      );
    } catch {
      // ignore
    }
  };

  const handleCheckNow = async (id: string) => {
    setCheckingMonitors((prev) => new Set(prev).add(id));
    try {
      const data = await api.post<{ alerts: Alert[] }>(`/monitors/${id}/check`, {});
      setAlertsMap((prev) => ({ ...prev, [id]: data.alerts }));
      setExpandedAlerts((prev) => new Set(prev).add(id));
      await fetchMonitors();
    } catch {
      // ignore
    } finally {
      setCheckingMonitors((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleViewAlerts = async (id: string) => {
    if (expandedAlerts.has(id)) {
      setExpandedAlerts((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      return;
    }

    setLoadingAlerts((prev) => new Set(prev).add(id));
    try {
      const data = await api.get<Alert[]>(`/monitors/${id}/alerts`);
      setAlertsMap((prev) => ({ ...prev, [id]: data }));
      setExpandedAlerts((prev) => new Set(prev).add(id));
    } catch {
      // ignore
    } finally {
      setLoadingAlerts((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/monitors/${id}`);
      setMonitors((prev) => prev.filter((m) => m.id !== id));
    } catch {
      // ignore
    }
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
          <Shield className="w-5 h-5 text-orange-400" />
          <h2 className="text-sm font-medium text-gray-200">Error Monitors</h2>
          <span className="text-xs text-gray-500">({monitors.length})</span>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Monitor
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="p-4 border-b border-gray-800 bg-gray-900/50 space-y-3">
          <input
            type="text"
            placeholder="Monitor name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-orange-500"
            autoFocus
          />
          <input
            type="text"
            placeholder="Log file path (e.g. /var/log/app.log)"
            value={newLogPath}
            onChange={(e) => setNewLogPath(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-orange-500"
          />
          <input
            type="text"
            placeholder="Pattern (regex, e.g. ERROR|FATAL)"
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-orange-500 font-mono"
          />
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={newAutoFix}
              onChange={(e) => setNewAutoFix(e.target.checked)}
              className="w-4 h-4 bg-gray-800 border-gray-600 rounded text-orange-500 focus:ring-orange-500 focus:ring-offset-gray-900"
            />
            <span className="text-sm text-gray-300">Auto-fix with Claude</span>
          </label>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white text-sm rounded-lg transition-colors"
            >
              Create Monitor
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setNewName('');
                setNewLogPath('');
                setNewPattern('');
                setNewAutoFix(false);
              }}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Monitor list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : monitors.length === 0 ? (
          <div className="text-center py-12 text-gray-500 text-sm">
            No monitors configured. Add one to start watching for errors.
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {monitors.map((monitor) => {
              const isChecking = checkingMonitors.has(monitor.id);
              const isAlertsExpanded = expandedAlerts.has(monitor.id);
              const isLoadingAlerts = loadingAlerts.has(monitor.id);
              const alerts = alertsMap[monitor.id] || [];

              return (
                <div key={monitor.id} className="p-4">
                  <div className="flex items-start gap-3">
                    {/* Toggle */}
                    <button
                      onClick={() => handleToggle(monitor.id)}
                      className="mt-0.5 shrink-0"
                    >
                      {monitor.enabled ? (
                        <ToggleRight className="w-6 h-6 text-green-400" />
                      ) : (
                        <ToggleLeft className="w-6 h-6 text-gray-500" />
                      )}
                    </button>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-medium ${monitor.enabled ? 'text-gray-200' : 'text-gray-500'}`}>
                          {monitor.name}
                        </span>
                        {monitor.auto_fix && (
                          <span className="px-1.5 py-0.5 bg-orange-900/40 text-orange-400 text-xs rounded">
                            auto-fix
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-1 truncate font-mono">
                        {monitor.log_path}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Pattern: <code className="text-gray-400">{monitor.pattern}</code>
                      </p>
                      <p className="text-xs text-gray-600 mt-1">
                        Last check: {formatTime(monitor.last_check)}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleCheckNow(monitor.id)}
                        disabled={isChecking}
                        className="p-1.5 hover:bg-gray-800 rounded transition-colors text-gray-400 hover:text-orange-400 disabled:opacity-50"
                        title="Check Now"
                      >
                        {isChecking ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <AlertTriangle className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => handleViewAlerts(monitor.id)}
                        className="p-1.5 hover:bg-gray-800 rounded transition-colors text-gray-400 hover:text-blue-400"
                        title="View Alerts"
                      >
                        {isLoadingAlerts ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => handleDelete(monitor.id)}
                        className="p-1.5 hover:bg-gray-800 rounded transition-colors text-gray-400 hover:text-red-400"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Alerts section */}
                  {isAlertsExpanded && (
                    <div className="mt-3 ml-9">
                      <button
                        onClick={() => handleViewAlerts(monitor.id)}
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors mb-2"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                        Alerts ({alerts.length})
                      </button>
                      {alerts.length === 0 ? (
                        <p className="text-xs text-gray-600">No alerts found.</p>
                      ) : (
                        <div className="space-y-1.5 max-h-48 overflow-y-auto">
                          {alerts.map((alert, idx) => (
                            <div
                              key={idx}
                              className="p-2 bg-gray-900 border border-gray-800 rounded text-xs"
                            >
                              <p className="text-red-400 font-mono whitespace-pre-wrap break-all">
                                {alert.content}
                              </p>
                              <p className="text-gray-600 mt-1">{formatTime(alert.created_at)}</p>
                            </div>
                          ))}
                        </div>
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

export default MonitorPanel;
