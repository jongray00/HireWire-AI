import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

let capturedOnTranscript;
let capturedOnEvent;
const mockEndCall = vi.fn();

vi.mock("@/app/hooks/useWizardCall", () => ({
  useWizardCall: ({ onEvent, onTranscript } = {}) => {
    capturedOnEvent = onEvent;
    capturedOnTranscript = onTranscript;
    return {
      startCall: vi.fn(),
      endCall: mockEndCall,
      calling: window.__testWizardCalling || false,
      connected: window.__testWizardConnected || false,
      connectionState: window.__testWizardConnectionState || "idle",
      error: null,
      videoRef: { current: null },
    };
  },
}));

import WizardCreationCanvas from "../WizardCreationCanvas";

describe("WizardCreationCanvas — visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.__testWizardCalling = false;
    window.__testWizardConnected = false;
    window.__testWizardConnectionState = "idle";
    capturedOnEvent = null;
    capturedOnTranscript = null;
  });

  it("is hidden by default when no call is active", () => {
    const { container } = render(<WizardCreationCanvas />);
    expect(container.querySelector('[data-testid="wizard-canvas"]')).toBeNull();
  });

  it("opens on first agent_config_question event during active call", () => {
    window.__testWizardCalling = true;
    window.__testWizardConnected = true;
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => {
      capturedOnEvent({ type: "agent_config_question", question: "What kind?", options: ["A"], field: "role" });
    });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("wizard-canvas")).toBeDefined();
    expect(screen.getByText("What kind?")).toBeDefined();
  });

  it("opens on first agent_preview event during active call", () => {
    window.__testWizardCalling = true;
    window.__testWizardConnected = true;
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => {
      capturedOnEvent({ type: "agent_preview", name: "Sarah", role: "Support" });
    });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("wizard-canvas")).toBeDefined();
  });

  it("stays hidden if call ends without any wizard event", () => {
    window.__testWizardCalling = true;
    const { rerender, container } = render(<WizardCreationCanvas />);
    window.__testWizardCalling = false;
    window.__testWizardConnected = false;
    rerender(<WizardCreationCanvas />);
    expect(container.querySelector('[data-testid="wizard-canvas"]')).toBeNull();
  });
});
