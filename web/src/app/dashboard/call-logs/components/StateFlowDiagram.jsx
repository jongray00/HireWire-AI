import { useEffect, useRef, useState } from "react";

const LEGEND = [
  { color: "#044EF4", border: "#0340c5", label: "Step / State" },
  { color: "#FFD700", border: "#d4b200", label: "Function Call" },
  { color: "#ef4444", border: "#dc2626", label: "Terminal" },
  { color: "#450a0a", border: "#ef4444", label: "Error" },
];

export default function StateFlowDiagram({ mermaidDef }) {
  const ref = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [renderError, setRenderError] = useState(null);

  useEffect(() => {
    if (!mermaidDef || !ref.current) return;
    let cancelled = false;
    setRenderError(null);

    (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        if (cancelled) return;
        const isDark =
          typeof document !== "undefined" &&
          document.documentElement.classList.contains("dark");
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? "dark" : "default",
          flowchart: { curve: "basis", padding: 20, useMaxWidth: false },
          securityLevel: "loose",
        });
        const id = `mermaid-${Date.now()}`;
        const { svg } = await mermaid.render(id, mermaidDef);
        if (cancelled) return;
        if (ref.current) {
          ref.current.innerHTML = svg;
        }
      } catch (err) {
        if (!cancelled) setRenderError(err.message || String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mermaidDef]);

  if (!mermaidDef) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 mb-4 relative">
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-3 text-xs text-gray-600 dark:text-gray-400">
        {LEGEND.map((l) => (
          <span key={l.label} className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 rounded"
              style={{ backgroundColor: l.color, border: `1px solid ${l.border}` }}
            />
            {l.label}
          </span>
        ))}
      </div>

      {/* Zoom controls */}
      <div className="absolute top-3 right-3 flex gap-1 z-10">
        <button
          onClick={() => setZoom((z) => Math.min(3, z + 0.2))}
          className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))}
          className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          onClick={() => setZoom(1)}
          className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
          aria-label="Reset zoom"
        >
          ⊙
        </button>
      </div>

      {renderError ? (
        <p className="text-xs text-red-500 dark:text-red-400 py-4">
          Failed to render diagram: {renderError}
        </p>
      ) : (
        <div className="overflow-auto py-2" style={{ maxHeight: "600px" }}>
          <div
            ref={ref}
            style={{ transform: `scale(${zoom})`, transformOrigin: "top left", transition: "transform 0.15s" }}
          />
        </div>
      )}
    </div>
  );
}
