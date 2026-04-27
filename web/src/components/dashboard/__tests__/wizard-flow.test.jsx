import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import WizardBanner from "../WizardBanner";

// Mock useWizardCall to expose onEvent
let capturedOnEvent;
vi.mock("@/app/hooks/useWizardCall", () => ({
  useWizardCall: ({ onEvent } = {}) => {
    capturedOnEvent = onEvent;
    return {
      startCall: vi.fn(),
      endCall: vi.fn(),
      calling: true,
      connected: true,
      connectionState: "connected",
      error: null,
      videoRef: { current: null },
      debugLog: [],
    };
  },
}));

describe("Wizard Flow Integration", () => {
  it("broadcasts all wizard events via window wizard-event (banner no longer renders cards)", () => {
    const dispatchedEvents = [];
    const listener = (e) => dispatchedEvents.push(e.detail);
    window.addEventListener("wizard-event", listener);

    render(<WizardBanner />);

    // Step 1: question event → broadcast
    act(() => {
      capturedOnEvent({ type: "agent_config_question", question: "What kind of agent?", options: ["Support", "Sales"], field: "role" });
    });
    expect(dispatchedEvents).toHaveLength(1);
    expect(dispatchedEvents[0].type).toBe("agent_config_question");
    expect(dispatchedEvents[0].question).toBe("What kind of agent?");

    // Step 2: preview event → broadcast
    act(() => {
      capturedOnEvent({ type: "agent_preview", name: "Support Bot", role: "Customer Support", voice: "openai.nova", functions: ["transfer_to_human", "end_call"] });
    });
    expect(dispatchedEvents).toHaveLength(2);
    expect(dispatchedEvents[1].type).toBe("agent_preview");
    expect(dispatchedEvents[1].name).toBe("Support Bot");

    // Step 3: created event → broadcast
    act(() => {
      capturedOnEvent({ type: "agent_created", employee: { name: "Support Bot", role: "Customer Support", id: "abc123" } });
    });
    expect(dispatchedEvents).toHaveLength(3);
    expect(dispatchedEvents[2].type).toBe("agent_created");

    // Step 4: ready event → broadcast
    act(() => {
      capturedOnEvent({ type: "agent_ready", employee_id: "abc123", swml_route: "/swml/abc123" });
    });
    expect(dispatchedEvents).toHaveLength(4);
    expect(dispatchedEvents[3].type).toBe("agent_ready");

    window.removeEventListener("wizard-event", listener);
  });
});
