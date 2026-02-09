import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Folder, File, ChevronRight, ChevronDown, Loader2, X } from 'lucide-react';
import { api } from '@/utils/api';

interface TreeItem {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  children?: TreeItem[];
}

interface FileContent {
  content: string;
  path: string;
  size: number;
}

interface FileBrowserProps {
  onAskClaude?: (prompt: string) => void;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  filePath: string;
  fileName: string;
}

const TreeNode: React.FC<{
  item: TreeItem;
  depth: number;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, item: TreeItem) => void;
  expandedDirs: Set<string>;
  toggleDir: (path: string) => void;
}> = ({ item, depth, selectedPath, onSelectFile, onContextMenu, expandedDirs, toggleDir }) => {
  const isExpanded = expandedDirs.has(item.path);
  const isSelected = selectedPath === item.path;

  const handleClick = () => {
    if (item.is_dir) {
      toggleDir(item.path);
    } else {
      onSelectFile(item.path);
    }
  };

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer text-sm hover:bg-gray-800 rounded transition-colors ${
          isSelected ? 'bg-gray-800 text-white' : 'text-gray-300'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        onContextMenu={(e) => !item.is_dir && onContextMenu(e, item)}
      >
        {item.is_dir ? (
          <>
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 shrink-0 text-gray-500" />
            ) : (
              <ChevronRight className="w-4 h-4 shrink-0 text-gray-500" />
            )}
            <Folder className="w-4 h-4 shrink-0 text-amber-400" />
          </>
        ) : (
          <>
            <span className="w-4 shrink-0" />
            <File className="w-4 h-4 shrink-0 text-gray-400" />
          </>
        )}
        <span className="truncate">{item.name}</span>
      </div>
      {item.is_dir && isExpanded && item.children && (
        <div>
          {item.children.map((child) => (
            <TreeNode
              key={child.path}
              item={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              onContextMenu={onContextMenu}
              expandedDirs={expandedDirs}
              toggleDir={toggleDir}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const FileBrowser: React.FC<FileBrowserProps> = ({ onAskClaude }) => {
  const [tree, setTree] = useState<TreeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    filePath: '',
    fileName: '',
  });

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchTree = async () => {
      try {
        setLoading(true);
        const data = await api.get<{ children: TreeItem[] }>('/files/tree?path=/home/claude&depth=3');
        setTree(data.children || []);
      } catch {
        setTree([]);
      } finally {
        setLoading(false);
      }
    };
    fetchTree();
  }, []);

  useEffect(() => {
    const handleClickOutside = () => {
      if (contextMenu.visible) {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [contextMenu.visible]);

  const handleSelectFile = useCallback(async (path: string) => {
    setSelectedPath(path);
    setFileLoading(true);
    try {
      const data = await api.get<FileContent>(`/files/read?path=${encodeURIComponent(path)}`);
      setFileContent(data);
    } catch {
      setFileContent(null);
    } finally {
      setFileLoading(false);
    }
  }, []);

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, item: TreeItem) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      filePath: item.path,
      fileName: item.name,
    });
  }, []);

  const handleAskClaude = (action: 'explain' | 'optimize') => {
    if (!onAskClaude) return;
    const prompt =
      action === 'explain'
        ? `请解释文件 ${contextMenu.filePath} 的代码内容和逻辑`
        : `请优化文件 ${contextMenu.filePath} 的代码，提出改进建议`;
    onAskClaude(prompt);
    setContextMenu((prev) => ({ ...prev, visible: false }));
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div ref={containerRef} className="flex flex-col md:flex-row h-full bg-gray-950 rounded-lg border border-gray-800 overflow-hidden">
      {/* Tree panel */}
      <div className="w-full md:w-72 lg:w-80 border-b md:border-b-0 md:border-r border-gray-800 flex flex-col shrink-0">
        <div className="px-3 py-2 border-b border-gray-800 text-sm font-medium text-gray-300">
          Files
        </div>
        <div className="flex-1 overflow-y-auto py-1 max-h-[40vh] md:max-h-none">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : tree.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">No files found</div>
          ) : (
            tree.map((item) => (
              <TreeNode
                key={item.path}
                item={item}
                depth={0}
                selectedPath={selectedPath}
                onSelectFile={handleSelectFile}
                onContextMenu={handleContextMenu}
                expandedDirs={expandedDirs}
                toggleDir={toggleDir}
              />
            ))
          )}
        </div>
      </div>

      {/* File preview panel */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedPath ? (
          <>
            <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
              <span className="text-sm text-gray-300 truncate">{selectedPath}</span>
              {fileContent && (
                <span className="text-xs text-gray-500 shrink-0 ml-2">
                  {formatSize(fileContent.size)}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-auto p-4">
              {fileLoading ? (
                <div className="flex items-center justify-center py-8 text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : fileContent ? (
                <pre className="text-sm text-gray-300 font-mono whitespace-pre-wrap break-words">
                  {fileContent.content}
                </pre>
              ) : (
                <div className="text-center py-8 text-gray-500 text-sm">
                  Failed to load file content
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
            Select a file to preview
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu.visible && (
        <div
          className="fixed z-50 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-48"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 transition-colors"
            onClick={() => handleAskClaude('explain')}
          >
            让 Claude 解释
          </button>
          <button
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 transition-colors"
            onClick={() => handleAskClaude('optimize')}
          >
            让 Claude 优化
          </button>
        </div>
      )}
    </div>
  );
};

export default FileBrowser;
