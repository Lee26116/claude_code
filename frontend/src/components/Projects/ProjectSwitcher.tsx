import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Plus, X, FolderOpen, Check, Loader2 } from 'lucide-react';
import { api } from '@/utils/api';

interface Project {
  name: string;
  path: string;
  active: boolean;
}

interface ProjectsResponse {
  projects: Project[];
  active: string | null;
}

const ProjectSwitcher: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState<string | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchProjects = async () => {
    try {
      const data = await api.get<ProjectsResponse>('/projects');
      setProjects(data.projects);
      setActiveProject(data.active);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setShowAddForm(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleActivate = async (name: string) => {
    setActivating(name);
    try {
      await api.post(`/projects/${encodeURIComponent(name)}/activate`, {});
      setActiveProject(name);
      setProjects((prev) =>
        prev.map((p) => ({ ...p, active: p.name === name }))
      );
      setIsOpen(false);
    } catch {
      // ignore
    } finally {
      setActivating(null);
    }
  };

  const handleAdd = async () => {
    if (!newName.trim() || !newPath.trim()) return;
    try {
      await api.post('/projects', { name: newName.trim(), path: newPath.trim() });
      setNewName('');
      setNewPath('');
      setShowAddForm(false);
      await fetchProjects();
    } catch {
      // ignore
    }
  };

  const handleDelete = async (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.delete(`/projects/${encodeURIComponent(name)}`);
      await fetchProjects();
    } catch {
      // ignore
    }
  };

  const activeProjectObj = projects.find((p) => p.name === activeProject);

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors text-sm text-gray-200 min-w-40"
      >
        <FolderOpen className="w-4 h-4 text-amber-400 shrink-0" />
        <span className="truncate flex-1 text-left">
          {loading ? 'Loading...' : activeProjectObj?.name || 'No project'}
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="max-h-64 overflow-y-auto">
            {projects.length === 0 && !loading ? (
              <div className="px-4 py-3 text-sm text-gray-500 text-center">
                No projects yet
              </div>
            ) : (
              projects.map((project) => (
                <div
                  key={project.name}
                  onClick={() => handleActivate(project.name)}
                  className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-gray-800 transition-colors group ${
                    project.name === activeProject ? 'bg-gray-800/50' : ''
                  }`}
                >
                  <div className="w-4 h-4 shrink-0 flex items-center justify-center">
                    {activating === project.name ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                    ) : project.name === activeProject ? (
                      <Check className="w-3.5 h-3.5 text-green-400" />
                    ) : null}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-200 truncate">{project.name}</div>
                    <div className="text-xs text-gray-500 truncate">{project.path}</div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(project.name, e)}
                    className="p-1.5 hover:bg-gray-700 rounded transition-all opacity-60 md:opacity-0 md:group-hover:opacity-100"
                  >
                    <X className="w-4 h-4 text-gray-400" />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-gray-700">
            {showAddForm ? (
              <div className="p-3 space-y-2">
                <input
                  type="text"
                  placeholder="Project name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  autoFocus
                />
                <input
                  type="text"
                  placeholder="Project path"
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleAdd}
                    className="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => {
                      setShowAddForm(false);
                      setNewName('');
                      setNewPath('');
                    }}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddForm(true)}
                className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add project
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectSwitcher;
