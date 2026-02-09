import { useState, useRef, useCallback } from "react";
import { Send, Paperclip, X, Upload, Image as ImageIcon } from "lucide-react";
import { useChatStore } from "@/stores/chatStore";
import { api } from "@/utils/api";

interface Props {
  onSend: (content: string, attachments: { filename: string; path: string }[]) => void;
}

interface Attachment {
  filename: string;
  path: string;
  previewUrl?: string; // for image preview
}

export default function InputArea({ onSend }: Props) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadFileName, setUploadFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { streaming } = useChatStore();

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (streaming) return;

    onSend(
      text,
      attachments.map((a) => ({ filename: a.filename, path: a.path }))
    );
    setInput("");
    // Revoke preview URLs
    attachments.forEach((a) => {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    });
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, attachments, streaming, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const isImageFile = (file: File) => file.type.startsWith("image/");

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);

    for (const file of Array.from(files)) {
      setUploadFileName(file.name);
      setUploadProgress(0);

      // Create image preview URL
      const previewUrl = isImageFile(file) ? URL.createObjectURL(file) : undefined;

      try {
        const result = await api.uploadFile(file, (percent) => {
          setUploadProgress(percent);
        });
        setAttachments((prev) => [
          ...prev,
          { filename: result.filename, path: result.path, previewUrl },
        ]);
      } catch (e) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setUploadError(`上传失败: ${file.name}`);
        setTimeout(() => setUploadError(null), 3000);
        console.error("Upload failed:", e);
      }
    }

    setUploading(false);
    setUploadProgress(0);
    setUploadFileName("");
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      const dt = new DataTransfer();
      files.forEach((f) => dt.items.add(f));
      handleFileUpload(dt.files);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFileUpload(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    // Only set false if leaving the container (not entering a child)
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(false);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => {
      const removed = prev[index];
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
  };

  return (
    <div
      className={`relative border-t border-gray-800 p-4 transition-colors ${
        dragOver ? "bg-blue-950/30" : ""
      }`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Drag overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-blue-950/40 border-2 border-dashed border-blue-500 rounded-lg pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-blue-400">
            <Upload size={32} />
            <span className="text-sm font-medium">拖放文件到此处上传</span>
          </div>
        </div>
      )}

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {attachments.map((att, i) => (
            <div
              key={i}
              className="relative group"
            >
              {att.previewUrl ? (
                // Image preview
                <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-700">
                  <img
                    src={att.previewUrl}
                    alt={att.filename}
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => removeAttachment(i)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                    style={{ opacity: undefined }}
                  >
                    <X size={10} className="text-white" />
                  </button>
                </div>
              ) : (
                // File chip
                <span className="flex items-center gap-1.5 text-xs bg-gray-800 text-gray-300 px-2.5 py-1.5 rounded-lg border border-gray-700">
                  <Paperclip size={12} />
                  <span className="max-w-[120px] truncate">{att.filename}</span>
                  <button onClick={() => removeAttachment(i)} className="hover:text-red-400 ml-0.5">
                    <X size={12} />
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Upload progress bar */}
      {uploading && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
            <span className="flex items-center gap-1.5">
              <ImageIcon size={12} />
              <span className="truncate max-w-[200px]">{uploadFileName}</span>
            </span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-200"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Upload error */}
      {uploadError && (
        <div className="mb-2 text-xs text-red-400">{uploadError}</div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-2 text-gray-400 hover:text-gray-200 transition-colors flex-shrink-0"
          disabled={uploading}
          title="上传文件 (也可拖拽或粘贴)"
        >
          <Paperclip size={20} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.txt,.md,.py,.js,.ts,.tsx,.jsx,.json,.yaml,.yml,.toml,.cfg,.ini,.sh,.css,.html,.xml,.sql,.rs,.go,.java,.c,.cpp,.h,.rb,.php,.vue,.csv,.log,.pdf,.doc,.docx,.xls,.xlsx,.zip,.tar,.gz"
          className="hidden"
          onChange={(e) => {
            handleFileUpload(e.target.files);
            e.target.value = ""; // allow re-selecting same file
          }}
        />
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="输入消息... (Ctrl+Enter 发送, 可粘贴截图)"
          rows={1}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-gray-100
                     placeholder-gray-500 resize-none focus:outline-none focus:border-blue-500
                     transition-colors"
        />
        <button
          onClick={handleSend}
          disabled={streaming || (!input.trim() && attachments.length === 0)}
          className="p-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500
                     text-white rounded-xl transition-colors flex-shrink-0"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
