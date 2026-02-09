import React, { useState, useRef, useEffect } from 'react';
import {
  Terminal,
  FolderOpen,
  Search,
  MoreHorizontal,
  Clock,
  Shield,
  TerminalSquare,
} from 'lucide-react';

interface MobileNavProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const primaryTabs: NavItem[] = [
  { id: 'claude', label: 'Claude', icon: <TerminalSquare className="w-5 h-5" /> },
  { id: 'terminal', label: 'Terminal', icon: <Terminal className="w-5 h-5" /> },
  { id: 'files', label: 'Files', icon: <FolderOpen className="w-5 h-5" /> },
  { id: 'search', label: 'Search', icon: <Search className="w-5 h-5" /> },
];

const moreTabs: NavItem[] = [
  { id: 'scheduler', label: 'Scheduler', icon: <Clock className="w-5 h-5" /> },
  { id: 'monitor', label: 'Monitor', icon: <Shield className="w-5 h-5" /> },
];

const MobileNav: React.FC<MobileNavProps> = ({ activeTab, onTabChange }) => {
  const [showMore, setShowMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setShowMore(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isMoreActive = moreTabs.some((t) => t.id === activeTab);

  const handleTabClick = (id: string) => {
    onTabChange(id);
    setShowMore(false);
  };

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-gray-950 border-t border-gray-800 safe-area-bottom">
      <div className="flex items-stretch">
        {primaryTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabClick(tab.id)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 pt-2.5 transition-colors ${
              activeTab === tab.id
                ? 'text-blue-400'
                : 'text-gray-500 active:text-gray-300'
            }`}
          >
            {tab.icon}
            <span className="text-[10px] font-medium">{tab.label}</span>
          </button>
        ))}

        {/* More button */}
        <div ref={moreRef} className="flex-1 relative">
          <button
            onClick={() => setShowMore(!showMore)}
            className={`w-full h-full flex flex-col items-center justify-center gap-0.5 py-2 pt-2.5 transition-colors ${
              isMoreActive || showMore
                ? 'text-blue-400'
                : 'text-gray-500 active:text-gray-300'
            }`}
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] font-medium">More</span>
          </button>

          {/* More popup */}
          {showMore && (
            <div className="absolute bottom-full right-0 mb-2 w-48 bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
              {moreTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => handleTabClick(tab.id)}
                  className={`flex items-center gap-3 w-full px-4 py-3 text-sm transition-colors ${
                    activeTab === tab.id
                      ? 'text-blue-400 bg-gray-800/50'
                      : 'text-gray-300 hover:bg-gray-800'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};

export default MobileNav;
