import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock the useWizardCall hook
const mockStartCall = vi.fn();
const mockEndCall = vi.fn();
vi.mock("@/app/hooks/useWizardCall", () => ({
  useWizardCall: ({ onEvent } = {}) => {
    // Expose onEvent so tests can simulate wizard events
    window.__testWizardOnEvent = onEvent;
    return {
      startCall: mockStartCall,
      endCall: mockEndCall,
      calling: window.__testWizardCalling || false,
      connected: window.__testWizardConnected || false,
      connectionState: window.__testWizardConnectionState || "idle",
      error: window.__testWizardError || null,
      videoRef: { current: null },
      debugLog: [],
    };
  },
}));

import WizardBanner from "../WizardBanner";

describe("WizardBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.__testWizardCalling = false;
    window.__testWizardConnected = false;
    window.__testWizardConnectionState = "idle";
    window.__testWizardError = null;
  });

  it("shows idle CTA bar with Call Now button", () => {
    render(<WizardBanner />);
    expect(screen.getByText("Setup Wizard")).toBeDefined();
    expect(screen.getByText("Call Now")).toBeDefined();
    expect(screen.getByText("Build agents with your voice")).toBeDefined();
  });

  it("calls startCall when Call Now is clicked", () => {
    render(<WizardBanner />);
    fireEvent.click(screen.getByText("Call Now").closest("button"));
    expect(mockStartCall).toHaveBeenCalled();
  });

  it("shows connecting state", () => {
    window.__testWizardCalling = true;
    window.__testWizardConnectionState = "connecting";
    render(<WizardBanner />);
    expect(screen.getByText("Connecting...")).toBeDefined();
    expect(screen.getByText("End")).toBeDefined();
  });

  it("shows connected state with Live indicator", () => {
    window.__testWizardCalling = true;
    window.__testWizardConnected = true;
    window.__testWizardConnectionState = "connected";
    render(<WizardBanner />);
    expect(screen.getByText("Live")).toBeDefined();
  });

  it("shows question when agent_config_question event fires", () => {
    window.__testWizardCalling = true;
    window.__testWizardConnected = true;
    window.__testWizardConnectionState = "connected";
    const { rerender } = render(<WizardBanner />);

    window.__testWizardOnEvent({
      type: "agent_config_question",
      question: "What should it do?",
      options: ["Support", "Sales"],
    });
    rerender(<WizardBanner />);

    expect(screen.getByText("What should it do?")).toBeDefined();
    expect(screen.getByText("Support")).toBeDefined();
    expect(screen.getByText("Sales")).toBeDefined();
  });

  it("shows agent created confirmation", () => {
    window.__testWizardCalling = true;
    window.__testWizardConnected = true;
    window.__testWizardConnectionState = "connected";
    const onCreated = vi.fn();
    const { rerender } = render(<WizardBanner onAgentCreated={onCreated} />);

    window.__testWizardOnEvent({
      type: "agent_created",
      employee: { name: "Test Agent", role: "Support", id: "abc" },
    });
    rerender(<WizardBanner onAgentCreated={onCreated} />);

    expect(screen.getByText(/Created: Test Agent/)).toBeDefined();
    expect(onCreated).toHaveBeenCalledWith({ name: "Test Agent", role: "Support", id: "abc" });
  });
});
