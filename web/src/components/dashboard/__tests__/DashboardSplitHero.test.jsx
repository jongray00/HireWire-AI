import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import DashboardSplitHero from "../DashboardSplitHero";

vi.mock("../WizardBanner", () => ({
  default: () => <div data-testid="wizard-banner-mock">MOCK_BANNER</div>,
}));

describe("DashboardSplitHero", () => {
  it("renders both columns", () => {
    render(
      <MemoryRouter>
        <DashboardSplitHero templates={[]} />
      </MemoryRouter>
    );
    expect(screen.getByText(/build by voice/i)).toBeInTheDocument();
    expect(screen.getByText(/pick a template/i)).toBeInTheDocument();
    expect(screen.getByTestId("wizard-banner-mock")).toBeInTheDocument();
  });

  it("passes templates through to the carousel", () => {
    const Icon = () => null;
    const tpls = [
      { id: "a", name: "Alpha", description: "A", color: "blue", icon: Icon, defaultData: {} },
    ];
    render(
      <MemoryRouter>
        <DashboardSplitHero templates={tpls} />
      </MemoryRouter>
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });
});
