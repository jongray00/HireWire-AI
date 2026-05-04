"use client";

import WizardBanner from "./WizardBanner";

/**
 * WizardCallCard — Path A in the dashboard split hero.
 * Card frame around the existing inline WizardBanner so the call lifecycle
 * (mic, SignalWire SDK, session-log) keeps working without touching internals.
 */
export default function WizardCallCard() {
  return (
    <div
      className="relative border border-[#1F1F1F] p-5 h-full flex flex-col"
      style={{
        background: "linear-gradient(180deg, #0A0A0A 0%, #091333 100%)",
      }}
    >
      <h2 className="text-lg lg:text-xl font-medium text-[#FAFAFA] tracking-tight mb-2">
        Build by voice
      </h2>
      <p className="text-sm text-[#A3A3A3] mb-5">
        Call the wizard. It interviews you and creates an employee in about a minute.
      </p>
      <div className="flex-1 flex items-center justify-center">
        <WizardBanner variant="button-only" />
      </div>
    </div>
  );
}
