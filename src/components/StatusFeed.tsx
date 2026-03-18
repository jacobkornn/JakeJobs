interface StatusMessage {
  id: string;
  text: string;
  type: "info" | "success" | "error" | "warning";
  timestamp: Date;
}

interface StatusFeedProps {
  messages: StatusMessage[];
}

export default function StatusFeed({ messages }: StatusFeedProps) {
  if (messages.length === 0) return null;

  const colors = {
    info: "text-gray-400",
    success: "text-green-400",
    error: "text-red-400",
    warning: "text-yellow-400",
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 max-h-48 overflow-y-auto">
      {messages.map((msg) => (
        <div key={msg.id} className="flex items-start gap-2 py-0.5">
          <span className="text-xs text-gray-600 shrink-0 font-mono">
            {msg.timestamp.toLocaleTimeString()}
          </span>
          <span className={`text-xs ${colors[msg.type]}`}>{msg.text}</span>
        </div>
      ))}
    </div>
  );
}

export type { StatusMessage };
