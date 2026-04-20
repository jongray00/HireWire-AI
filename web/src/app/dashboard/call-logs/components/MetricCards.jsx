import { formatDuration } from "./helpers";

export default function MetricCards({ log }) {
  const cards = [
    { label: "Duration", value: formatDuration(log.durationSec) },
    { label: "Avg Latency", value: log.avgLatencyMs ? `${log.avgLatencyMs}ms` : "—" },
    { label: "Messages", value: log.totalMessages || 0 },
    { label: "Tokens", value: (log.totalInputTokens || 0) + (log.totalOutputTokens || 0) },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      {cards.map((c) => (
        <div key={c.label} className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">{c.label}</p>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">{c.value}</p>
        </div>
      ))}
    </div>
  );
}
