"use client";

import { useState, useCallback, useEffect } from "react";
import { Wand2, Phone, PhoneOff, Sparkles, Check, MessageCircle, X } from "lucide-react";
import { useWizardCall } from "@/app/hooks/useWizardCall";
import { WIZARD_EVENTS, parseWizardEvent } from "@/lib/wizardEvents";

/**
 * WizardBanner — Global inline wizard experience.
 *
 * Idle: slim CTA bar — "Setup Wizard — Build agents with your voice [Call Now]"
 * Active: expanded banner with audio controls, questions, and preview cards.
 *
 * Mount in dashboard/layout.jsx so it persists across all pages.
 */
export default function WizardBanner({ onAgentCreated }) {
  const [preview, setPreview] = useState(null);
  const [question, setQuestion] = useState(null);
  const [createdAgent, setCreatedAgent] = useState(null);
  const [readyAgent, setReadyAgent] = useState(null);
  const handleWizardEvent = useCallback((eventData) => {
    const parsed = parseWizardEvent(eventData);
    if (!parsed) return;

    switch (parsed.type) {
      case WIZARD_EVENTS.AGENT_PREVIEW:
        setPreview((prev) => ({ ...prev, ...parsed.data }));
        setQuestion(null);
        break;
      case WIZARD_EVENTS.AGENT_CONFIG_QUESTION:
        setQuestion(parsed.data);
        break;
      case WIZARD_EVENTS.AGENT_CREATED:
        setCreatedAgent(parsed.data.employee);
        setPreview(null);
        setQuestion(null);
        if (onAgentCreated) onAgentCreated(parsed.data.employee);
        break;
      case WIZARD_EVENTS.AGENT_READY:
        setReadyAgent(parsed.data);
        break;
    }
    // Broadcast to other listeners (e.g., employees page for highlight animation)
    window.dispatchEvent(new CustomEvent("wizard-event", { detail: parsed.data }));
  }, [onAgentCreated]);

  const { startCall, endCall, calling, connected, connectionState, error, videoRef, debugLog = [] } =
    useWizardCall({ onEvent: handleWizardEvent });
  const [showDebug, setShowDebug] = useState(false);
  const micStatus = [...debugLog].reverse().find((d) => d.kind === "mic:permission" || d.kind === "mic:permission-changed")?.detail || "unknown";
  const lastRtcCheck = [...debugLog].reverse().find((d) => d.kind.startsWith("rtc:"))?.detail;

  // Reset wizard state when call ends
  useEffect(() => {
    if (!calling && !connected) {
      // Keep createdAgent/readyAgent visible after call ends
      setPreview(null);
      setQuestion(null);
    }
  }, [calling, connected]);

  const handleEndCall = useCallback(async () => {
    await endCall();
  }, [endCall]);

  const handleDismiss = useCallback(() => {
    setCreatedAgent(null);
    setReadyAgent(null);
  }, []);

  const isActive = calling || connected;
  const hasResults = createdAgent || readyAgent;

  // Idle CTA bar
  if (!isActive && !hasResults && !error) {
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

  // Error state (call failed with no active session and no results)
  if (!isActive && !hasResults && error) {
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

          {/* Center: Question / Preview / Created */}
          <div className="flex-1 min-w-0">
            {/* Question overlay */}
            {question && (
              <div>
                <p className="text-sm text-white font-medium mb-2">
                  <MessageCircle className="w-3.5 h-3.5 inline mr-1.5 text-purple-400" />
                  {question.question}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {question.options?.map((option, i) => (
                    <span
                      key={i}
                      className="px-2.5 py-1 bg-purple-600/30 border border-purple-500/40 rounded-lg text-xs text-purple-200"
                    >
                      {option}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Preview card */}
            {preview && !question && (
              <div className="flex items-center gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white text-sm">{preview.name || "New Agent"}</span>
                    <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-300 text-[10px] rounded-full border border-yellow-500/30">
                      Preview
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 truncate">{preview.role || "Assistant"}</p>
                </div>
                {preview.functions?.length > 0 && (
                  <div className="flex flex-wrap gap-1 shrink-0">
                    {preview.functions.slice(0, 3).map((fn) => (
                      <span key={fn} className="px-1.5 py-0.5 bg-blue-500/20 text-blue-300 text-[10px] rounded-full border border-blue-500/30">
                        {fn.replace(/_/g, " ")}
                      </span>
                    ))}
                    {preview.functions.length > 3 && (
                      <span className="text-[10px] text-gray-500">+{preview.functions.length - 3}</span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Agent created */}
            {createdAgent && !preview && !question && (
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-green-400 shrink-0" />
                <span className="text-sm text-green-300 font-medium">Created: {createdAgent.name}</span>
                <span className="text-xs text-gray-400">{createdAgent.role}</span>
                {readyAgent && (
                  <span className="flex items-center gap-1 text-xs text-green-400 ml-2">
                    <Check className="w-3 h-3" />
                    Ready
                  </span>
                )}
              </div>
            )}

            {/* Idle state during active call (no events yet) */}
            {isActive && !question && !preview && !createdAgent && (
              <p className="text-sm text-gray-400">Speak to the wizard to start building your agent...</p>
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
            {hasResults && !isActive && (
              <button
                type="button"
                onClick={handleDismiss}
                aria-label="Dismiss wizard results"
                className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors"
              >
                <X className="w-4 h-4" aria-hidden="true" />
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
