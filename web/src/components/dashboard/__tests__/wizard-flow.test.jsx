import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";

let capturedOnEvent;
let capturedOnTranscript;

vi.mock("@/app/hooks/useWizardCall", () => ({
  useWizardCall: ({ onEvent, onTranscript } = {}) => {
    capturedOnEvent = onEvent;
    capturedOnTranscript = onTranscript;
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

import WizardCreationCanvas from "../WizardCreationCanvas";

describe("Wizard Flow Integration — full new sequence", () => {
  it("walks question → checkpoint(identity) → preview → update → checkpoints(voice/capabilities) → review → created → ready", () => {
    const { rerender } = render(<WizardCreationCanvas />);

    // Step 1: First question opens the canvas
    act(() => {
      capturedOnEvent({ type: "agent_config_question", question: "What kind of agent?", options: ["Support", "Sales"], field: "role" });
    });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("wizard-canvas")).toBeDefined();
    expect(screen.getByText("What kind of agent?")).toBeDefined();

    // Step 2: Identity checkpoint
    act(() => { capturedOnEvent({ type: "wizard_checkpoint", stage: "identity" }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("checkpoint-identity")).toHaveAttribute("data-state", "passed");

    // Step 3: Preview clears the question card
    act(() => {
      capturedOnEvent({ type: "agent_preview", name: "Sarah", role: "Customer Support", voice: "openai.shimmer" });
    });
    rerender(<WizardCreationCanvas />);
    expect(screen.queryByText("What kind of agent?")).toBeNull();
    const config = screen.getByTestId("wizard-config");
    expect(config.textContent).toContain("Sarah");
    expect(config.textContent).toContain("openai.shimmer");

    // Step 4: Update preview merges
    act(() => { capturedOnEvent({ type: "agent_preview", greeting: "Hi, this is Sarah." }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("wizard-config").textContent).toContain("Hi, this is Sarah.");

    // Step 5: Voice + Capabilities checkpoints
    act(() => { capturedOnEvent({ type: "wizard_checkpoint", stage: "voice" }); });
    act(() => { capturedOnEvent({ type: "wizard_checkpoint", stage: "capabilities" }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("checkpoint-voice")).toHaveAttribute("data-state", "passed");
    expect(screen.getByTestId("checkpoint-capabilities")).toHaveAttribute("data-state", "passed");

    // Step 6: Review checkpoint
    act(() => { capturedOnEvent({ type: "wizard_checkpoint", stage: "review" }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("checkpoint-review")).toHaveAttribute("data-state", "passed");

    // Step 7: Agent created
    act(() => {
      capturedOnEvent({ type: "agent_created", employee: { id: "e1", name: "Sarah", role: "Customer Support" } });
    });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByText(/Sarah is ready/i)).toBeDefined();

    // Step 8: Agent ready → CTA
    act(() => { capturedOnEvent({ type: "agent_ready", employee_id: "e1", swml_route: "/swml/e1" }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByRole("button", { name: /call your new agent/i })).toBeDefined();

    // Step 9: Transcript also captured
    act(() => { capturedOnTranscript({ role: "wizard", text: "Welcome!", isPartial: false, t: 1 }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("wizard-transcript").textContent).toContain("Welcome!");
  });
});
