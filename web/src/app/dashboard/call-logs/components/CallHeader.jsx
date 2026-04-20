import { useState } from "react";
import { Copy, Check, Download, PhoneOff, PhoneIncoming } from "lucide-react";
import { formatDate } from "./helpers";
import PerformanceRatingBadge from "./badges/PerformanceRatingBadge";

export default function CallHeader({ log }) {
  const [copied, setCopied] = useState(false);
  const raw = log._raw || {};
  const callId = raw.call_id || log.id;

  const handleCopy = () => {
    navigator.clipboard.writeText(callId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(raw, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `call-${callId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Determine termination source
  let terminationLabel = null;
  if (raw.call_ended_by === "user" || raw.SWMLVars?.call_ended_by === "user") {
    terminationLabel = "Ended by caller";
  } else if (raw.call_ended_by === "assistant" || raw.SWMLVars?.call_ended_by === "assistant") {
    terminationLabel = "Ended by agent";
  }

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4 pb-3 border-b border-gray-200 dark:border-gray-700">
      {/* Call ID */}
      <div className="flex items-center gap-1.5">
        <code className="text-xs font-mono text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
          {callId.length > 12 ? callId.slice(0, 12) + "..." : callId}
        </code>
        <button onClick={handleCopy} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" title="Copy call ID">
          {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
        </button>
      </div>

      {/* Timestamp */}
      <span className="text-xs text-gray-500 dark:text-gray-400">{formatDate(log.timestamp)}</span>

      {/* Performance rating */}
      <PerformanceRatingBadge avgLatencyMs={log.avgLatencyMs} />

      {/* Termination */}
      {terminationLabel && (
        <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
          <PhoneOff size={12} />
          {terminationLabel}
        </span>
      )}

      {/* Export */}
      <button
        onClick={handleExport}
        className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
      >
        <Download size={12} />
        Export JSON
      </button>
    </div>
  );
}
