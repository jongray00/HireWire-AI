import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

import WizardCreationCanvas from "../WizardCreationCanvas";

// Helpers — the canvas listens to window events broadcast by the banner.
function dispatchEvent(detail) {
  window.dispatchEvent(new CustomEvent("wizard-event", { detail }));
}
function dispatchTranscript(detail) {
  window.dispatchEvent(new CustomEvent("wizard-transcript", { detail }));
}
function dispatchCallState(detail) {
  window.dispatchEvent(new CustomEvent("wizard-call-state", { detail }));
}
function setActiveCall() {
  dispatchCallState({ calling: true, connected: true, connectionState: "connected", error: null });
}
function setEndedCall() {
  dispatchCallState({ calling: false, connected: false, connectionState: "idle", error: null });
}

describe("WizardCreationCanvas — visibility", () => {
  beforeEach(() => {
    setEndedCall();
  });

  it("is hidden by default when no call is active", () => {
    const { container } = render(<WizardCreationCanvas />);
    expect(container.querySelector('[data-testid="wizard-canvas"]')).toBeNull();
  });

  it("opens on first agent_config_question event during active call", () => {
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => { setActiveCall(); });
    act(() => {
      dispatchEvent({ type: "agent_config_question", question: "What kind?", options: ["A"], field: "role" });
    });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("wizard-canvas")).toBeDefined();
    expect(screen.getByText("What kind?")).toBeDefined();
  });

  it("opens on first agent_preview event during active call", () => {
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => { setActiveCall(); });
    act(() => {
      dispatchEvent({ type: "agent_preview", name: "Sarah", role: "Support" });
    });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("wizard-canvas")).toBeDefined();
  });

  it("stays hidden if call ends without any wizard event", () => {
    const { rerender, container } = render(<WizardCreationCanvas />);
    act(() => { setActiveCall(); });
    act(() => { setEndedCall(); });
    rerender(<WizardCreationCanvas />);
    expect(container.querySelector('[data-testid="wizard-canvas"]')).toBeNull();
  });
});

describe("WizardCreationCanvas — transcript", () => {
  it("renders wizard and user transcript lines in chronological order", () => {
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => { setActiveCall(); });
    act(() => { dispatchEvent({ type: "agent_config_question", question: "?", options: [], field: "x" }); });
    act(() => { dispatchTranscript({ role: "wizard", text: "Hi there", isPartial: false, t: 1 }); });
    act(() => { dispatchTranscript({ role: "user", text: "hello", isPartial: false, t: 2 }); });
    rerender(<WizardCreationCanvas />);
    const transcriptCol = screen.getByTestId("wizard-transcript");
    expect(transcriptCol.textContent).toContain("Hi there");
    expect(transcriptCol.textContent).toContain("hello");
    expect(transcriptCol.textContent.indexOf("Hi there")).toBeLessThan(
      transcriptCol.textContent.indexOf("hello")
    );
  });

  it("replaces partial user line with the next partial from same role", () => {
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => { setActiveCall(); });
    act(() => { dispatchEvent({ type: "agent_config_question", question: "?", options: [], field: "x" }); });
    act(() => { dispatchTranscript({ role: "user", text: "hel", isPartial: true, t: 1 }); });
    act(() => { dispatchTranscript({ role: "user", text: "hello world", isPartial: true, t: 2 }); });
    rerender(<WizardCreationCanvas />);
    const transcriptCol = screen.getByTestId("wizard-transcript");
    expect(transcriptCol.textContent).toContain("hello world");
    expect(transcriptCol.textContent).not.toContain("hel ");
  });
});

describe("WizardCreationCanvas — config + stepper", () => {

  it("renders config fields as agent_preview events arrive", () => {
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => {
      dispatchEvent({
        type: "agent_preview",
        name: "Sarah",
        role: "Billing Support",
        voice: "openai.shimmer",
      });
    });
    rerender(<WizardCreationCanvas />);
    const config = screen.getByTestId("wizard-config");
    expect(config.textContent).toContain("Sarah");
    expect(config.textContent).toContain("Billing Support");
    expect(config.textContent).toContain("openai.shimmer");
  });

  it("merges update_agent_preview into existing config", () => {
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => { dispatchEvent({ type: "agent_preview", name: "Sarah", role: "Support" }); });
    act(() => { dispatchEvent({ type: "agent_preview", voice: "openai.nova", greeting: "Hi!" }); });
    rerender(<WizardCreationCanvas />);
    const config = screen.getByTestId("wizard-config");
    expect(config.textContent).toContain("Sarah");
    expect(config.textContent).toContain("openai.nova");
    expect(config.textContent).toContain("Hi!");
  });

  it("checkpoint stepper advances on wizard_checkpoint events", () => {
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => { dispatchEvent({ type: "agent_preview", name: "Sarah" }); });
    act(() => { dispatchEvent({ type: "wizard_checkpoint", stage: "identity" }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("checkpoint-identity")).toHaveAttribute("data-state", "passed");
    expect(screen.getByTestId("checkpoint-voice")).toHaveAttribute("data-state", "pending");
  });

  it("out-of-order checkpoints don't regress earlier ones", () => {
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => { dispatchEvent({ type: "agent_preview", name: "Sarah" }); });
    act(() => { dispatchEvent({ type: "wizard_checkpoint", stage: "identity" }); });
    act(() => { dispatchEvent({ type: "wizard_checkpoint", stage: "voice" }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("checkpoint-identity")).toHaveAttribute("data-state", "passed");
    expect(screen.getByTestId("checkpoint-voice")).toHaveAttribute("data-state", "passed");
  });
});

describe("WizardCreationCanvas — created/ready states", () => {

  it("shows celebratory state on agent_created", () => {
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => {
      dispatchEvent({
        type: "agent_created",
        employee: { id: "e1", name: "Sarah", role: "Support" }
      });
    });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByText(/Sarah is ready/i)).toBeDefined();
  });

  it("shows 'Call your new agent' CTA after agent_ready", () => {
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => { dispatchEvent({ type: "agent_created", employee: { id: "e1", name: "Sarah" } }); });
    act(() => { dispatchEvent({ type: "agent_ready", employee_id: "e1", swml_route: "/swml/e1" }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByRole("button", { name: /call your new agent/i })).toBeDefined();
  });

  it("close button is hidden while call is active", () => {
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => { setActiveCall(); });
    act(() => { dispatchEvent({ type: "agent_preview", name: "Sarah" }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.queryByLabelText("Close wizard canvas")).toBeNull();
  });
});
