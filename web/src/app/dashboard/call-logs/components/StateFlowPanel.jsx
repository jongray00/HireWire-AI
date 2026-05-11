import { useMemo } from "react";
import { parseStateFlow } from "../lib/parseStateFlow.js";
import StateFlowStatCards from "./StateFlowStatCards";
import StateFlowDiagram from "./StateFlowDiagram";
import StateFlowTimeline from "./StateFlowTimeline";

export default function StateFlowPanel({ rawPayload }) {
  const flowData = useMemo(() => parseStateFlow(rawPayload), [rawPayload]);

  if (flowData.transitionCount === 0 && flowData.totalFunctions === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg p-8 border border-gray-200 dark:border-gray-700 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No state transitions or function calls captured for this call.
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
          State transitions are recorded once the agent uses contexts/steps. Older
          call logs (placed before the contexts/steps refactor) won't have rich state data.
        </p>
      </div>
    );
  }

  return (
    <div>
      <StateFlowStatCards stats={flowData} />
      <StateFlowDiagram mermaidDef={flowData.mermaidDef} />
      <StateFlowTimeline timeline={flowData.detailedTimeline} />
    </div>
  );
}
