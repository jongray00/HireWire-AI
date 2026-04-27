"use client";

import { useState, useRef, useCallback, useEffect } from "react";

/**
 * useWizardCall — Direct SignalWire JS SDK integration for inline wizard calls.
 *
 * Unlike useCallWidget (which creates a popup <call-widget>), this hook
 * mounts audio/video into a provided DOM ref so the call lives inline
 * on the page.
 *
 * @param {object} [options]
 * @param {(event: object) => void} [options.onEvent] - Called on wizard SWAIG events (agent_preview, agent_config_question, agent_created, agent_ready)
 * @param {(entry: {role: string, text: string, isPartial: boolean, t: number}) => void} [options.onTranscript] - Called for live transcript entries (wizard_said events and SDK partial recognition)
 * @returns {{ startCall, endCall, calling, connected, connectionState, error, videoRef, debugLog }}
 */
export function useWizardCall({ onEvent, onTranscript } = {}) {
  const [calling, setCalling] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [connectionState, setConnectionState] = useState("idle"); // idle | connecting | ringing | connected
  const [debugLog, setDebugLog] = useState([]);
  const videoRef = useRef(null);
  const clientRef = useRef(null);
  const sessionRef = useRef(null);

  // I2: Keep onEvent/onTranscript refs stable so listeners always call the latest callbacks.
  const onEventRef = useRef(onEvent);
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);

  // C1: Unmount cleanup — hang up any active call and release SDK references.
  useEffect(() => {
    return () => {
      if (sessionRef.current?.__pollInterval) clearInterval(sessionRef.current.__pollInterval);
      sessionRef.current?.hangup().catch(() => {});
      sessionRef.current = null;
      clientRef.current = null;
    };
  }, []);

  const startCall = useCallback(async () => {
    const appendDebug = (kind, detail) => {
      setDebugLog((prev) => [...prev.slice(-99), { t: Date.now(), kind, detail }]);
      console.log(`[WizardCall:${kind}]`, detail);
    };

    // I3: Re-entrancy guard — bail out if a client already exists.
    if (clientRef.current) return;

    // Mic pre-flight diagnostics
    try {
      if (navigator.permissions) {
        const permStatus = await navigator.permissions.query({ name: "microphone" });
        appendDebug("mic:permission", permStatus.state);
        permStatus.onchange = () => appendDebug("mic:permission-changed", permStatus.state);
      }
    } catch (e) {
      appendDebug("mic:permission-error", String(e));
    }

    setCalling(true);
    setError(null);
    setConnectionState("connecting");

    try {
      const testStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = testStream.getAudioTracks()[0];
      appendDebug("mic:preflight-ok", {
        label: track?.label,
        enabled: track?.enabled,
        muted: track?.muted,
        readyState: track?.readyState,
        settings: track?.getSettings?.(),
      });
      // Release immediately — the SDK will request its own
      testStream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      appendDebug("mic:preflight-failed", { name: e.name, message: e.message });
      setError(`Microphone error: ${e.message}`);
      setCalling(false);
      setConnectionState("idle");
      return;
    }

    try {
      // 1. Verify session
      const sessionRes = await fetch("/api/auth/session");
      if (!sessionRes.ok) {
        throw new Error("Not authenticated");
      }

      // 2. Get Fabric token
      const tokenRes = await fetch("/api/signalwire/widget-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriberReference: "sally_sales_default_user" }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.json();
        throw new Error(err.error || "Failed to get token");
      }

      const { token } = await tokenRes.json();

      // 3. Import and create SignalWire client
      const SignalWireModule = await import("@signalwire/js");
      const SignalWire =
        SignalWireModule.SignalWire || SignalWireModule.default || SignalWireModule;

      const client = await SignalWire({
        token,
        logLevel: "info",
      });
      clientRef.current = client;

      // 4. Listen for user events (wizard SWAIG events)
      // user_event handler — split wizard_said into onTranscript, rest into onEvent
      client.on("user_event", (params) => {
        const eventData = params?.event || params;
        appendDebug("client:user_event", eventData);
        if (eventData?.type === "wizard_said") {
          if (onTranscriptRef.current) {
            onTranscriptRef.current({
              role: "wizard",
              text: eventData.text || "",
              isPartial: false,
              t: Date.now(),
            });
          }
          return;
        }
        onEventRef.current?.(eventData); // I2: always uses latest callback
      });

      // Subscribe to SDK partial-recognition events for user-side transcript.
      // The exact event name varies by @signalwire/js version, so subscribe
      // defensively to both candidate names.
      const handlePartial = (params) => {
        if (!onTranscriptRef.current) return;
        const partial = params?.partial_recognition || params?.detail?.partial_recognition;
        if (!partial?.text) return;
        onTranscriptRef.current({
          role: "user",
          text: partial.text,
          isPartial: !partial.final,
          t: Date.now(),
        });
      };
      try { client.on("prompt", handlePartial); } catch {}
      try { client.on("call.updated", handlePartial); } catch {}

      setConnectionState("ringing");

      // 5. Dial the wizard
      const session = await client.dial({
        to: "/public/wizard-agent",
        audio: true,
        video: false,
        rootElement: videoRef.current || undefined,
      });
      sessionRef.current = session;

      // Log EVERY SDK event on both client and session for diagnostics
      const CLIENT_EVENTS = ["session.connected", "session.disconnected", "session.auth_error", "session.unknown"];
      const SESSION_EVENTS = [
        "call.joined", "call.left", "call.ended", "call.state", "call.updated",
        "call.play.started", "call.play.ended", "call.play.failed",
        "member.joined", "member.left", "member.updated", "member.talking",
        "layout.changed",
      ];
      CLIENT_EVENTS.forEach((evt) => {
        try { client.on(evt, (p) => appendDebug(`client:${evt}`, p)); } catch {}
      });
      SESSION_EVENTS.forEach((evt) => {
        try { session.on(evt, (p) => appendDebug(`session:${evt}`, p)); } catch {}
      });

      // 6. Session events
      session.on("call.joined", () => {
        setConnected(true);
        setConnectionState("connected");
      });

      const cleanup = () => {
        if (sessionRef.current?.__pollInterval) clearInterval(sessionRef.current.__pollInterval);
        setConnected(false);
        setCalling(false);
        setConnectionState("idle");
        clientRef.current = null;
        sessionRef.current = null;
      };

      session.on("call.left", cleanup);
      session.on("call.ended", cleanup);
      session.on("call.state", (params) => {
        const state = params?.payload?.call_state || params?.call_state || params?.state;
        if (state === "destroy" || state === "hangup" || state === "ended") {
          cleanup();
        }
      });

      await session.start();

      // Poll audio sender state every 3 seconds
      const pollInterval = setInterval(() => {
        try {
          const senders =
            session?.peer?.instance?.getSenders?.() ||
            session?.peer?.getSenders?.() ||
            [];
          const audioSenders = senders.filter((s) => s.track?.kind === "audio");
          if (audioSenders.length === 0) {
            appendDebug("rtc:no-audio-sender", { totalSenders: senders.length });
          } else {
            audioSenders.forEach((s) => {
              appendDebug("rtc:audio-sender", {
                enabled: s.track.enabled,
                muted: s.track.muted,
                readyState: s.track.readyState,
                label: s.track.label,
              });
            });
          }
        } catch (e) {
          appendDebug("rtc:poll-error", String(e));
        }
      }, 3000);

      // Stash interval so cleanup can clear it
      sessionRef.current.__pollInterval = pollInterval;
    } catch (err) {
      // I5: Clean up client/session refs on error so re-entrancy guard resets.
      appendDebug("error", { message: err.message, stack: err.stack });
      console.error("[useWizardCall] Error:", err);
      setError(err.message);
      setCalling(false);
      setConnectionState("idle");
      if (sessionRef.current?.__pollInterval) clearInterval(sessionRef.current.__pollInterval);
      try { await clientRef.current?.disconnect?.(); } catch {}
      clientRef.current = null;
      sessionRef.current = null;
    }
  }, []); // I2: no onEvent in deps — reads via onEventRef

  const endCall = useCallback(async () => {
    try {
      if (sessionRef.current?.__pollInterval) clearInterval(sessionRef.current.__pollInterval);
      if (sessionRef.current) {
        await sessionRef.current.hangup();
      }
    } catch (err) {
      console.warn("[useWizardCall] Error ending call:", err);
    }
    setConnected(false);
    setCalling(false);
    setConnectionState("idle");
    clientRef.current = null;
    sessionRef.current = null;
  }, []);

  return {
    startCall,
    endCall,
    calling,
    connected,
    connectionState,
    error,
    videoRef,
    debugLog,
  };
}
