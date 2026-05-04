"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Wand2, Phone, PhoneOff, RefreshCw, CheckCircle2 } from "lucide-react";
import { useWizardCall } from "@/app/hooks/useWizardCall";
import { useDomainAutoSync } from "@/app/hooks/useDomainAutoSync";
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
export default function WizardBanner({ onAgentCreated, variant = "global" }) {
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

  const {
    startCall,
    endCall,
    calling,
    connected,
    connectionState,
    error,
    failedToConnect,
    clearFailedToConnect,
    videoRef,
    debugLog = [],
  } = useWizardCall({ onEvent: handleWizardEvent, onTranscript: handleTranscript });

  // Keep saved app_domain in lockstep with the URL we're loaded from. Stale
  // domains (rotated ngrok URL) make SignalWire fetch SWML from a dead host
  // and hang up with NORMAL_CLEARING the moment a wizard call dials.
  const {
    status: domainSyncStatus,
    savedDomain,
    currentDomain,
    sync: syncDomain,
    lastSyncedAt,
  } = useDomainAutoSync();

  // Briefly surface the proactive auto-sync result so the user sees it worked.
  const [showSyncToast, setShowSyncToast] = useState(false);
  useEffect(() => {
    if (domainSyncStatus !== "synced" || !lastSyncedAt) return;
    setShowSyncToast(true);
    const t = setTimeout(() => setShowSyncToast(false), 5000);
    return () => clearTimeout(t);
  }, [domainSyncStatus, lastSyncedAt]);

  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState(null);

  const handleSyncAndRetry = useCallback(async () => {
    setRecovering(true);
    setRecoveryError(null);
    try {
      const result = await syncDomain();
      if (!result?.ok) {
        setRecoveryError(
          result?.error ||
            (result?.reason === "localhost"
              ? "Dashboard is running on localhost — open it via your public URL (e.g. ngrok) and try again."
              : "Couldn't sync the application domain.")
        );
        return;
      }
      clearFailedToConnect();
      await startCall();
    } catch (e) {
      setRecoveryError(e.message);
    } finally {
      setRecovering(false);
    }
  }, [syncDomain, clearFailedToConnect, startCall]);

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

  // Allow other components (e.g. WizardCreationCanvas) to request hangup.
  useEffect(() => {
    const onRequestEnd = () => { handleEndCall(); };
    window.addEventListener("wizard-end-call", onRequestEnd);
    return () => window.removeEventListener("wizard-end-call", onRequestEnd);
  }, [handleEndCall]);

  const isActive = calling || connected;

  // Outer page margins — applied when this banner is mounted globally in the
  // dashboard layout. When embedded inline (e.g. inside a card column), the
  // surrounding container owns spacing, so we drop these.
  const outer = variant === "inline" ? "" : "mx-4 lg:mx-6 mt-4 mb-0";

  // Small reusable banners.
  const SyncToast = showSyncToast ? (
    <div className={`${outer} px-4 py-2 bg-[#0A0A0A] border-l-2 border-l-[#2553F4] border-y border-r border-[#1F1F1F] flex items-center gap-2`}>
      <CheckCircle2 className="w-3.5 h-3.5 text-[#2553F4]" />
      <span className="hw-mono text-[10px] tracking-[0.16em] uppercase text-[#2553F4]">
        Webhooks synced — <span className="text-[#8A8A8A] normal-case tracking-normal">{currentDomain}</span>
      </span>
    </div>
  ) : null;

  const RecoveryPanel = (
    <div className={`${outer} px-4 py-3 bg-[#0A0A0A] border-l-2 border-l-[#E84B5B] border-y border-r border-[#1F1F1F]`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 border border-[#E84B5B]/40 flex items-center justify-center shrink-0">
            <RefreshCw className="w-4 h-4 text-[#E84B5B]" />
          </div>
          <div className="min-w-0">
            <p className="hw-mono text-[10px] tracking-[0.18em] uppercase text-[#E84B5B]">
              Couldn&apos;t reach the agent
            </p>
            <p className="text-xs text-[#A3A3A3] mt-1">
              The wizard call ended before connecting — usually this means
              the SignalWire webhook URL is stale.
            </p>
            {savedDomain && currentDomain && savedDomain !== currentDomain && (
              <p className="text-[10px] text-[#737373] mt-1 hw-mono break-all">
                saved: {savedDomain} → current: {currentDomain}
              </p>
            )}
            {recoveryError && (
              <p className="text-xs text-[#E84B5B] mt-1">{recoveryError}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              clearFailedToConnect();
              setRecoveryError(null);
            }}
            className="hw-mono text-[10px] tracking-[0.16em] uppercase px-2 py-1 text-[#737373] hover:text-[#FAFAFA] transition-colors"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={handleSyncAndRetry}
            disabled={recovering}
            aria-label="Sync application domain and retry call"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#E84B5B] hover:bg-[#D63A4A] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-white ${recovering ? "animate-spin" : ""}`} />
            <span className="hw-mono text-[10px] tracking-[0.16em] uppercase text-white whitespace-nowrap font-medium">
              {recovering ? "Syncing" : "Sync & retry"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );

  // Idle CTA bar
  if (!isActive && !error && !failedToConnect) {
    if (variant === "button-only") {
      return (
        <>
          {SyncToast}
          <button
            type="button"
            onClick={startCall}
            aria-label="Start Setup Wizard call"
            className="relative inline-flex items-center gap-2 px-5 py-2.5 bg-[#2553F4] hover:bg-[#1E46DC] transition-colors"
          >
            <span className="hw-pulse-ring" aria-hidden="true"></span>
            <span className="hw-pulse-ring hw-pulse-ring-delayed" aria-hidden="true"></span>
            <Phone className="w-4 h-4 text-white relative" />
            <span className="hw-mono text-[11px] tracking-[0.16em] uppercase text-white font-semibold relative">Call Wizard</span>
          </button>
        </>
      );
    }
    return (
      <>
        {SyncToast}
        <div className={outer}>
          <button
            type="button"
            onClick={startCall}
            aria-label="Start Setup Wizard call"
            className="relative w-full flex items-center justify-between px-6 py-5 bg-[#0A0A0A] border border-[#1F1F1F] hover:border-[#2553F4]/60 hover:bg-[#0F1424] transition-colors group"
          >
            <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#2553F4]" />
            <div className="flex items-center gap-4 text-left">
              <div className="w-11 h-11 border border-[#2553F4] flex items-center justify-center shrink-0">
                <Wand2 className="w-5 h-5 text-[#2553F4]" />
              </div>
              <div>
                <div className="hw-mono text-[10px] tracking-[0.18em] uppercase text-[#737373] group-hover:text-[#A3A3A3] mb-1">
                  Setup Wizard
                </div>
                <div className="text-base text-[#FAFAFA] font-medium">
                  Build a new AI employee by voice
                </div>
                <div className="text-xs text-[#A3A3A3] mt-0.5">
                  Talk to the wizard — it&apos;ll create the agent for you in about a minute.
                </div>
              </div>
            </div>
            <div className="relative shrink-0">
              <span className="hw-pulse-ring" aria-hidden="true"></span>
              <span className="hw-pulse-ring hw-pulse-ring-delayed" aria-hidden="true"></span>
              <div className="relative flex items-center gap-2 px-5 py-2.5 bg-[#2553F4] group-hover:bg-[#1E46DC] transition-colors">
                <Phone className="w-4 h-4 text-white" />
                <span className="hw-mono text-[11px] tracking-[0.16em] uppercase text-white font-semibold">Call Wizard</span>
              </div>
            </div>
          </button>
        </div>
      </>
    );
  }

  // Failed-to-connect state — webhook unreachable is the dominant cause; offer auto-sync + retry.
  if (!isActive && failedToConnect) {
    return RecoveryPanel;
  }

  // Generic error state (call failed for some other reason)
  if (!isActive && error) {
    return (
      <div className={outer}>
        <div className="relative flex items-center justify-between px-4 py-3 bg-[#0A0A0A] border border-[#1F1F1F]">
          <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#E84B5B]" />
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 border border-[#E84B5B]/40 flex items-center justify-center">
              <Wand2 className="w-4 h-4 text-[#E84B5B]" />
            </div>
            <div>
              <p className="hw-mono text-[10px] tracking-[0.18em] uppercase text-[#E84B5B]">Wizard call failed</p>
              <p className="text-xs text-[#A3A3A3] mt-0.5">{error}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={startCall}
            aria-label="Retry Setup Wizard call"
            className="flex items-center gap-2 px-3 py-1.5 bg-[#2553F4] hover:bg-[#1E46DC] transition-colors"
          >
            <Phone className="w-3.5 h-3.5 text-white" />
            <span className="hw-mono text-[10px] tracking-[0.16em] uppercase text-white font-medium">Retry</span>
          </button>
        </div>
      </div>
    );
  }

  // Compact active state for button-only variant — gives immediate visual
  // feedback (the moment the user clicks, this replaces the pill) so the user
  // doesn't see a "dead" button while the SignalWire SDK does its async setup.
  // The full call experience lives in WizardCreationCanvas.
  if (variant === "button-only" && isActive) {
    const statusLabel =
      connectionState === "connected" ? "Live" :
      connectionState === "ringing"   ? "Ringing" :
      "Connecting";

    return (
      <>
        {/* Hidden video sink — required by the SignalWire SDK as rootElement
            for the WebRTC session. Not visible to the user (audio-only call). */}
        <div ref={videoRef} className="hidden" aria-hidden="true" />
        <div className="inline-flex items-center gap-3 px-4 py-2.5 bg-[#0A0A0A] border border-[#2553F4]/40">
          <span className="w-2 h-2 bg-[#2553F4] rounded-full animate-pulse" aria-hidden="true" />
          <span className="hw-mono text-[11px] tracking-[0.16em] uppercase text-[#FAFAFA]">
            {statusLabel}
          </span>
          <button
            type="button"
            onClick={handleEndCall}
            aria-label="End wizard call"
            className="ml-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#E84B5B] hover:bg-[#D63A4A] transition-colors"
          >
            <PhoneOff className="w-3 h-3 text-white" />
            <span className="hw-mono text-[10px] tracking-[0.16em] uppercase text-white font-medium">End</span>
          </button>
        </div>
      </>
    );
  }

  // Active banner or results
  return (
    <div className={outer}>
      <div className="relative bg-[#0A0A0A] border border-[#1F1F1F] overflow-hidden">
        <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#2553F4]" />
        {/* Banner header */}
        <div className="flex items-center gap-4 p-4">
          {/* Left: Audio/connection area */}
          <div className="flex items-center gap-3 shrink-0">
            <div
              ref={videoRef}
              className="w-12 h-12 border border-[#2553F4] flex items-center justify-center"
            >
              <Wand2 className="w-5 h-5 text-[#2553F4]" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <span className="hw-mono text-[10px] tracking-[0.18em] uppercase text-[#2553F4]">Setup Wizard</span>
                {isActive && (
                  <span className="flex items-center gap-1.5 hw-mono text-[10px] tracking-[0.14em] uppercase">
                    {connectionState === "connecting" && (
                      <span className="text-[#FAFAFA]">Connecting…</span>
                    )}
                    {connectionState === "ringing" && (
                      <span className="text-[#FAFAFA]">Ringing…</span>
                    )}
                    {connectionState === "connected" && (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-[#2553F4] animate-pulse" />
                        <span className="text-[#2553F4]">Live</span>
                      </>
                    )}
                  </span>
                )}
              </div>
              {error && <p className="text-xs text-[#2553F4] mt-1">{error}</p>}
            </div>
          </div>

          {/* Center: hint during active call */}
          <div className="flex-1 min-w-0">
            {isActive && (
              <p className="text-sm text-[#8A8A8A]">
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
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#E84B5B] hover:bg-[#D63A4A] transition-colors"
              >
                <PhoneOff className="w-3.5 h-3.5 text-white" />
                <span className="hw-mono text-[10px] tracking-[0.16em] uppercase text-white font-medium">End</span>
              </button>
            )}
          </div>
        </div>

        {/* Debug panel */}
        <div className="border-t border-[#1F1F1F] px-4 py-2 text-xs text-[#5C5C5C]">
          <button
            type="button"
            onClick={() => setShowDebug((s) => !s)}
            className="flex items-center gap-2 hover:text-[#FAFAFA] transition-colors"
          >
            <span className="hw-mono text-[10px] tracking-[0.16em] uppercase">Debug</span>
            <span className="hw-mono text-[10px] px-1.5 py-0.5 border border-[#1F1F1F] text-[#8A8A8A]">
              mic: {String(micStatus)}
            </span>
            <span className="hw-mono text-[10px] text-[#5C5C5C]">({debugLog.length} events)</span>
            <span className="text-[10px] text-[#5C5C5C]">{showDebug ? "▲" : "▼"}</span>
          </button>
          {showDebug && (
            <div className="mt-2 max-h-48 overflow-y-auto space-y-0.5 hw-mono text-[10px] bg-black border border-[#1F1F1F] p-2">
              {debugLog.slice().reverse().map((e, i) => (
                <div key={`${e.t}-${i}`} className="flex gap-2">
                  <span className="text-[#5C5C5C] shrink-0">{new Date(e.t).toLocaleTimeString()}</span>
                  <span className="text-[#2553F4] shrink-0">{e.kind}</span>
                  <span className="text-[#8A8A8A] break-all">{typeof e.detail === "object" ? JSON.stringify(e.detail) : String(e.detail)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
