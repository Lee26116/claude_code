import React, { useState, useCallback } from 'react';
import { Search, Loader2, MessageSquare, Brain, FileText } from 'lucide-react';
import { api } from '@/utils/api';

interface SearchResult {
  session_id?: string;
  snippet: string;
  source: string;
  timestamp: string;
}

interface SearchResponse {
  query: string;
  type: string;
  total: number;
  results: SearchResult[];
}

interface SearchPanelProps {
  onSelectSession: (id: string) => void;
}

type SearchType = 'all' | 'sessions' | 'brain';

const SOURCE_BADGES: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  session: {
    label: 'Session',
    color: 'bg-blue-900/40 text-blue-400',
    icon: <MessageSquare className="w-3 h-3" />,
  },
  brain: {
    label: 'Brain',
    color: 'bg-purple-900/40 text-purple-400',
    icon: <Brain className="w-3 h-3" />,
  },
  file: {
    label: 'File',
    color: 'bg-green-900/40 text-green-400',
    icon: <FileText className="w-3 h-3" />,
  },
};

const HighlightedText: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  if (!query.trim()) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let lastIndex = 0;

  let index = lowerText.indexOf(lowerQuery);
  while (index !== -1) {
    if (index > lastIndex) {
      parts.push(text.slice(lastIndex, index));
    }
    parts.push(
      <mark key={index} className="bg-yellow-500/30 text-yellow-200 rounded px-0.5">
        {text.slice(index, index + query.length)}
      </mark>
    );
    lastIndex = index + query.length;
    index = lowerText.indexOf(lowerQuery, lastIndex);
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
};

const SearchPanel: React.FC<SearchPanelProps> = ({ onSelectSession }) => {
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState<SearchType>('all');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setSearched(true);
    try {
      const data = await api.get<SearchResponse>(
        `/search?q=${encodeURIComponent(q)}&type=${searchType}`
      );
      setResults(data.results);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, searchType]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const formatTime = (ts: string) => {
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return ts;
    }
  };

  const typeOptions: { value: SearchType; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'sessions', label: 'Sessions' },
    { value: 'brain', label: 'Brain' },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-950 rounded-lg border border-gray-800 overflow-hidden">
      {/* Search bar */}
      <div className="p-4 border-b border-gray-800 space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search sessions, brain memories, files..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              autoFocus
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm rounded-lg transition-colors shrink-0"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
          </button>
        </div>

        {/* Type filter */}
        <div className="flex items-center gap-1">
          {typeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSearchType(opt.value)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                searchType === opt.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">Searching...</span>
          </div>
        ) : !searched ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Search className="w-8 h-8 mb-2 text-gray-600" />
            <p className="text-sm">Enter a query to search</p>
          </div>
        ) : results.length === 0 ? (
          <div className="text-center py-12 text-gray-500 text-sm">
            No results found for "{query}"
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {results.map((result, idx) => {
              const badge = SOURCE_BADGES[result.source] || {
                label: result.source,
                color: 'bg-gray-800 text-gray-400',
                icon: null,
              };

              return (
                <div
                  key={idx}
                  onClick={() => result.session_id && onSelectSession(result.session_id)}
                  className={`p-4 ${
                    result.session_id
                      ? 'cursor-pointer hover:bg-gray-900/50'
                      : ''
                  } transition-colors`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded ${badge.color}`}>
                      {badge.icon}
                      {badge.label}
                    </span>
                    <span className="text-xs text-gray-600">{formatTime(result.timestamp)}</span>
                  </div>
                  <p className="text-sm text-gray-300 line-clamp-3">
                    <HighlightedText text={result.snippet} query={query} />
                  </p>
                  {result.session_id && (
                    <p className="text-xs text-gray-600 mt-1 font-mono">
                      Session: {result.session_id}
                    </p>
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

export default SearchPanel;
