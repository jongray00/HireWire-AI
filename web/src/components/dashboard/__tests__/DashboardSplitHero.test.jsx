// web/src/components/dashboard/__tests__/DashboardSplitHero.test.jsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../WizardCallCard", () => ({
  default: () => <div data-testid="wizard-call-card">wizard</div>,
}));
vi.mock("../TemplateCarouselCard", () => ({
  default: ({ templates }) => (
    <div data-testid="template-carousel">{templates.length} templates</div>
  ),
}));

import DashboardSplitHero from "../DashboardSplitHero";

describe("DashboardSplitHero", () => {
  const templates = [{ id: "t1" }, { id: "t2" }];

  it("renders only TemplateCarouselCard when wizardEnabled is false", () => {
    render(<DashboardSplitHero templates={templates} wizardEnabled={false} />);
    expect(screen.queryByTestId("wizard-call-card")).toBeNull();
    expect(screen.getByTestId("template-carousel")).toBeInTheDocument();
  });

  it("renders both cards when wizardEnabled is true", () => {
    render(<DashboardSplitHero templates={templates} wizardEnabled={true} />);
    expect(screen.getByTestId("wizard-call-card")).toBeInTheDocument();
    expect(screen.getByTestId("template-carousel")).toBeInTheDocument();
  });

  it("defaults to wizardEnabled=false when prop is omitted", () => {
    render(<DashboardSplitHero templates={templates} />);
    expect(screen.queryByTestId("wizard-call-card")).toBeNull();
    expect(screen.getByTestId("template-carousel")).toBeInTheDocument();
  });
});
