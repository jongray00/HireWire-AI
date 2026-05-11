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

  it("shows idle CTA bar with Call Wizard button", () => {
    render(<WizardBanner />);
    expect(screen.getByText("Setup Wizard")).toBeDefined();
    expect(screen.getByText("Call Wizard")).toBeDefined();
    expect(screen.getByText("Build a new AI agent by voice")).toBeDefined();
  });

  it("calls startCall when Call Wizard is clicked", () => {
    render(<WizardBanner />);
    fireEvent.click(screen.getByRole("button", { name: /start setup wizard call/i }));
    expect(mockStartCall).toHaveBeenCalled();
  });

  it("shows connecting state", () => {
    window.__testWizardCalling = true;
    window.__testWizardConnectionState = "connecting";
    render(<WizardBanner />);
    expect(screen.getByText(/Connecting/)).toBeDefined();
    expect(screen.getByText("End")).toBeDefined();
  });

  it("shows connected state with Live indicator", () => {
    window.__testWizardCalling = true;
    window.__testWizardConnected = true;
    window.__testWizardConnectionState = "connected";
    render(<WizardBanner />);
    expect(screen.getByText("Live")).toBeDefined();
  });

  it("shows 'Speak to the wizard...' hint during active call with no events", () => {
    window.__testWizardCalling = true;
    window.__testWizardConnected = true;
    window.__testWizardConnectionState = "connected";
    render(<WizardBanner />);
    expect(screen.getByText(/Speak to the wizard/i)).toBeDefined();
  });

  it("does NOT render preview/question/created cards anymore (canvas owns those)", () => {
    window.__testWizardCalling = true;
    window.__testWizardConnected = true;
    window.__testWizardConnectionState = "connected";
    const { rerender } = render(<WizardBanner />);
    window.__testWizardOnEvent({
      type: "agent_preview",
      name: "Sarah",
      role: "Support",
    });
    rerender(<WizardBanner />);
    // Sarah's name should NOT appear in the banner — canvas renders it
    expect(screen.queryByText("Sarah")).toBeNull();
  });

  it("variant='inline' drops outer mx/mt margin classes", () => {
    const { container } = render(<WizardBanner variant="inline" />);
    const root = container.firstChild;
    expect(root.className || "").not.toMatch(/\bmx-4\b/);
    expect(root.className || "").not.toMatch(/\bmt-4\b/);
  });

  it("variant defaults to 'global' (preserves existing margin classes)", () => {
    const { container } = render(<WizardBanner />);
    const root = container.firstChild;
    expect(root.className || "").toMatch(/\bmx-4\b/);
  });

  it("variant='button-only' renders just the Call Wizard pill (no card chrome)", () => {
    render(<WizardBanner variant="button-only" />);
    // CTA still present
    expect(screen.getByRole("button", { name: /start setup wizard call/i })).toBeInTheDocument();
    // The bordered idle card chrome's mono label "SETUP WIZARD" should NOT render
    expect(screen.queryByText(/setup wizard/i)).toBeNull();
    // The headline should NOT render
    expect(screen.queryByText(/build a new ai agent/i)).toBeNull();
  });

  it("variant='button-only' renders compact connecting indicator while calling", () => {
    window.__testWizardCalling = true;
    window.__testWizardConnectionState = "connecting";
    render(<WizardBanner variant="button-only" />);
    // Compact status label is visible immediately (not the big card)
    expect(screen.getByText("Connecting")).toBeDefined();
    // End-call button is wired up
    expect(screen.getByRole("button", { name: /end wizard call/i })).toBeInTheDocument();
    // The big bordered card chrome should NOT render in button-only mode —
    // the full "Speak to the wizard…" hint belongs to the global active card.
    expect(screen.queryByText(/Speak to the wizard/i)).toBeNull();
  });

  it("variant='button-only' shows Live status when connected", () => {
    window.__testWizardCalling = true;
    window.__testWizardConnected = true;
    window.__testWizardConnectionState = "connected";
    render(<WizardBanner variant="button-only" />);
    expect(screen.getByText("Live")).toBeDefined();
    expect(screen.getByRole("button", { name: /end wizard call/i })).toBeInTheDocument();
  });
});
