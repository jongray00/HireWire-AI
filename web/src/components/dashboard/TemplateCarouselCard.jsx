"use client";

import { Link } from "react-router";
import { ArrowRight } from "lucide-react";

// Tonal palette: maps a template's `color` field to a glyph swatch
// (background, border, foreground) used in Option C tiles.
const TONAL = {
  blue:    { bg: "#0F1424", border: "#2553F4", fg: "#5478F8" },
  green:   { bg: "#0E1A12", border: "#4FCB80", fg: "#4FCB80" },
  purple:  { bg: "#16111F", border: "#7B5BD9", fg: "#9B82E6" },
  orange:  { bg: "#1A130E", border: "#E07A4B", fg: "#E07A4B" },
  pink:    { bg: "#1A0F18", border: "#D96B9F", fg: "#D96B9F" },
  default: { bg: "#0F0F0F", border: "#1F1F1F", fg: "#A3A3A3" },
};

/**
 * TemplateCarouselCard — Path B in the dashboard split hero.
 * Shows up to 4 template tiles + "Browse all N →" link to /dashboard/templates.
 */
export default function TemplateCarouselCard({ templates = [] }) {
  const visible = templates.slice(0, 4);
  const total = templates.length;

  return (
    <div className="relative bg-[#0A0A0A] border border-[#1F1F1F] p-5 h-full flex flex-col">
      <h2 className="text-lg lg:text-xl font-medium text-[#FAFAFA] tracking-tight mb-2">
        Pick a template
      </h2>
      <p className="text-sm text-[#A3A3A3] mb-5">
        Start from a pre-built agent and customize.
      </p>

      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 mb-4">
        {visible.map((t) => {
          const Icon = t.icon;
          const tonal = TONAL[t.color] || TONAL.default;
          // First-sentence-or-70-char descriptor, tag-line style
          const tagline = (t.description || "").split(/(?<=[.!?])\s+/)[0].slice(0, 70);
          return (
            <Link
              key={t.id}
              to={`/dashboard/templates#${t.id}`}
              className="shrink-0 w-[200px] bg-[#0F0F0F] border border-[#1F1F1F] hover:border-[#2553F4]/60 transition-colors p-3 flex flex-col gap-2"
            >
              <div
                className="w-10 h-10 flex items-center justify-center"
                style={{
                  backgroundColor: tonal.bg,
                  border: `1px solid ${tonal.border}`,
                  color: tonal.fg,
                }}
              >
                {Icon ? <Icon className="w-5 h-5" style={{ color: tonal.fg }} /> : null}
              </div>
              <div className="text-sm text-[#FAFAFA] font-medium leading-tight">
                {t.name}
              </div>
              <div className="text-[11px] text-[#A3A3A3] leading-snug line-clamp-2">
                {tagline}
              </div>
            </Link>
          );
        })}
      </div>

      <Link
        to="/dashboard/templates"
        className="mt-auto inline-flex items-center gap-2 self-start px-4 py-2 border border-[#1F1F1F] hover:border-[#2553F4]/60 hover:text-[#FAFAFA] text-[#A3A3A3] transition-colors"
      >
        <span className="hw-mono text-[10px] tracking-[0.16em] uppercase">
          {total > 0 ? `Browse all ${total}` : "Browse all"}
        </span>
        <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}
