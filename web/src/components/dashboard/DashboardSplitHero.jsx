"use client";

import WizardCallCard from "./WizardCallCard";
import TemplateCarouselCard from "./TemplateCarouselCard";

/**
 * DashboardSplitHero — two-column hero on the dashboard home.
 * When `wizardEnabled` is true: WizardCallCard (left) + TemplateCarouselCard (right).
 * When `wizardEnabled` is false: TemplateCarouselCard only, full-width.
 * Stacks vertically below `lg:`.
 */
export default function DashboardSplitHero({ templates = [], wizardEnabled = false }) {
  if (!wizardEnabled) {
    return (
      <section aria-label="Create an agent">
        <TemplateCarouselCard templates={templates} />
      </section>
    );
  }

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
