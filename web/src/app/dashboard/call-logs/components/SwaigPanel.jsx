import { useState } from "react";
import { Wrench, Search } from "lucide-react";

export default function SwaigPanel({ swaigLog }) {
  const [searchQuery, setSearchQuery] = useState("");

  if (!swaigLog || swaigLog.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">No function calls</p>;
  }

  const filtered = searchQuery
    ? swaigLog.filter(call => {
        const q = searchQuery.toLowerCase();
        return (
          (call.command_name || "").toLowerCase().includes(q) ||
          (typeof call.command_arg === "string" && call.command_arg.toLowerCase().includes(q)) ||
          (call.post_response?.response || "").toLowerCase().includes(q)
        );
      })
    : swaigLog;

  return (
    <div>
      {/* Search */}
      <div className="relative mb-3">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search functions, args, responses..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-6 pr-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
        />
        {searchQuery && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500">{filtered.length}/{swaigLog.length}</span>
        )}
      </div>

      <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
        {filtered.map((call, i) => (
          <details key={i} className="group border border-gray-200 dark:border-gray-700 rounded-lg" open={!!searchQuery}>
            <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg">
              <Wrench size={14} className="text-amber-500" />
              <span className="text-sm font-medium text-gray-900 dark:text-white">{call.command_name}</span>
              {call.epoch_time && (
                <span className="text-xs text-gray-400 ml-auto">{new Date(call.epoch_time * 1000).toLocaleTimeString()}</span>
              )}
            </summary>
            <div className="px-3 pb-3 space-y-2">
              {call.command_arg && (
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Arguments</p>
                  <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-x-auto">
                    {typeof call.command_arg === "string"
                      ? (() => { try { return JSON.stringify(JSON.parse(call.command_arg), null, 2); } catch { return call.command_arg; } })()
                      : JSON.stringify(call.command_arg, null, 2)}
                  </pre>
                </div>
              )}
              {call.post_response?.response && (
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Response</p>
                  <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                    {call.post_response.response}
                  </pre>
                </div>
              )}
              {call.post_data && (
                <details className="mt-1">
                  <summary className="text-xs text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">Request payload</summary>
                  <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-x-auto mt-1 max-h-[200px] overflow-y-auto">
                    {JSON.stringify(call.post_data, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </details>
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">No matches</p>
        )}
      </div>
    </div>
  );
}
