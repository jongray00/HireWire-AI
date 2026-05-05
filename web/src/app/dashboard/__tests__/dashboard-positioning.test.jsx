import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import DashboardPage from "../page";

// Mock the wizard banner so we don't talk to SignalWire in this test.
vi.mock("@/components/dashboard/WizardBanner", () => ({
  default: () => <div data-testid="wizard-banner-mock" />,
}));

const mockFetch = (employees) => {
  global.fetch = vi.fn(async (url) => {
    if (String(url).includes("/api/employees/sync")) {
      return { ok: true, json: async () => ({ success: true, employees }) };
    }
    return { ok: true, json: async () => ({ success: true, calls: [] }) };
  });
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DashboardPage positioning", () => {
  it("renders the split hero ABOVE the stats grid when there are no employees", async () => {
    mockFetch([]);
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText(/build by voice/i)).toBeInTheDocument();
    });
    const hero = screen.getByText(/build by voice/i).closest("section");
    // Stat label rendered by <StatCard title="Agents" /> — exact match avoids
    // matching the lowercase "agent" text inside WizardCallCard.
    const stats = screen.getByText("Agents");
    // hero before stats means stats follows hero in document order
    expect(hero.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders the split hero BELOW the stats grid when there are employees", async () => {
    mockFetch([{ id: "e1", name: "X" }]);
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    await waitFor(() => {
      // The bottom-position case still has the hero — confirm it's there
      expect(screen.getByText(/build by voice/i)).toBeInTheDocument();
      // And confirm we're past the loading state by waiting for the stats label
      expect(screen.getByText("Agents")).toBeInTheDocument();
    });
    const hero = screen.getByText(/build by voice/i).closest("section");
    const stats = screen.getByText("Agents");
    expect(stats.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
