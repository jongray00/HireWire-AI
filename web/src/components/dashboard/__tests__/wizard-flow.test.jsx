import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";

import WizardCreationCanvas from "../WizardCreationCanvas";

const fireEvent = (detail) =>
  window.dispatchEvent(new CustomEvent("wizard-event", { detail }));
const fireTranscript = (detail) =>
  window.dispatchEvent(new CustomEvent("wizard-transcript", { detail }));
const fireActiveCall = () =>
  window.dispatchEvent(new CustomEvent("wizard-call-state", {
    detail: { calling: true, connected: true, connectionState: "connected", error: null },
  }));

describe("Wizard Flow Integration — full new sequence", () => {
  it("walks question → checkpoint(identity) → preview → update → checkpoints(voice/capabilities) → review → created → ready", () => {
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => { fireActiveCall(); });

    // Step 1: First question opens the canvas
    act(() => {
      fireEvent({ type: "agent_config_question", question: "What kind of agent?", options: ["Support", "Sales"], field: "role" });
    });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("wizard-canvas")).toBeDefined();
    expect(screen.getByText("What kind of agent?")).toBeDefined();

    // Step 2: Identity checkpoint
    act(() => { fireEvent({ type: "wizard_checkpoint", stage: "identity" }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("checkpoint-identity")).toHaveAttribute("data-state", "passed");

    // Step 3: Preview clears the question card
    act(() => {
      fireEvent({ type: "agent_preview", name: "Sarah", role: "Customer Support", voice: "openai.shimmer" });
    });
    rerender(<WizardCreationCanvas />);
    expect(screen.queryByText("What kind of agent?")).toBeNull();
    const config = screen.getByTestId("wizard-config");
    expect(config.textContent).toContain("Sarah");
    expect(config.textContent).toContain("openai.shimmer");

    // Step 4: Update preview merges
    act(() => { fireEvent({ type: "agent_preview", greeting: "Hi, this is Sarah." }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("wizard-config").textContent).toContain("Hi, this is Sarah.");

    // Step 5: Voice + Capabilities checkpoints
    act(() => { fireEvent({ type: "wizard_checkpoint", stage: "voice" }); });
    act(() => { fireEvent({ type: "wizard_checkpoint", stage: "capabilities" }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("checkpoint-voice")).toHaveAttribute("data-state", "passed");
    expect(screen.getByTestId("checkpoint-capabilities")).toHaveAttribute("data-state", "passed");

    // Step 6: Review checkpoint
    act(() => { fireEvent({ type: "wizard_checkpoint", stage: "review" }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("checkpoint-review")).toHaveAttribute("data-state", "passed");

    // Step 7: Agent created
    act(() => {
      fireEvent({ type: "agent_created", employee: { id: "e1", name: "Sarah", role: "Customer Support" } });
    });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByText(/Sarah is ready/i)).toBeDefined();

    // Step 8: Agent ready → CTA
    act(() => { fireEvent({ type: "agent_ready", employee_id: "e1", swml_route: "/swml/e1" }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByRole("button", { name: /call your new agent/i })).toBeDefined();

    // Step 9: Transcript also captured
    act(() => { fireTranscript({ role: "wizard", text: "Welcome!", isPartial: false, t: 1 }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("wizard-transcript").textContent).toContain("Welcome!");
  });
});
