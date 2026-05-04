"use client";

import { useNavigate } from "react-router";
import {
  Check,
  Mic,
  Sliders,
  Zap,
} from "lucide-react";
import { TEMPLATES } from "@/lib/templates";

// ---------------------------------------------------------------------------
// Tonal palette: maps a template's `color` field to a glyph swatch
// (background, border, foreground) used in Option C tiles. Mirrors
// `components/dashboard/TemplateCarouselCard.jsx`.
// ---------------------------------------------------------------------------

const TONAL = {
  blue:    { bg: "#0F1424", border: "#2553F4", fg: "#5478F8" },
  green:   { bg: "#0E1A12", border: "#4FCB80", fg: "#4FCB80" },
  purple:  { bg: "#16111F", border: "#7B5BD9", fg: "#9B82E6" },
  orange:  { bg: "#1A130E", border: "#E07A4B", fg: "#E07A4B" },
  pink:    { bg: "#1A0F18", border: "#D96B9F", fg: "#D96B9F" },
  default: { bg: "#0F0F0F", border: "#1F1F1F", fg: "#A3A3A3" },
};

// ---------------------------------------------------------------------------
// Voice label lookup
// ---------------------------------------------------------------------------

const VOICE_LABELS = {
  "openai.nova": "Nova (OpenAI)",
  "openai.alloy": "Alloy (OpenAI)",
  "openai.echo": "Echo (OpenAI)",
  "openai.fable": "Fable (OpenAI)",
  "openai.onyx": "Onyx (OpenAI)",
  "openai.shimmer": "Shimmer (OpenAI)",
  "elevenlabs.rachel": "Rachel (ElevenLabs)",
  "elevenlabs.thomas": "Thomas (ElevenLabs)",
  "elevenlabs.charlie": "Charlie (ElevenLabs)",
  "elevenlabs.emily": "Emily (ElevenLabs)",
  "elevenlabs.alice": "Alice (ElevenLabs)",
  "elevenlabs.daniel": "Daniel (ElevenLabs)",
  "elevenlabs.brian": "Brian (ElevenLabs)",
  "elevenlabs.lily": "Lily (ElevenLabs)",
  "deepgram.aura-asteria-en": "Asteria (Deepgram)",
  "deepgram.aura-luna-en": "Luna (Deepgram)",
  "deepgram.aura-orion-en": "Orion (Deepgram)",
  "deepgram.aura-athena-en": "Athena (Deepgram)",
  "gcloud.en-US-Neural2-A": "Neural2-A (Google)",
  "rime.luna:arcana": "Luna (Rime)",
  "amazon.Joanna-Neural": "Joanna (Amazon)",
  "azure.en-US-AvaNeural": "Ava (Azure)",
};

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function TemplatesPage() {
  const navigate = useNavigate();

  const handleUseTemplate = (template) => {
    navigate("/dashboard/employees?new=true", {
      state: { template: template.defaultData },
    });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="relative bg-[#0A0A0A] border border-[#1F1F1F] p-8">
        <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#2553F4]" />
        <div className="hw-mono text-[10px] tracking-[0.18em] uppercase text-[#737373] mb-2">
          Templates
        </div>
        <h1 className="text-2xl lg:text-3xl font-medium text-[#FAFAFA] tracking-tight mb-3">
          AI Agent Templates
        </h1>
        <p className="text-[#A3A3A3] max-w-2xl">
          Pre-configured AI voice agents. Each template includes a tailored
          prompt, voice, and function routing based on SignalWire SDK best
          practices.
        </p>
      </div>

      {/* Templates Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {TEMPLATES.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onUse={handleUseTemplate}
          />
        ))}
      </div>

      {/* Info Section */}
      <div className="relative bg-[#0A0A0A] border border-[#1F1F1F] p-6">
        <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#2553F4]" />
        <div className="hw-mono text-[10px] tracking-[0.18em] uppercase text-[#737373] mb-2">
          Tip
        </div>
        <h3 className="text-base text-[#FAFAFA] font-medium mb-2">
          Need a custom solution?
        </h3>
        <p className="text-sm text-[#A3A3A3] mb-4">
          Can't find the right template? Create a custom AI agent from scratch
          tailored to your specific requirements.
        </p>
        <button
          onClick={() => navigate("/dashboard/employees?new=true")}
          className="px-4 py-2 bg-[#2553F4] hover:bg-[#1E46DC] text-white transition-colors"
        >
          <span className="hw-mono text-[11px] tracking-[0.16em] uppercase font-semibold">
            Create Custom Agent
          </span>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template Card
// ---------------------------------------------------------------------------

function TemplateCard({ template, onUse }) {
  const Icon = template.icon;
  const data = template.defaultData;
  const tonal = TONAL[template.color] || TONAL.default;
  const features = template.features || [];

  return (
    <div className="relative bg-[#0A0A0A] border border-[#1F1F1F] p-6 flex flex-col gap-4 hover:border-[#2553F4]/60 transition-colors">
      {/* Tonal glyph */}
      <div
        className="w-12 h-12 flex items-center justify-center"
        style={{
          backgroundColor: tonal.bg,
          border: `1px solid ${tonal.border}`,
          color: tonal.fg,
        }}
      >
        {Icon ? <Icon style={{ color: tonal.fg }} size={24} /> : null}
      </div>

      {/* Name + description */}
      <div>
        <h3 className="text-lg text-[#FAFAFA] font-medium tracking-tight mb-1">
          {template.name}
        </h3>
        <p className="text-sm text-[#A3A3A3] leading-relaxed">
          {template.description}
        </p>
      </div>

      {/* Quick config preview */}
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#0F0F0F] border border-[#1F1F1F] hw-mono text-[10px] tracking-[0.14em] uppercase text-[#A3A3A3]">
          <Mic size={10} />
          {VOICE_LABELS[data.voice] || data.voice}
        </span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#0F0F0F] border border-[#1F1F1F] hw-mono text-[10px] tracking-[0.14em] uppercase text-[#A3A3A3]">
          <Sliders size={10} />
          Temp {data.temperature}
        </span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#0F0F0F] border border-[#1F1F1F] hw-mono text-[10px] tracking-[0.14em] uppercase text-[#A3A3A3]">
          <Zap size={10} />
          {data.enabled_functions.length} functions
        </span>
      </div>

      {/* Features */}
      <div className="space-y-2">
        {features.slice(0, 3).map((feature, index) => (
          <div
            key={index}
            className="flex items-center gap-2 text-sm text-[#A3A3A3]"
          >
            <Check size={14} style={{ color: tonal.fg }} />
            <span>{feature}</span>
          </div>
        ))}
      </div>

      {/* CTA */}
      <button
        onClick={() => onUse(template)}
        className="mt-auto w-full px-4 py-2.5 bg-[#2553F4] hover:bg-[#1E46DC] text-white transition-colors"
      >
        <span className="hw-mono text-[11px] tracking-[0.16em] uppercase font-semibold">
          Use Template
        </span>
      </button>
    </div>
  );
}
