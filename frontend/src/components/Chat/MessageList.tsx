import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useChatStore, Message, StreamChunk } from "@/stores/chatStore";
import { User, Bot, Terminal, FileText, AlertCircle, Wrench, CheckCircle } from "lucide-react";

const mdComponents = {
  code({ className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || "");
    const code = String(children).replace(/\n$/, "");
    if (match) {
      return (
        <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div">
          {code}
        </SyntaxHighlighter>
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""} mb-4`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          isUser ? "bg-blue-600" : "bg-purple-600"
        }`}
      >
        {isUser ? <User size={16} /> : <Bot size={16} />}
      </div>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-100"
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown components={mdComponents}>{message.content}</ReactMarkdown>
          </div>
        )}
        {message.attachments?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {message.attachments.map((att, i) => (
              <span key={i} className="text-xs bg-gray-700 px-2 py-1 rounded">
                {att.filename}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Activity log item during streaming */
function ActivityItem({ chunk }: { chunk: StreamChunk }) {
  switch (chunk.type) {
    case "tool_use":
      return (
        <div className="flex items-start gap-2 text-sm py-1 text-blue-400">
          <Wrench size={14} className="flex-shrink-0 mt-0.5 animate-spin-slow" />
          <span className="font-mono text-xs break-all">{chunk.content}</span>
        </div>
      );
    case "tool_result":
      return (
        <div className="flex items-start gap-2 text-sm py-1 text-gray-500">
          <CheckCircle size={14} className="flex-shrink-0 mt-0.5 text-green-600" />
          <pre className="font-mono text-xs text-gray-500 whitespace-pre-wrap break-all max-h-24 overflow-y-auto">{chunk.content}</pre>
        </div>
      );
    case "text":
      return (
        <div className="text-sm py-0.5 text-gray-300">
          <span>{chunk.content}</span>
        </div>
      );
    case "error":
      return (
        <div className="flex items-start gap-2 text-sm py-1 text-red-400">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span className="font-mono text-xs">{chunk.content}</span>
        </div>
      );
    case "result":
      // The final result - render as markdown
      return (
        <div className="prose prose-invert prose-sm max-w-none mt-2 pt-2 border-t border-gray-700">
          <ReactMarkdown components={mdComponents}>{chunk.content}</ReactMarkdown>
        </div>
      );
    default:
      return (
        <div className="flex items-center gap-1.5 text-gray-500 text-sm py-0.5">
          <FileText size={12} className="flex-shrink-0" />
          <span>{chunk.content}</span>
        </div>
      );
  }
}

/** Streaming activity view - shows what Claude is doing in real time */
function StreamingActivity({ chunks }: { chunks: StreamChunk[] }) {
  const hasResult = chunks.some((c) => c.type === "result");
  // Show activity items (tool_use, tool_result, intermediate text)
  const activityChunks = chunks.filter((c) => c.type !== "result");
  const resultChunk = chunks.find((c) => c.type === "result");

  return (
    <div>
      {activityChunks.length > 0 && (
        <div className="space-y-0.5 mb-1">
          {activityChunks.map((chunk, i) => (
            <ActivityItem key={i} chunk={chunk} />
          ))}
        </div>
      )}
      {!hasResult && (
        <div className="flex items-center gap-2 text-gray-500 text-sm mt-2">
          <div className="flex gap-1">
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" />
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:0.15s]" />
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:0.3s]" />
          </div>
          <span>Claude is working...</span>
        </div>
      )}
      {resultChunk && <ActivityItem chunk={resultChunk} />}
    </div>
  );
}

export default function MessageList() {
  const { messages, streaming, streamChunks } = useChatStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamChunks]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2">
      {messages.length === 0 && !streaming && (
        <div className="flex flex-col items-center justify-center h-full text-gray-500">
          <Bot size={48} className="mb-4 text-gray-600" />
          <p className="text-lg">Claude Code Dashboard</p>
          <p className="text-sm mt-1">Enter a message to start</p>
        </div>
      )}
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      {streaming && (
        <div className="flex gap-3 mb-4">
          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-purple-600">
            <Bot size={16} />
          </div>
          <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-gray-800 text-gray-100 min-w-[200px]">
            {streamChunks.length > 0 ? (
              <StreamingActivity chunks={streamChunks} />
            ) : (
              <div className="flex items-center gap-2 text-gray-500">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" />
                  <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:0.15s]" />
                  <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:0.3s]" />
                </div>
                <span className="text-sm">Connecting to Claude...</span>
              </div>
            )}
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
