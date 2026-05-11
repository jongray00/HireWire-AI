const CARDS = [
  { key: "transitionCount", label: "Total Transitions" },
  { key: "uniqueStatesCount", label: "Unique States" },
  { key: "aiInitiated", label: "AI-Initiated", color: "text-green-500 dark:text-green-400" },
  { key: "toolForced", label: "Forced", color: "text-orange-500 dark:text-orange-400" },
  { key: "totalFunctions", label: "Tool Calls" },
  { key: "duration", label: "Duration" },
];

export default function StateFlowStatCards({ stats }) {
  if (!stats) return null;
  const cards = [...CARDS];
  if (stats.functionErrors > 0) {
    cards.push({ key: "functionErrors", label: "Errors", color: "text-red-500 dark:text-red-400" });
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3 mb-4">
      {cards.map((c) => (
        <div
          key={c.key}
          className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700"
        >
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{c.label}</p>
          <p className={`text-lg font-semibold mt-1 ${c.color || "text-gray-800 dark:text-gray-100"}`}>
            {stats[c.key]}
          </p>
        </div>
      ))}
    </div>
  );
}
