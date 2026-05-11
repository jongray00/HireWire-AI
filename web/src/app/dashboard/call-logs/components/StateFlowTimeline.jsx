const SOURCE_BADGES = {
  ai: { label: "AI-initiated", color: "text-green-500 dark:text-green-400" },
  tool: { label: "Forced", color: "text-yellow-500 dark:text-yellow-400" },
  gather: { label: "Forced", color: "text-yellow-500 dark:text-yellow-400" },
  explicit: { label: "Explicit transition", color: "text-blue-500 dark:text-blue-400" },
  implicit: { label: "Implicit state", color: "text-gray-500 dark:text-gray-400" },
};

function formatTimestamp(ts) {
  if (!ts) return "";
  // Handle both microsecond and second-precision timestamps
  const ms = ts > 1e12 ? Math.floor(ts / 1000) : ts * 1000;
  return new Date(ms).toLocaleTimeString();
}

export default function StateFlowTimeline({ timeline }) {
  if (!timeline || timeline.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-3">
        Complete Execution Timeline
      </h3>
      <ol className="space-y-3">
        {timeline.map((item, idx) => (
          <li key={idx} className="flex gap-3 text-sm">
            <span
              className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                item.type === "function_error"
                  ? "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300"
                  : item.type === "context_enter"
                  ? "bg-cyan-100 dark:bg-cyan-900 text-cyan-700 dark:text-cyan-300"
                  : item.type === "function"
                  ? "bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300"
                  : "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300"
              }`}
            >
              {idx + 1}
            </span>
            <div className="flex-1 min-w-0">
              {item.type === "state" && <TimelineState item={item} />}
              {(item.type === "function" || item.type === "function_error") && (
                <TimelineFunction item={item} />
              )}
              {item.type === "context_enter" && <TimelineContext item={item} />}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TimelineState({ item }) {
  const badge = SOURCE_BADGES[item.source] || SOURCE_BADGES.implicit;
  return (
    <div>
      <p className="font-medium text-gray-800 dark:text-gray-100">→ {item.state}</p>
      {item.triggeredBy && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Triggered by: <code className="font-mono">{item.triggeredBy}</code>{" "}
          <span className={`ml-1 ${badge.color}`}>● {badge.label}</span>
        </p>
      )}
      {item.timestamp && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{formatTimestamp(item.timestamp)}</p>
      )}
    </div>
  );
}

function TimelineFunction({ item }) {
  return (
    <div>
      <p className="font-mono text-amber-600 dark:text-amber-400">{item.functionName}</p>
      {item.error && (
        <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">Error: {item.error}</p>
      )}
      {item.args && (
        <pre className="text-xs text-gray-600 dark:text-gray-400 mt-1 bg-gray-50 dark:bg-gray-900 p-1.5 rounded overflow-x-auto">
          {JSON.stringify(item.args, null, 2)}
        </pre>
      )}
      {item.result && (
        <pre className="text-xs text-green-600 dark:text-green-400 mt-1 bg-gray-50 dark:bg-gray-900 p-1.5 rounded overflow-x-auto">
          {typeof item.result === "string" ? item.result : JSON.stringify(item.result, null, 2)}
        </pre>
      )}
      {item.timestamp && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{formatTimestamp(item.timestamp)}</p>
      )}
    </div>
  );
}

function TimelineContext({ item }) {
  return (
    <div>
      <p className="font-medium text-cyan-600 dark:text-cyan-400">
        ⤷ Context: {item.toContext || "unknown"}
      </p>
      {item.fromContext && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">from {item.fromContext}</p>
      )}
      {item.timestamp && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{formatTimestamp(item.timestamp)}</p>
      )}
    </div>
  );
}
