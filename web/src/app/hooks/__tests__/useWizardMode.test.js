// web/src/app/hooks/__tests__/useWizardMode.test.js
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import { useWizardMode } from "../useWizardMode";

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetchOnce(payload, { ok = true, status = 200 } = {}) {
  global.fetch.mockResolvedValueOnce({
    ok,
    status,
    json: async () => payload,
  });
}

describe("useWizardMode", () => {
  it("starts in loading state with enabled=false", () => {
    mockFetchOnce({ enabled: true }); // resolves later
    const { result } = renderHook(() => useWizardMode());
    expect(result.current.loading).toBe(true);
    expect(result.current.enabled).toBe(false);
  });

  it("populates enabled from the GET response", async () => {
    mockFetchOnce({ enabled: true });
    const { result } = renderHook(() => useWizardMode());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith("/api/settings/wizard-mode");
  });

  it("treats string 'true' from server as not-enabled (strict equality)", async () => {
    mockFetchOnce({ enabled: "true" });
    const { result } = renderHook(() => useWizardMode());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(false);
  });

  it("falls back to enabled=false on GET error", async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const { result } = renderHook(() => useWizardMode());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(false);
  });

  it("setEnabled(true) optimistically updates and persists", async () => {
    mockFetchOnce({ enabled: false }); // initial GET
    mockFetchOnce({ enabled: true });  // PUT response
    const { result } = renderHook(() => useWizardMode());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(result.current.enabled).toBe(true);
    const lastCall = global.fetch.mock.calls.at(-1);
    expect(lastCall[0]).toBe("/api/settings/wizard-mode");
    expect(lastCall[1].method).toBe("PUT");
    expect(lastCall[1].headers).toEqual({ "Content-Type": "application/json" });
    expect(lastCall[1].body).toBe(JSON.stringify({ enabled: true }));
  });

  it("reverts optimistic update when PUT returns non-ok", async () => {
    mockFetchOnce({ enabled: false }); // initial GET
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: "boom" }) });
    const { result } = renderHook(() => useWizardMode());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.setEnabled(true)).rejects.toThrow();
    });

    expect(result.current.enabled).toBe(false);
  });

  it("reverts optimistic update when PUT rejects with a network error", async () => {
    mockFetchOnce({ enabled: false }); // initial GET
    global.fetch.mockRejectedValueOnce(new Error("network down")); // PUT throws
    const { result } = renderHook(() => useWizardMode());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.setEnabled(true)).rejects.toThrow(/network down/);
    });

    expect(result.current.enabled).toBe(false);
  });

  it("setEnabled reference is stable across renders", async () => {
    mockFetchOnce({ enabled: false });
    const { result, rerender } = renderHook(() => useWizardMode());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const first = result.current.setEnabled;
    rerender();
    expect(result.current.setEnabled).toBe(first);
  });
});
