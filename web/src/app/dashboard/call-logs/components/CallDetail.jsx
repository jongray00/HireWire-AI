import { useState } from "react";
import CallHeader from "./CallHeader";
import MetricCards from "./MetricCards";
import TabBar from "./TabBar";
import TranscriptPanel from "./TranscriptPanel";
import SwaigPanel from "./SwaigPanel";
import SummaryPanel from "./SummaryPanel";
import PostPromptTabs from "./PostPromptTabs";
import RoleDistributionChart from "./RoleDistributionChart";
import LatencyBreakdownChart from "./LatencyBreakdownChart";
import TpsBarChart from "./TpsBarChart";
import AsrConfidenceChart from "./AsrConfidenceChart";
import SwaigLatencyChart from "./SwaigLatencyChart";
import CallTimelineSwimlane from "./CallTimelineSwimlane";
import GlobalDataTreeViewer from "./GlobalDataTreeViewer";
import RecordingWaveform from "./RecordingWaveform";
import StateFlowPanel from "./StateFlowPanel";

export default function CallDetail({ log }) {
  const [tab, setTab] = useState("dashboard");
  const [playbackTime, setPlaybackTime] = useState(null);
  const raw = log._raw || {};

  const hasRecording = !!raw.SWMLVars?.record_call_url;

  // 9 tabs in P.I.E. Viewer order
  const tabs = [
    { id: "dashboard", label: "Dashboard" },
    { id: "charts", label: "Charts" },
    { id: "timeline", label: "Timeline" },
    { id: "transcript", label: "Transcript" },
    { id: "swaig", label: `SWAIG Inspector (${raw.swaig_log?.length || 0})` },
    { id: "postprompt", label: "Post-Prompt" },
    { id: "stateflow", label: "State Flow" },
    hasRecording && { id: "recording", label: "Recording" },
    { id: "globaldata", label: "Global Data" },
  ].filter(Boolean);

  return (
    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 mt-3">
      <CallHeader log={log} />
      <TabBar tabs={tabs} activeTab={tab} onTabChange={setTab} />

      {tab === "dashboard" && (
        <div>
          <MetricCards log={log} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Message Distribution</p>
              <RoleDistributionChart callLog={raw.call_log} />
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Response Latency</p>
              <LatencyBreakdownChart callLog={raw.call_log} />
            </div>
          </div>
        </div>
      )}

      {tab === "charts" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Tokens Per Second</p>
            <TpsBarChart times={raw.times} />
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">ASR Confidence</p>
            <AsrConfidenceChart callLog={raw.call_log} />
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 md:col-span-2">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">SWAIG Function Latency</p>
            <SwaigLatencyChart swaigLog={raw.swaig_log} />
          </div>
        </div>
      )}

      {tab === "timeline" && (
        <CallTimelineSwimlane callLog={raw.call_log} callStartDate={raw.call_start_date} />
      )}

      {tab === "transcript" && (
        <TranscriptPanel callLog={raw.call_log} currentPlaybackTime={playbackTime} />
      )}

      {tab === "swaig" && <SwaigPanel swaigLog={raw.swaig_log} />}

      {tab === "postprompt" && (
        <div>
          <SummaryPanel log={log} />
          <div className="mt-4">
            <PostPromptTabs postPromptData={raw.post_prompt_data} />
          </div>
        </div>
      )}

      {tab === "stateflow" && <StateFlowPanel rawPayload={raw} />}

      {tab === "recording" && (
        <RecordingWaveform
          recordingUrl={raw.SWMLVars?.record_call_url}
          callLog={raw.call_log}
          callStartDate={raw.call_start_date}
          onTimeUpdate={setPlaybackTime}
        />
      )}

      {tab === "globaldata" && (
        <GlobalDataTreeViewer
          globalData={raw.global_data}
          userVariables={raw.user_variables}
          swmlVars={raw.SWMLVars}
        />
      )}
    </div>
  );
}
