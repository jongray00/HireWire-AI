// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

let mockClient;
let mockSession;

beforeEach(() => {
  mockSession = {
    on: vi.fn(),
    start: vi.fn(() => Promise.resolve()),
    hangup: vi.fn(() => Promise.resolve()),
  };
  mockClient = {
    on: vi.fn(),
    dial: vi.fn(() => Promise.resolve(mockSession)),
  };
  vi.doMock("@signalwire/js", () => ({
    SignalWire: vi.fn(() => Promise.resolve(mockClient)),
  }));
  global.fetch = vi.fn((url) => {
    if (url.endsWith("/api/auth/session")) return Promise.resolve({ ok: true });
    if (url.endsWith("/api/signalwire/widget-token"))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ token: "tok" }) });
    return Promise.reject(new Error("unexpected fetch: " + url));
  });

  // Mock navigator.mediaDevices.getUserMedia so mic preflight passes
  const mockTrack = {
    kind: "audio",
    label: "Mock Microphone",
    enabled: true,
    muted: false,
    readyState: "live",
    getSettings: () => ({}),
    stop: vi.fn(),
  };
  const mockStream = {
    getAudioTracks: () => [mockTrack],
    getTracks: () => [mockTrack],
  };
  Object.defineProperty(global.navigator, "mediaDevices", {
    value: {
      getUserMedia: vi.fn(() => Promise.resolve(mockStream)),
    },
    writable: true,
    configurable: true,
  });

  // Reset module registry so vi.doMock takes effect for each test
  vi.resetModules();
});

describe("useWizardCall", () => {
  it("forwards SDK partial recognition events to onTranscript", async () => {
    const onTranscript = vi.fn();
    const { useWizardCall } = await import("../useWizardCall.js");
    const { result } = renderHook(() => useWizardCall({ onTranscript }));

    await act(async () => {
      await result.current.startCall();
    });

    // Find the partial-recognition handler the hook subscribed to. The hook
    // should subscribe to the SDK's partial event under one of these names.
    const partialHandler = (mockClient.on.mock.calls.find(
      ([name]) => name === "prompt" || name === "call.updated"
    ) || [])[1];
    expect(partialHandler).toBeDefined();

    act(() => {
      partialHandler({ partial_recognition: { text: "hello there", final: false } });
    });

    expect(onTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", text: "hello there", isPartial: true })
    );
  });

  it("forwards wizard_said user_event to onTranscript as wizard role", async () => {
    const onTranscript = vi.fn();
    const { useWizardCall } = await import("../useWizardCall.js");
    const { result } = renderHook(() => useWizardCall({ onTranscript }));

    await act(async () => {
      await result.current.startCall();
    });

    const userEventHandler = mockClient.on.mock.calls.find(([name]) => name === "user_event")?.[1];
    expect(userEventHandler).toBeDefined();

    act(() => {
      userEventHandler({ event: { type: "wizard_said", text: "Welcome!" } });
    });

    expect(onTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ role: "wizard", text: "Welcome!", isPartial: false })
    );
  });

  it("does not call onTranscript for non-transcript user_events (regression)", async () => {
    const onEvent = vi.fn();
    const onTranscript = vi.fn();
    const { useWizardCall } = await import("../useWizardCall.js");
    const { result } = renderHook(() => useWizardCall({ onEvent, onTranscript }));

    await act(async () => {
      await result.current.startCall();
    });

    const userEventHandler = mockClient.on.mock.calls.find(([name]) => name === "user_event")?.[1];
    expect(userEventHandler).toBeDefined();

    act(() => {
      userEventHandler({ event: { type: "agent_preview", name: "Sarah" } });
    });

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "agent_preview" }));
    expect(onTranscript).not.toHaveBeenCalled();
  });
});
