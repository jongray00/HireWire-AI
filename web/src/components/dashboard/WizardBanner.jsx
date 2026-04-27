"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Wand2, Phone, PhoneOff } from "lucide-react";
import { useWizardCall } from "@/app/hooks/useWizardCall";
import { parseWizardEvent } from "@/lib/wizardEvents";

/**
 * WizardBanner — Global inline wizard call controls.
 *
 * Idle: slim CTA bar — "Setup Wizard — Build agents with your voice [Call Now]"
 * Active: expanded banner with connection state, hint text, and end-call button.
 * Error: retry bar.
 *
 * Preview/question/created cards are rendered by WizardCreationCanvas, not here.
 * Banner owns the SignalWire client and broadcasts everything via window events:
 *   - "wizard-event"        — SWAIG events (agent_preview, agent_config_question, agent_created, agent_ready, wizard_checkpoint)
 *   - "wizard-transcript"   — transcript lines (wizard_said + SDK partials)
 *   - "wizard-call-state"   — call state changes (calling, connected, connectionState)
 *
 * Banner also captures the full session lifecycle (events + transcript + debug
 * log + start/end times) and POSTs it to /api/signalwire/wizard-session-log
 * when the call ends — that endpoint persists a row to call_logs so every
 * wizard call shows up in the Call Logs page regardless of whether SignalWire
 * fires its own post-prompt webhook.
 *
 * Mount in dashboard/layout.jsx so it persists across all pages.
 */
export default function WizardBanner({ onAgentCreated }) {
  // Per-call session record. Reset each time a new call starts.
  const sessionRef = useRef(null);
  const wasActiveRef = useRef(false);

  const handleWizardEvent = useCallback((eventData) => {
    const parsed = parseWizardEvent(eventData);
    if (!parsed) return;
    if (sessionRef.current) {
      sessionRef.current.events.push({ t: Date.now(), data: parsed.data });
    }
    window.dispatchEvent(new CustomEvent("wizard-event", { detail: parsed.data }));
  }, []);

  const handleTranscript = useCallback((line) => {
    if (sessionRef.current) {
      sessionRef.current.transcript.push(line);
    }
    window.dispatchEvent(new CustomEvent("wizard-transcript", { detail: line }));
  }, []);

  const { startCall, endCall, calling, connected, connectionState, error, videoRef, debugLog = [] } =
    useWizardCall({ onEvent: handleWizardEvent, onTranscript: handleTranscript });

  // Broadcast call-state changes so the canvas can derive its visibility.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("wizard-call-state", {
      detail: { calling, connected, connectionState, error },
    }));
  }, [calling, connected, connectionState, error]);

  // Session lifecycle: start a fresh record on call activation, persist on
  // call end (whether the call completed cleanly or was aborted).
  useEffect(() => {
    const isActive = calling || connected;
    if (isActive && !wasActiveRef.current) {
      sessionRef.current = {
        sessionId: `wizard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        startedAt: new Date().toISOString(),
        events: [],
        transcript: [],
      };
    }
    if (!isActive && wasActiveRef.current && sessionRef.current) {
      const session = sessionRef.current;
      sessionRef.current = null;
      const created = [...session.events].reverse().find((e) => e.data?.type === "agent_created");
      const payload = {
        sessionId: session.sessionId,
        startedAt: session.startedAt,
        endedAt: new Date().toISOString(),
        events: session.events,
        transcript: session.transcript,
        debugLog: debugLog.slice(),
        finalConnectionState: connectionState,
        error: error || null,
        builtAgentId: created?.data?.employee?.id || null,
        builtAgentName: created?.data?.employee?.name || null,
      };
      // Best-effort fire-and-forget. Failures are not user-visible — the user
      // can still see the call in the agent log if needed.
      fetch("/api/signalwire/wizard-session-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch((e) => console.warn("[WizardBanner] session-log POST failed:", e));
    }
    wasActiveRef.current = isActive;
  }, [calling, connected, connectionState, error, debugLog]);

  const [showDebug, setShowDebug] = useState(false);
  const micStatus = [...debugLog].reverse().find((d) => d.kind === "mic:permission" || d.kind === "mic:permission-changed")?.detail || "unknown";

  const handleEndCall = useCallback(async () => {
    await endCall();
  }, [endCall]);

  const isActive = calling || connected;

  // Idle CTA bar
  if (!isActive && !error) {
    return (
      <div className="mx-4 lg:mx-6 mt-4 mb-0">
        <button
          type="button"
          onClick={startCall}
          aria-label="Start Setup Wizard call"
          className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-purple-600/10 to-indigo-600/10 hover:from-purple-600/20 hover:to-indigo-600/20 border border-purple-500/30 hover:border-purple-500/50 rounded-xl transition-all group"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-lg flex items-center justify-center">
              <Wand2 className="w-4 h-4 text-white" />
            </div>
            <div className="text-left">
              <span className="font-medium text-purple-300 group-hover:text-purple-200">Setup Wizard</span>
              <span className="text-gray-500 dark:text-gray-400 mx-2">—</span>
              <span className="text-sm text-gray-500 dark:text-gray-400">Build agents with your voice</span>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors">
            <Phone className="w-3.5 h-3.5 text-white" />
            <span className="text-sm font-medium text-white">Call Now</span>
          </div>
        </button>
      </div>
    );
  }

  // Error state (call failed with no active session)
  if (!isActive && error) {
    return (
      <div className="mx-4 lg:mx-6 mt-4 mb-0">
        <div className="flex items-center justify-between px-4 py-3 bg-red-900/20 border border-red-500/30 rounded-xl">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-red-600/30 rounded-lg flex items-center justify-center">
              <Wand2 className="w-4 h-4 text-red-300" />
            </div>
            <div>
              <p className="text-sm font-medium text-red-300">Wizard call failed</p>
              <p className="text-xs text-red-400">{error}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={startCall}
            aria-label="Retry Setup Wizard call"
            className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
          >
            <Phone className="w-3.5 h-3.5 text-white" />
            <span className="text-sm font-medium text-white">Retry</span>
          </button>
        </div>
      </div>
    );
  }

  // Active banner or results
  return (
    <div className="mx-4 lg:mx-6 mt-4 mb-0">
      <div className="bg-gradient-to-r from-purple-900/30 to-indigo-900/30 border border-purple-500/30 rounded-xl overflow-hidden">
        {/* Banner header */}
        <div className="flex items-center gap-4 p-4">
          {/* Left: Audio/connection area */}
          <div className="flex items-center gap-3 shrink-0">
            <div
              ref={videoRef}
              className="w-12 h-12 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-lg flex items-center justify-center"
            >
              <Wand2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-purple-300 text-sm">Setup Wizard</span>
                {isActive && (
                  <span className="flex items-center gap-1 text-xs">
                    {connectionState === "connecting" && (
                      <span className="text-yellow-400">Connecting...</span>
                    )}
                    {connectionState === "ringing" && (
                      <span className="text-yellow-400">Ringing...</span>
                    )}
                    {connectionState === "connected" && (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                        <span className="text-green-400">Live</span>
                      </>
                    )}
                  </span>
                )}
              </div>
              {error && <p className="text-xs text-red-400 mt-0.5">{error}</p>}
            </div>
          </div>

          {/* Center: hint during active call */}
          <div className="flex-1 min-w-0">
            {isActive && (
              <p className="text-sm text-gray-400">
                Speak to the wizard to start building your agent…
              </p>
            )}
          </div>

          {/* Right: Call controls */}
          <div className="flex items-center gap-2 shrink-0">
            {isActive && (
              <button
                type="button"
                onClick={handleEndCall}
                aria-label="End wizard call"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/80 hover:bg-red-600 rounded-lg transition-colors"
              >
                <PhoneOff className="w-3.5 h-3.5 text-white" />
                <span className="text-xs font-medium text-white">End</span>
              </button>
            )}
          </div>
        </div>

        {/* Debug panel */}
        <div className="border-t border-purple-500/20 px-4 py-2 text-xs text-gray-400">
          <button
            type="button"
            onClick={() => setShowDebug((s) => !s)}
            className="flex items-center gap-2 hover:text-gray-200 transition-colors"
          >
            <span className="font-mono">Debug</span>
            <span className="text-[10px] px-1.5 py-0.5 bg-gray-700 rounded">
              mic: {String(micStatus)}
            </span>
            <span className="text-[10px] text-gray-500">({debugLog.length} events)</span>
            <span className="text-[10px] text-gray-500">{showDebug ? "▲" : "▼"}</span>
          </button>
          {showDebug && (
            <div className="mt-2 max-h-48 overflow-y-auto space-y-0.5 font-mono text-[10px] bg-black/30 rounded p-2">
              {debugLog.slice().reverse().map((e, i) => (
                <div key={`${e.t}-${i}`} className="flex gap-2">
                  <span className="text-gray-500 shrink-0">{new Date(e.t).toLocaleTimeString()}</span>
                  <span className="text-purple-300 shrink-0">{e.kind}</span>
                  <span className="text-gray-300 break-all">{typeof e.detail === "object" ? JSON.stringify(e.detail) : String(e.detail)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
