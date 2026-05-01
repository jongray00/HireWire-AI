"use client";

import { useEffect, useState, useCallback, useRef } from "react";

/**
 * useDomainAutoSync — keep the saved app_domain in lockstep with the URL the
 * dashboard is actually loaded from.
 *
 * Why: with rotating ngrok URLs, the persisted app_domain quickly goes stale.
 * SignalWire then fetches SWML from the dead URL and hangs up with
 * NORMAL_CLEARING the moment a wizard call dials. The `Auto` button in
 * Settings already does the right thing — it sets domain to
 * window.location.origin — but only if a human notices and clicks Save & Sync.
 *
 * On mount, this hook does that automatically: compare current origin to the
 * saved domain; if different (and we're not on localhost), POST the new
 * domain and trigger a webhook reconcile so all SWML resources point here.
 *
 * Also exposes `sync()` for reactive recovery (e.g. a "retry" button after a
 * call failed to connect).
 */
export function useDomainAutoSync({ enabled = true } = {}) {
  // idle | checking | in-sync | syncing | synced | error | skipped
  const [status, setStatus] = useState("idle");
  const [savedDomain, setSavedDomain] = useState(null);
  const [currentDomain, setCurrentDomain] = useState(null);
  const [error, setError] = useState(null);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const ranRef = useRef(false);

  const isLocalhost = useCallback((origin) => {
    try {
      const u = new URL(origin);
      return u.hostname === "localhost" || u.hostname === "127.0.0.1";
    } catch {
      return false;
    }
  }, []);

  const sync = useCallback(async () => {
    const origin =
      typeof window !== "undefined" ? window.location.origin : null;
    if (!origin) return { ok: false, reason: "no-origin" };
    if (isLocalhost(origin)) {
      setStatus("skipped");
      return { ok: false, reason: "localhost" };
    }

    setStatus("syncing");
    setError(null);

    try {
      const saveRes = await fetch("/api/settings/domain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: origin }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) {
        throw new Error(saveData.error || `Save failed (${saveRes.status})`);
      }
      setSavedDomain(saveData.domain);

      const reconcileRes = await fetch(
        "/api/signalwire/reconcile-webhooks",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const reconcileData = await reconcileRes.json().catch(() => ({}));
      if (!reconcileRes.ok) {
        throw new Error(
          reconcileData.error || `Reconcile failed (${reconcileRes.status})`
        );
      }

      setStatus("synced");
      setLastSyncedAt(Date.now());
      return { ok: true, domain: saveData.domain, reconcile: reconcileData };
    } catch (e) {
      setStatus("error");
      setError(e.message);
      return { ok: false, reason: "exception", error: e.message };
    }
  }, [isLocalhost]);

  useEffect(() => {
    if (!enabled) return;
    if (ranRef.current) return;
    ranRef.current = true;

    let cancelled = false;
    (async () => {
      const origin = window.location.origin;
      setCurrentDomain(origin);
      if (isLocalhost(origin)) {
        setStatus("skipped");
        return;
      }
      setStatus("checking");
      try {
        const res = await fetch("/api/settings/domain");
        const data = await res.json();
        if (cancelled) return;
        const saved = (data?.domain || "").replace(/\/+$/, "");
        const current = origin.replace(/\/+$/, "");
        setSavedDomain(saved || null);
        if (saved && saved === current) {
          setStatus("in-sync");
          return;
        }
        await sync();
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setError(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, isLocalhost, sync]);

  return {
    status,
    savedDomain,
    currentDomain,
    error,
    lastSyncedAt,
    sync,
  };
}
