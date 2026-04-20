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
 * @returns {{ startCall, endCall, calling, connected, connectionState, error, videoRef }}
 */
export function useWizardCall({ onEvent } = {}) {
  const [calling, setCalling] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [connectionState, setConnectionState] = useState("idle"); // idle | connecting | ringing | connected
  const videoRef = useRef(null);
  const clientRef = useRef(null);
  const sessionRef = useRef(null);

  // I2: Keep onEvent ref stable so the listener always calls the latest callback.
  const onEventRef = useRef(onEvent);
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  // C1: Unmount cleanup — hang up any active call and release SDK references.
  useEffect(() => {
    return () => {
      sessionRef.current?.hangup().catch(() => {});
      sessionRef.current = null;
      clientRef.current = null;
    };
  }, []);

  const startCall = useCallback(async () => {
    // I3: Re-entrancy guard — bail out if a client already exists.
    if (clientRef.current) return;

    setCalling(true);
    setError(null);
    setConnectionState("connecting");

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
      client.on("user_event", (params) => {
        const eventData = params?.event || params;
        onEventRef.current?.(eventData); // I2: always uses latest callback
      });

      setConnectionState("ringing");

      // 5. Dial the wizard
      const session = await client.dial({
        to: "/public/wizard-agent",
        audio: true,
        video: false,
        rootElement: videoRef.current || undefined,
      });
      sessionRef.current = session;

      // 6. Session events
      session.on("call.joined", () => {
        setConnected(true);
        setConnectionState("connected");
      });

      const cleanup = () => {
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
    } catch (err) {
      // I5: Clean up client/session refs on error so re-entrancy guard resets.
      console.error("[useWizardCall] Error:", err);
      setError(err.message);
      setCalling(false);
      setConnectionState("idle");
      try { await clientRef.current?.disconnect?.(); } catch {}
      clientRef.current = null;
      sessionRef.current = null;
    }
  }, []); // I2: no onEvent in deps — reads via onEventRef

  const endCall = useCallback(async () => {
    try {
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
  };
}
