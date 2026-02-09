import { useState, useRef, useCallback } from "react";
import { LogOut, Menu, X, TerminalSquare, FolderOpen, Search, Clock, Activity, PanelLeftClose, PanelLeft } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import ClaudeTerminal, { ClaudeTerminalHandle } from "@/components/ClaudeTerminal/ClaudeTerminal";
import TerminalPanel from "@/components/Terminal/TerminalPanel";
import FileBrowser from "@/components/Files/FileBrowser";
import SchedulerPanel from "@/components/Scheduler/SchedulerPanel";
import MonitorPanel from "@/components/Monitor/MonitorPanel";
import SearchPanel from "@/components/Search/SearchPanel";
import QuickPanel from "@/components/Sidebar/QuickPanel";
import MobileNav from "@/components/Layout/MobileNav";

type Tab = "claude" | "terminal" | "files" | "search" | "scheduler" | "monitor";

const TABS: { id: Tab; label: string; icon: typeof TerminalSquare }[] = [
  { id: "claude", label: "Claude", icon: TerminalSquare },
  { id: "terminal", label: "Terminal", icon: TerminalSquare },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "search", label: "Search", icon: Search },
  { id: "scheduler", label: "Scheduler", icon: Clock },
  { id: "monitor", label: "Monitor", icon: Activity },
];

export default function MainLayout() {
  const { logout } = useAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("claude");
  const terminalRef = useRef<ClaudeTerminalHandle>(null);

  const handleSendToTerminal = useCallback((cmd: string) => {
    setActiveTab("claude");
    // Small delay to ensure tab switch renders the terminal
    setTimeout(() => {
      terminalRef.current?.sendCommand(cmd);
    }, 100);
  }, []);

  const handleAskClaude = (_prompt: string) => {
    setActiveTab("claude");
  };

  const handleSearchSelectSession = (_sessionId: string) => {
    setActiveTab("claude");
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab as Tab);
  };

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
      <div className="flex flex-1 min-h-0 pb-16 md:pb-0">
        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-30 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar - Quick Panel */}
        <aside
          className={`fixed md:static inset-y-0 left-0 z-40 bg-gray-900 border-r border-gray-800
                       flex flex-col transform transition-all md:translate-x-0
                       ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
                       ${sidebarCollapsed ? "md:w-0 md:border-r-0 md:overflow-hidden" : "w-72"}`}
        >
          {/* Sidebar header */}
          <div className="flex items-center justify-between p-3 border-b border-gray-800">
            <span className="text-sm font-semibold text-gray-300">Quick Panel</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setSidebarCollapsed(true)}
                className="hidden md:block p-1 text-gray-500 hover:text-gray-300 transition-colors"
                title="Collapse sidebar"
              >
                <PanelLeftClose size={16} />
              </button>
              <button
                onClick={() => setSidebarOpen(false)}
                className="md:hidden text-gray-400 hover:text-gray-200"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Quick Panel content */}
          <QuickPanel onSendToTerminal={handleSendToTerminal} />

          {/* Logout */}
          <div className="p-3 border-t border-gray-800">
            <button
              onClick={logout}
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-red-400 transition-colors"
            >
              <LogOut size={14} />
              Logout
            </button>
          </div>
        </aside>

        {/* Main area */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Header with tabs */}
          <header className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
            <div className="flex items-center gap-2 overflow-x-auto">
              {/* Mobile: open sidebar */}
              <button
                onClick={() => setSidebarOpen(true)}
                className="md:hidden text-gray-400 hover:text-gray-200 flex-shrink-0"
              >
                <Menu size={20} />
              </button>

              {/* Desktop: expand collapsed sidebar */}
              {sidebarCollapsed && (
                <button
                  onClick={() => setSidebarCollapsed(false)}
                  className="hidden md:block text-gray-500 hover:text-gray-300 flex-shrink-0 transition-colors"
                  title="Open sidebar"
                >
                  <PanelLeft size={18} />
                </button>
              )}

              {/* Tab buttons - desktop */}
              <div className="hidden md:flex bg-gray-800 rounded-lg p-0.5">
                {TABS.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
                        activeTab === tab.id
                          ? "bg-gray-700 text-white"
                          : "text-gray-400 hover:text-gray-200"
                      }`}
                    >
                      <Icon size={14} />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Mobile: show current tab name */}
              <span className="md:hidden text-sm text-gray-300 font-medium">
                {TABS.find((t) => t.id === activeTab)?.label}
              </span>
            </div>

            {/* Logout on desktop when sidebar collapsed */}
            {sidebarCollapsed && (
              <button
                onClick={logout}
                className="hidden md:flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-400 transition-colors"
              >
                <LogOut size={13} />
              </button>
            )}
          </header>

          {/* Content area */}
          {activeTab === "claude" ? (
            <ClaudeTerminal ref={terminalRef} />
          ) : activeTab === "terminal" ? (
            <TerminalPanel />
          ) : activeTab === "files" ? (
            <FileBrowser onAskClaude={handleAskClaude} />
          ) : activeTab === "search" ? (
            <SearchPanel onSelectSession={handleSearchSelectSession} />
          ) : activeTab === "scheduler" ? (
            <SchedulerPanel />
          ) : activeTab === "monitor" ? (
            <MonitorPanel />
          ) : null}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <MobileNav activeTab={activeTab} onTabChange={handleTabChange} />
    </div>
  );
}
