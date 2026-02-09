import React, { useState, useEffect, useRef } from 'react';
import { Plus, X, Loader2, Sparkles } from 'lucide-react';
import { api } from '@/utils/api';

interface Preset {
  id: string;
  label: string;
  prompt: string;
}

interface PresetBarProps {
  onSelect: (prompt: string) => void;
}

const PresetBar: React.FC<PresetBarProps> = ({ onSelect }) => {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchPresets = async () => {
    try {
      const data = await api.get<Preset[]>('/presets');
      setPresets(data);
    } catch {
      setPresets([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPresets();
  }, []);

  const handleAdd = async () => {
    if (!newLabel.trim() || !newPrompt.trim()) return;
    try {
      await api.post('/presets', { label: newLabel.trim(), prompt: newPrompt.trim() });
      setNewLabel('');
      setNewPrompt('');
      setShowAddForm(false);
      await fetchPresets();
    } catch {
      // ignore
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.delete(`/presets/${id}`);
      setPresets((prev) => prev.filter((p) => p.id !== id));
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-2 py-2">
        <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        <span className="text-sm text-gray-500">Loading presets...</span>
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent"
      >
        <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />

        {presets.map((preset) => (
          <button
            key={preset.id}
            onClick={() => onSelect(preset.prompt)}
            className="group relative flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 rounded-full text-sm text-gray-300 hover:text-gray-100 transition-colors whitespace-nowrap shrink-0"
          >
            {preset.label}
            <span
              onClick={(e) => handleDelete(preset.id, e)}
              className="ml-1 p-1 hover:bg-gray-600 rounded-full transition-all inline-flex items-center justify-center opacity-60 md:opacity-0 md:group-hover:opacity-100"
            >
              <X className="w-3.5 h-3.5 text-gray-400" />
            </span>
          </button>
        ))}

        {presets.length === 0 && (
          <span className="text-sm text-gray-500">No presets yet</span>
        )}

        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center justify-center w-7 h-7 bg-gray-800 hover:bg-gray-700 border border-gray-700 border-dashed rounded-full text-gray-400 hover:text-gray-200 transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {showAddForm && (
        <div className="absolute top-full left-0 right-0 mt-2 p-3 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-40">
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Label (e.g. Code Review)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="w-full px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
              autoFocus
            />
            <textarea
              placeholder="Prompt template..."
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              rows={2}
              className="w-full px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
              >
                Add Preset
              </button>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setNewLabel('');
                  setNewPrompt('');
                }}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PresetBar;
