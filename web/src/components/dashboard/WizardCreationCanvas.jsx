"use client";

import { useState, useCallback, useEffect } from "react";
import { Wand2, X } from "lucide-react";
import { useWizardCall } from "@/app/hooks/useWizardCall";
import { WIZARD_EVENTS, parseWizardEvent } from "@/lib/wizardEvents";

/**
 * WizardCreationCanvas — focal overlay for the agent-being-built experience.
 *
 * Hidden until the first wizard event during an active call. Opens with a
 * two-column layout: live transcript (left), structured config + checkpoint
 * stepper (right). Backdrop click does not dismiss.
 */
export default function WizardCreationCanvas() {
  const [hasReceivedFirstEvent, setHasReceivedFirstEvent] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [config, setConfig] = useState({});
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [checkpoints, setCheckpoints] = useState({
    identity: false, voice: false, capabilities: false, review: false
  });
  const [createdAgent, setCreatedAgent] = useState(null);
  const [readyAgent, setReadyAgent] = useState(null);

  const handleEvent = useCallback((eventData) => {
    const parsed = parseWizardEvent(eventData);
    if (!parsed) return;

    if (
      parsed.type === WIZARD_EVENTS.AGENT_CONFIG_QUESTION ||
      parsed.type === WIZARD_EVENTS.AGENT_PREVIEW
    ) {
      setHasReceivedFirstEvent(true);
    }

    switch (parsed.type) {
      case WIZARD_EVENTS.AGENT_CONFIG_QUESTION:
        setCurrentQuestion(parsed.data);
        break;
      case WIZARD_EVENTS.AGENT_PREVIEW:
        setConfig((prev) => ({ ...prev, ...parsed.data }));
        setCurrentQuestion(null);
        break;
      case WIZARD_EVENTS.WIZARD_CHECKPOINT:
        setCheckpoints((prev) => ({ ...prev, [parsed.data.stage]: true }));
        break;
      case WIZARD_EVENTS.AGENT_CREATED:
        setCreatedAgent(parsed.data.employee);
        break;
      case WIZARD_EVENTS.AGENT_READY:
        setReadyAgent(parsed.data);
        break;
      default:
        break;
    }
  }, []);

  const handleTranscript = useCallback((line) => {
    setTranscript((prev) => {
      // Replace partial with new partial; append final lines.
      if (line.isPartial && prev.length > 0 && prev[prev.length - 1].isPartial && prev[prev.length - 1].role === line.role) {
        return [...prev.slice(0, -1), line];
      }
      return [...prev, line];
    });
  }, []);

  const { calling, connected, connectionState, endCall } = useWizardCall({
    onEvent: handleEvent,
    onTranscript: handleTranscript,
  });

  const isCallActive = calling || connected;

  // Hide canvas when call ends and there's nothing to show
  useEffect(() => {
    if (!isCallActive && !createdAgent && !readyAgent) {
      // Reset for next call
      setHasReceivedFirstEvent(false);
      setTranscript([]);
      setConfig({});
      setCurrentQuestion(null);
      setCheckpoints({ identity: false, voice: false, capabilities: false, review: false });
    }
  }, [isCallActive, createdAgent, readyAgent]);

  const shouldShow = hasReceivedFirstEvent || createdAgent;
  if (!shouldShow) return null;

  const handleDismiss = () => {
    setCreatedAgent(null);
    setReadyAgent(null);
    setHasReceivedFirstEvent(false);
  };

  return (
    <div
      data-testid="wizard-canvas"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <div className="w-[85vw] h-[80vh] max-w-6xl bg-gray-900 border border-purple-500/40 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-purple-500/20">
          <div className="flex items-center gap-3">
            <Wand2 className="w-5 h-5 text-purple-400" />
            <span className="font-medium text-white">Setup Wizard</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckpointDot label="Identity" state={checkpoints.identity ? "passed" : "pending"} testid="checkpoint-identity" />
            <span className="text-gray-600">━</span>
            <CheckpointDot label="Voice" state={checkpoints.voice ? "passed" : "pending"} testid="checkpoint-voice" />
            <span className="text-gray-600">━</span>
            <CheckpointDot label="Capabilities" state={checkpoints.capabilities ? "passed" : "pending"} testid="checkpoint-capabilities" />
            <span className="text-gray-600">━</span>
            <CheckpointDot label="Review" state={checkpoints.review ? "passed" : "pending"} testid="checkpoint-review" />
          </div>
          <div className="flex items-center gap-3">
            {connectionState === "connected" && (
              <span className="text-xs text-green-400">● Live</span>
            )}
            {!isCallActive && (
              <button
                type="button"
                onClick={handleDismiss}
                aria-label="Close wizard canvas"
                className="p-1.5 text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Body — placeholder; populated in Tasks 11-13 */}
        <div className="flex-1 grid grid-cols-2 divide-x divide-purple-500/20 overflow-hidden">
          <div
            data-testid="wizard-transcript"
            className="p-6 overflow-y-auto space-y-3 bg-gray-950/40"
          >
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-3">📜 Conversation</div>
            {transcript.length === 0 && (
              <p className="text-sm text-gray-500 italic">Waiting for the conversation to begin…</p>
            )}
            {transcript.map((line, i) => (
              <div key={`${line.t}-${i}`} className={`flex gap-2 text-sm ${line.role === "wizard" ? "text-purple-200" : "text-gray-200"}`}>
                <span className={`shrink-0 font-medium ${line.role === "wizard" ? "text-purple-400" : "text-blue-400"}`}>
                  {line.role === "wizard" ? "Wizard:" : "You:"}
                </span>
                <span className={line.isPartial ? "italic opacity-70" : ""}>{line.text}</span>
              </div>
            ))}
          </div>
          <div data-testid="wizard-config" className="p-6 overflow-y-auto space-y-4">
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-3">🤖 Building agent</div>
            <ConfigField label="Name" value={config.name} />
            <ConfigField label="Role" value={config.role} />
            <ConfigField label="Voice" value={config.voice} />
            <ConfigField label="Greeting" value={config.greeting} />
            <ConfigField
              label="Capabilities"
              value={config.functions?.length ? config.functions.join(", ") : null}
            />
            <ConfigField label="Knowledge" value={config.knowledgeDocs?.length ? `${config.knowledgeDocs.length} docs` : null} />
            <ConfigField label="Hours" value={config.businessHours} />

            {currentQuestion && (
              <div className="mt-6 p-4 bg-purple-900/30 border border-purple-500/40 rounded-lg">
                <p className="text-sm text-white font-medium mb-2">{currentQuestion.question}</p>
                <div className="flex flex-wrap gap-1.5">
                  {currentQuestion.options?.map((opt, i) => (
                    <span key={i} className="px-2.5 py-1 bg-purple-600/30 border border-purple-500/40 rounded-lg text-xs text-purple-200">
                      {opt}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {config.prompt && (
              <div className="mt-6 pt-4 border-t border-purple-500/20">
                <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Prompt preview</div>
                <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono">{config.prompt}</pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfigField({ label, value }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-xs uppercase tracking-wide text-gray-500 w-24 shrink-0">{label}</span>
      <span className={`text-sm ${value ? "text-white" : "text-gray-600 italic"}`}>
        {value || "—"}
      </span>
    </div>
  );
}

function CheckpointDot({ label, state, testid }) {
  const colors = {
    pending: "bg-gray-700 text-gray-500",
    passed: "bg-purple-600 text-white",
  };
  return (
    <div data-testid={testid} data-state={state} className="flex items-center gap-1.5">
      <span className={`w-2.5 h-2.5 rounded-full ${colors[state]}`} />
      <span className={`text-xs ${state === "passed" ? "text-purple-300" : "text-gray-500"}`}>{label}</span>
    </div>
  );
}
