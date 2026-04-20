import { useState } from "react";
import { User, Bot, Wrench, Info, Search, ChevronLeft, ChevronRight } from "lucide-react";

const roleConfig = {
  user: { label: "Caller", icon: User, bg: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800", text: "text-blue-800 dark:text-blue-300" },
  assistant: { label: "Agent", icon: Bot, bg: "bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600", text: "text-gray-800 dark:text-gray-200" },
  tool: { label: "Function", icon: Wrench, bg: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800", text: "text-amber-800 dark:text-amber-300" },
  system: { label: "System", icon: Info, bg: "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700", text: "text-slate-600 dark:text-slate-400" },
  "system-log": { label: "Event", icon: Info, bg: "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700", text: "text-slate-500 dark:text-slate-500" },
};

function highlightMatches(text, query) {
  if (!query || !text) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">{part}</mark>
    ) : part
  );
}

export default function TranscriptPanel({ callLog, currentPlaybackTime }) {
  const [roleFilter, setRoleFilter] = useState("all");
  const [showSystem, setShowSystem] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  if (!callLog || callLog.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">No transcript available</p>;
  }

  const visibleRoles = ["user", "assistant", "tool"];
  if (showSystem) visibleRoles.push("system", "system-log");

  const messages = callLog.filter(m => {
    if (!visibleRoles.includes(m.role)) return false;
    if (roleFilter !== "all" && m.role !== roleFilter) return false;
    if (searchQuery && !(m.content || "").toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const matchCount = searchQuery ? messages.length : 0;

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-3">
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
        >
          <option value="all">All Roles</option>
          <option value="user">Caller</option>
          <option value="assistant">Agent</option>
          <option value="tool">Function</option>
        </select>
        <label className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
          <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} className="w-3 h-3" />
          System events
        </label>
        <div className="relative flex-1 min-w-[140px]">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search transcript..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-6 pr-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
          />
        </div>
        {searchQuery && (
          <span className="text-xs text-gray-500 dark:text-gray-400 self-center">{matchCount} matches</span>
        )}
      </div>

      {/* Messages */}
      <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
        {messages.map((msg, i) => {
          const cfg = roleConfig[msg.role] || roleConfig.assistant;
          const Icon = cfg.icon;
          return (
            <div key={i} className={`p-3 rounded-lg border ${cfg.bg}`}>
              <div className="flex items-center gap-2 mb-1">
                <Icon size={14} className={cfg.text} />
                <span className={`text-xs font-semibold ${cfg.text}`}>{cfg.label}</span>
                {msg.role === "assistant" && msg.audio_latency && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">{msg.audio_latency}ms</span>
                )}
                {msg.role === "user" && msg.confidence != null && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">{Math.round(msg.confidence * 100)}%</span>
                )}
                {msg.metadata?.barged && (
                  <span className="text-xs text-red-500 ml-1">barged</span>
                )}
              </div>
              <p className={`text-sm ${cfg.text}`}>
                {searchQuery ? highlightMatches(msg.content || "(empty)", searchQuery) : (msg.content || "(empty)")}
              </p>
              {msg.tool_calls?.length > 0 && (
                <div className="mt-2 pl-3 border-l-2 border-amber-300 dark:border-amber-700">
                  {msg.tool_calls.map((tc, j) => (
                    <p key={j} className="text-xs text-amber-700 dark:text-amber-400">
                      {tc.function?.name}({tc.function?.arguments?.slice(0, 60)}...)
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {messages.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">No messages match filters</p>
        )}
      </div>
    </div>
  );
}
