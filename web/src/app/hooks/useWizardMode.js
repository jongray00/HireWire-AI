// web/src/app/hooks/useWizardMode.js
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const ENDPOINT = "/api/settings/wizard-mode";

export function useWizardMode() {
  const [enabled, setEnabledState] = useState(false);
  const [loading, setLoading] = useState(true);
  const inFlightAbort = useRef(null);
  const enabledRef = useRef(false);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(ENDPOINT);
        if (!res.ok) throw new Error("GET failed: " + res.status);
        const data = await res.json();
        if (!cancelled) setEnabledState(data?.enabled === true);
      } catch (err) {
        console.warn("[useWizardMode] falling back to disabled:", err.message);
        if (!cancelled) setEnabledState(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setEnabled = useCallback(async (next) => {
    const previous = enabledRef.current;
    enabledRef.current = next;
    setEnabledState(next);

    if (inFlightAbort.current) inFlightAbort.current.abort();
    const controller = new AbortController();
    inFlightAbort.current = controller;

    try {
      const res = await fetch(ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error("PUT failed: " + res.status);
      const data = await res.json();
      if (controller.signal.aborted) return;
      const confirmed = data?.enabled === true;
      enabledRef.current = confirmed;
      setEnabledState(confirmed);
    } catch (err) {
      if (err?.name === "AbortError") return;
      enabledRef.current = previous;
      setEnabledState(previous);
      throw err;
    } finally {
      if (inFlightAbort.current === controller) {
        inFlightAbort.current = null;
      }
    }
  }, []);

  return { enabled, loading, setEnabled };
}
