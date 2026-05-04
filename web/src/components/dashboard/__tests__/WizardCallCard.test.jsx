import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import WizardCallCard from "../WizardCallCard";

// The card embeds <WizardBanner variant="inline" />, which depends on hooks
// that talk to SignalWire. Mock the banner to keep this card test focused on
// composition.
vi.mock("../WizardBanner", () => ({
  default: ({ variant }) => (
    <div data-testid="wizard-banner-mock" data-variant={variant}>
      MOCK_BANNER
    </div>
  ),
}));

describe("WizardCallCard", () => {
  it("renders title and body", () => {
    render(<WizardCallCard />);
    expect(screen.getByText(/build by voice/i)).toBeInTheDocument();
    expect(screen.getByText(/call the wizard/i)).toBeInTheDocument();
  });

  it("embeds the wizard banner with variant='button-only'", () => {
    render(<WizardCallCard />);
    const banner = screen.getByTestId("wizard-banner-mock");
    expect(banner).toBeInTheDocument();
    expect(banner.dataset.variant).toBe("button-only");
  });
});
