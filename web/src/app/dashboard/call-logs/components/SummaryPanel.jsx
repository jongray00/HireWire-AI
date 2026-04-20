export default function SummaryPanel({ log }) {
  return (
    <div className="space-y-3">
      {log.summary && (
        <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">Summary</p>
          <p className="text-sm text-gray-700 dark:text-gray-300">{log.summary}</p>
        </div>
      )}
      {log.callerIntent && (
        <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">Caller Intent</p>
          <p className="text-sm text-gray-700 dark:text-gray-300">{log.callerIntent}</p>
        </div>
      )}
      {log.followUp && (
        <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-1">Follow-up Needed</p>
          <p className="text-sm text-amber-700 dark:text-amber-400">{log.followUp}</p>
        </div>
      )}
      {log.topics?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {log.topics.map((t, i) => (
            <span key={i} className="px-2 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs rounded-full">{t}</span>
          ))}
        </div>
      )}
      {!log.summary && !log.callerIntent && (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">No AI summary available for this call</p>
      )}
    </div>
  );
}
