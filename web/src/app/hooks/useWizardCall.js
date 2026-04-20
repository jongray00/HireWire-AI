"use client";

import { useState, useRef, useCallback } from "react";

/**
 * useWizardCall — Direct SignalWire JS SDK integration for inline wizard calls.
 *
 * Unlike useCallWidget (which creates a popup <call-widget>), this hook
 * mounts audio/video into a provided DOM ref so the call lives inline
 * on the page.
 *
 * @returns {{ startCall, endCall, calling, connected, error, videoRef, onWizardEvent }}
 */
export function useWizardCall({ onEvent } = {}) {
  const [calling, setCalling] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [connectionState, setConnectionState] = useState("idle"); // idle | connecting | ringing | connected
  const videoRef = useRef(null);
  const clientRef = useRef(null);
  const sessionRef = useRef(null);

  const startCall = useCallback(async () => {
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
        if (onEvent) onEvent(eventData);
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
      console.error("[useWizardCall] Error:", err);
      setError(err.message);
      setCalling(false);
      setConnectionState("idle");
    }
  }, [onEvent]);

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
