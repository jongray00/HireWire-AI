"use client";

import WizardCallCard from "./WizardCallCard";
import TemplateCarouselCard from "./TemplateCarouselCard";

/**
 * DashboardSplitHero — two-column hero on the dashboard home.
 * Path A (left): wizard call. Path B (right): template carousel.
 * Stacks vertically below `lg:`.
 *
 * Position on the page (top vs bottom) is decided by the dashboard page based
 * on whether any employees exist.
 */
export default function DashboardSplitHero({ templates = [] }) {
  return (
    <section
      aria-label="Create an agent"
      className="grid grid-cols-1 lg:grid-cols-2 gap-4"
    >
      <WizardCallCard />
      <TemplateCarouselCard templates={templates} />
    </section>
  );
}
