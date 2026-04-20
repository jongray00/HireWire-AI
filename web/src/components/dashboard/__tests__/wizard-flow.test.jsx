import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
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
    };
  },
}));

describe("Wizard Flow Integration", () => {
  it("handles full wizard flow: question → preview → created → ready", () => {
    const onCreated = vi.fn();
    const { rerender } = render(<WizardBanner onAgentCreated={onCreated} />);

    // Step 1: Wizard asks a question
    act(() => {
      capturedOnEvent({ type: "agent_config_question", question: "What kind of agent?", options: ["Support", "Sales"], field: "role" });
    });
    rerender(<WizardBanner onAgentCreated={onCreated} />);
    expect(screen.getByText("What kind of agent?")).toBeDefined();
    expect(screen.getByText("Support")).toBeDefined();

    // Step 2: Wizard shows preview
    act(() => {
      capturedOnEvent({ type: "agent_preview", name: "Support Bot", role: "Customer Support", voice: "openai.nova", functions: ["transfer_to_human", "end_call"] });
    });
    rerender(<WizardBanner onAgentCreated={onCreated} />);
    expect(screen.getByText("Support Bot")).toBeDefined();
    expect(screen.getByText("Preview")).toBeDefined();

    // Step 3: Agent created
    act(() => {
      capturedOnEvent({ type: "agent_created", employee: { name: "Support Bot", role: "Customer Support", id: "abc123" } });
    });
    rerender(<WizardBanner onAgentCreated={onCreated} />);
    expect(screen.getByText(/Created: Support Bot/)).toBeDefined();
    expect(onCreated).toHaveBeenCalledWith({ name: "Support Bot", role: "Customer Support", id: "abc123" });

    // Step 4: Agent ready
    act(() => {
      capturedOnEvent({ type: "agent_ready", employee_id: "abc123", swml_route: "/swml/abc123" });
    });
    rerender(<WizardBanner onAgentCreated={onCreated} />);
    expect(screen.getByText("Ready")).toBeDefined();
  });
});
