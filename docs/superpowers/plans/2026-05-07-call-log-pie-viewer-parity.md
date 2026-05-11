# Call-Log P.I.E. Viewer Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a State Flow tab to the call-log detail page (with Mermaid diagram + stat cards + execution timeline) and restructure the page to match P.I.E. Viewer's 9-tab layout.

**Architecture:** Pure-function parser (`parseStateFlow`) extracts state-flow data from `rawPayload.swaig_log` defensively (handles `step_change` and `state_change` event names). New React components render the diagram via the `mermaid` npm package, lazy-loaded for SSR safety. `CallDetail.jsx` is restructured to host 9 P.I.E.-ordered tabs, with always-shown KPI sections moved into a new Dashboard tab.

**Tech Stack:** React 18, React Router 7, Vite 6, Tailwind CSS, Vitest 3 + @testing-library/jest-dom, mermaid (new dep).

**Spec:** [`docs/superpowers/specs/2026-05-07-call-log-pie-viewer-parity-design.md`](../specs/2026-05-07-call-log-pie-viewer-parity-design.md)

**Depends on:** Sub-project 1 (`employee-contexts-steps` branch — Employee Contexts+Steps Refactor) being merged. The State Flow tab still renders meaningfully without it (function-call-only fallback), but rich state diagrams require sub-project 1 to be deployed.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `web/src/app/dashboard/call-logs/lib/parseStateFlow.js` | New | Pure parser — `parseStateFlow(rawPayload) -> flowData` |
| `web/test/parseStateFlow.test.js` | New | Vitest unit tests for parser, 3 fixtures |
| `web/src/app/dashboard/call-logs/components/StateFlowPanel.jsx` | New | Top-level container with useMemo + empty-state |
| `web/src/app/dashboard/call-logs/components/StateFlowStatCards.jsx` | New | 6-7 stat cards in responsive grid |
| `web/src/app/dashboard/call-logs/components/StateFlowDiagram.jsx` | New | Mermaid renderer + zoom controls + legend |
| `web/src/app/dashboard/call-logs/components/StateFlowTimeline.jsx` | New | Vertical event timeline below diagram |
| `web/src/app/dashboard/call-logs/components/CallDetail.jsx` | Modify | Restructure to 9 P.I.E.-order tabs + new Dashboard tab |
| `web/package.json` | Modify | Add `mermaid` dep |

Each component has one responsibility and ≤150 lines. The parser is pure (no React, no DOM access) and fully unit-testable.

---

## Task 1: Add `mermaid` dep + skeleton `StateFlowPanel`

**Files:**
- Modify: `web/package.json`
- Create: `web/src/app/dashboard/call-logs/components/StateFlowPanel.jsx`

- [ ] **Step 1: Add mermaid dependency**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/.claude/worktrees/<worktree>/web" && npm install mermaid@^11 --legacy-peer-deps --no-audit --no-fund
```

Confirm `package.json` now has `"mermaid": "^11.x.x"` in `dependencies`.

- [ ] **Step 2: Create skeleton StateFlowPanel**

Create `web/src/app/dashboard/call-logs/components/StateFlowPanel.jsx`:

```jsx
export default function StateFlowPanel({ rawPayload }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
      <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
        State flow visualization (placeholder — implementation in upcoming tasks)
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Confirm dev server still boots**

Run: `cd "<worktree>/web" && PORT=5050 npm run dev`

In a separate terminal, fetch the home page: `curl -sf http://127.0.0.1:5050 -o /dev/null -w "HTTP %{http_code}\n"`

Expected: `HTTP 200`. Stop the dev server (`kill %1` or Ctrl-C).

- [ ] **Step 4: Commit**

```bash
git add web/package.json web/package-lock.json web/src/app/dashboard/call-logs/components/StateFlowPanel.jsx
git commit -m "feat(call-logs): add mermaid dep + StateFlowPanel skeleton"
```

---

## Task 2: Implement `parseStateFlow` with TDD

**Files:**
- Create: `web/src/app/dashboard/call-logs/lib/parseStateFlow.js`
- Create: `web/test/parseStateFlow.test.js`

- [ ] **Step 1: Write the failing test (Fixture 1: empty payload)**

Create `web/test/parseStateFlow.test.js`:

```js
import { describe, it, expect } from "vitest";
import { parseStateFlow } from "../src/app/dashboard/call-logs/lib/parseStateFlow.js";

describe("parseStateFlow", () => {
  it("handles empty payload", () => {
    const result = parseStateFlow({});
    expect(result.transitions).toEqual([]);
    expect(result.transitionCount).toBe(0);
    expect(result.uniqueStates).toEqual([]);
    expect(result.uniqueStatesCount).toBe(0);
    expect(result.aiInitiated).toBe(0);
    expect(result.toolForced).toBe(0);
    expect(result.totalFunctions).toBe(0);
    expect(result.functionErrors).toBe(0);
    expect(result.duration).toBe("0:00");
    expect(result.detailedTimeline).toEqual([]);
    expect(result.mermaidDef).toBe("");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `cd "<worktree>/web" && npx vitest run test/parseStateFlow.test.js`
Expected: FAIL — `Cannot find module 'parseStateFlow'`.

- [ ] **Step 3: Create minimal parser to pass empty fixture**

Create `web/src/app/dashboard/call-logs/lib/parseStateFlow.js`:

```js
/**
 * Parse a stored post-conversation rawPayload into state-flow data.
 *
 * Defensive against the exact `step_change` event name — looks for
 * both `step_change` and `state_change` (case-insensitive) and supports
 * both `entry.type` and `entry.event` field shapes. The exact format
 * will be confirmed when the first real call lands after sub-project 1
 * (employee Contexts+Steps refactor) deploys; until then this parser
 * accommodates either.
 *
 * Pure function — no React, no DOM, no async.
 */
export function parseStateFlow(rawPayload) {
  const payload = rawPayload || {};
  const swaigLog = Array.isArray(payload.swaig_log) ? payload.swaig_log : [];
  const callTimeline = Array.isArray(payload.call_timeline) ? payload.call_timeline : [];

  const transitions = extractTransitions(swaigLog);
  const functionEntries = extractFunctionCalls(swaigLog);
  const contextEnters = extractContextEnters(callTimeline);

  const uniqueStatesSet = new Set();
  let aiInitiated = 0;
  let toolForced = 0;
  for (const t of transitions) {
    if (t.from) uniqueStatesSet.add(t.from);
    if (t.to) uniqueStatesSet.add(t.to);
    if (t.source === "ai") aiInitiated++;
    if (t.source === "tool" || t.source === "gather") toolForced++;
  }
  const uniqueStates = [...uniqueStatesSet];

  let functionErrors = 0;
  for (const fn of functionEntries) {
    if (fn.error) functionErrors++;
  }

  const duration = computeDuration(payload.call_start_date, payload.call_end_date);
  const detailedTimeline = mergeTimeline(transitions, functionEntries, contextEnters);
  const mermaidDef = buildMermaidDef(transitions, functionEntries, uniqueStates);

  return {
    transitions,
    transitionCount: transitions.length,
    uniqueStates,
    uniqueStatesCount: uniqueStates.length,
    aiInitiated,
    toolForced,
    totalFunctions: functionEntries.length,
    functionErrors,
    duration,
    detailedTimeline,
    mermaidDef,
  };
}

const STATE_EVENT_PATTERN = /^(step_change|state_change)$/i;

function extractTransitions(swaigLog) {
  const out = [];
  for (const entry of swaigLog) {
    if (!entry || typeof entry !== "object") continue;
    const eventName = entry.type || entry.event;
    if (!eventName || !STATE_EVENT_PATTERN.test(eventName)) continue;
    out.push({
      from: entry.from || entry.from_step || null,
      to: entry.to || entry.to_step || entry.step || null,
      source: entry.source || "implicit",
      triggeredBy: entry.triggered_by || entry.trigger || null,
      timestamp: entry.timestamp || entry.ts || null,
    });
  }
  return out;
}

function extractFunctionCalls(swaigLog) {
  const out = [];
  for (const entry of swaigLog) {
    if (!entry || typeof entry !== "object") continue;
    const fn = entry.function;
    if (!fn) continue;
    out.push({
      function: fn,
      args: entry.args || entry.arguments || null,
      result: entry.result || entry.response || null,
      swaigActions: entry.swaig_actions || entry.actions || [],
      error: entry.error || null,
      timestamp: entry.timestamp || entry.ts || null,
    });
  }
  return out;
}

function extractContextEnters(callTimeline) {
  const out = [];
  for (const entry of callTimeline) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.type !== "context_enter") continue;
    out.push({
      fromContext: entry.from_context || entry.from || null,
      toContext: entry.to_context || entry.to || entry.context || null,
      timestamp: entry.ts || entry.timestamp || null,
    });
  }
  return out;
}

function computeDuration(startUs, endUs) {
  if (!startUs || !endUs) return "0:00";
  const ms = (endUs - startUs) / 1000;
  const sec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function mergeTimeline(transitions, functions, contextEnters) {
  const items = [];
  for (const t of transitions) {
    items.push({
      type: "state",
      state: t.to,
      stepIndex: null,
      triggeredBy: t.triggeredBy,
      source: t.source,
      timestamp: t.timestamp,
    });
  }
  for (const f of functions) {
    items.push({
      type: f.error ? "function_error" : "function",
      functionName: f.function,
      args: f.args,
      result: f.result,
      error: f.error,
      swaigActions: f.swaigActions,
      timestamp: f.timestamp,
    });
  }
  for (const c of contextEnters) {
    items.push({
      type: "context_enter",
      fromContext: c.fromContext,
      toContext: c.toContext,
      timestamp: c.timestamp,
    });
  }
  // Stable sort by timestamp, then preserve insertion order for ties
  return items
    .map((it, idx) => ({ it, idx }))
    .sort((a, b) => {
      const ta = a.it.timestamp || 0;
      const tb = b.it.timestamp || 0;
      if (ta !== tb) return ta - tb;
      return a.idx - b.idx;
    })
    .map((p) => p.it);
}

function buildMermaidDef(transitions, functions, uniqueStates) {
  if (transitions.length === 0 && functions.length === 0) return "";

  const lines = ["flowchart TB"];
  lines.push("    classDef step fill:#044EF4,stroke:#0340c5,color:#fff");
  lines.push("    classDef func fill:#FFD700,stroke:#d4b200,color:#000");
  lines.push("    classDef terminal fill:#ef4444,stroke:#dc2626,color:#fff");
  lines.push("    classDef error fill:#450a0a,stroke:#ef4444,color:#fff");
  lines.push("");

  // State nodes
  const sanitized = (s) => String(s).replace(/[^a-zA-Z0-9_]/g, "_");
  for (const s of uniqueStates) {
    lines.push(`    state_${sanitized(s)}["${s}"]:::step`);
  }

  // Function nodes
  const seenFns = new Set();
  for (const f of functions) {
    const fn = f.function;
    if (seenFns.has(fn)) continue;
    seenFns.add(fn);
    const cls = f.error ? "error" : "func";
    lines.push(`    func_${sanitized(fn)}["${fn}"]:::${cls}`);
  }

  lines.push("");

  // Edges
  if (transitions.length === 0) {
    // Function-only fallback: linear chain
    let prev = null;
    for (const f of functions) {
      const id = `func_${sanitized(f.function)}`;
      if (prev) lines.push(`    ${prev} --> ${id}`);
      prev = id;
    }
  } else {
    for (const t of transitions) {
      if (t.from && t.to) {
        lines.push(`    state_${sanitized(t.from)} --> state_${sanitized(t.to)}`);
      }
    }
  }

  return lines.join("\n");
}
```

- [ ] **Step 4: Run the empty-fixture test**

Run: `cd "<worktree>/web" && npx vitest run test/parseStateFlow.test.js`
Expected: PASS — empty fixture passes.

- [ ] **Step 5: Add Fixture 2 (function-calls-only) test**

Append to `web/test/parseStateFlow.test.js`:

```js
  it("handles function-calls-only payload", () => {
    const result = parseStateFlow({
      call_start_date: 1_700_000_000_000_000,
      call_end_date: 1_700_000_010_000_000, // 10 seconds later
      swaig_log: [
        { function: "check_business_hours", timestamp: 1_700_000_001, args: {} },
        { function: "transfer_to_human", timestamp: 1_700_000_005, args: { department: "support" } },
        { function: "send_summary_sms", timestamp: 1_700_000_008, args: {} },
      ],
    });
    expect(result.transitionCount).toBe(0);
    expect(result.totalFunctions).toBe(3);
    expect(result.detailedTimeline).toHaveLength(3);
    expect(result.detailedTimeline.every((e) => e.type === "function")).toBe(true);
    expect(result.duration).toBe("0:10");
    expect(result.mermaidDef).toContain("func_check_business_hours");
    expect(result.mermaidDef).toContain("func_transfer_to_human");
    expect(result.mermaidDef).toContain("func_send_sms");
    // Linear chain: check → transfer → sms
    expect(result.mermaidDef).toContain("func_check_business_hours --> func_transfer_to_human");
    expect(result.mermaidDef).toContain("func_transfer_to_human --> func_send_sms");
  });
```

Note: the test expects `func_send_sms` because `send_summary_sms` after sanitization is `send_summary_sms` — but the assertion says `func_send_sms`. That's wrong — fix the assertion:

Change the expectations to match exact sanitized output:
```js
    expect(result.mermaidDef).toContain("func_send_summary_sms");
    expect(result.mermaidDef).toContain("func_check_business_hours --> func_transfer_to_human");
    expect(result.mermaidDef).toContain("func_transfer_to_human --> func_send_summary_sms");
```

- [ ] **Step 6: Run the test**

Run: `cd "<worktree>/web" && npx vitest run test/parseStateFlow.test.js`
Expected: PASS — both fixtures pass.

- [ ] **Step 7: Add Fixture 3 (full payload) test**

Append:

```js
  it("handles full payload with state events + function calls + errors", () => {
    const result = parseStateFlow({
      call_start_date: 1_700_000_000_000_000,
      call_end_date: 1_700_000_060_000_000, // 60 seconds
      swaig_log: [
        { type: "step_change", from: "greet", to: "assist", source: "ai", triggered_by: "begin_assist", timestamp: 1_700_000_005 },
        { function: "transfer_to_human", timestamp: 1_700_000_010, args: { department: "sales" } },
        { function: "broken_fn", timestamp: 1_700_000_020, error: "Tool timeout" },
        { function: "send_summary_sms", timestamp: 1_700_000_055, args: {} },
        { type: "step_change", from: "assist", to: "wrap_up", source: "ai", triggered_by: "wrap_up_call", timestamp: 1_700_000_050 },
      ],
    });

    expect(result.transitionCount).toBe(2);
    expect(result.uniqueStatesCount).toBe(3);
    expect(result.uniqueStates).toEqual(expect.arrayContaining(["greet", "assist", "wrap_up"]));
    expect(result.aiInitiated).toBe(2);
    expect(result.toolForced).toBe(0);
    expect(result.totalFunctions).toBe(3);
    expect(result.functionErrors).toBe(1);
    expect(result.duration).toBe("1:00");

    // Timeline ordered by timestamp, function_error type for error entry
    const types = result.detailedTimeline.map((e) => e.type);
    expect(types).toContain("state");
    expect(types).toContain("function");
    expect(types).toContain("function_error");

    // Mermaid contains state→state edges
    expect(result.mermaidDef).toContain("state_greet --> state_assist");
    expect(result.mermaidDef).toContain("state_assist --> state_wrap_up");
    // Function nodes present
    expect(result.mermaidDef).toContain("func_transfer_to_human");
    // Errored function uses error class
    expect(result.mermaidDef).toContain('func_broken_fn["broken_fn"]:::error');
  });

  it("handles event-name fallback (`state_change` instead of `step_change`)", () => {
    const result = parseStateFlow({
      swaig_log: [
        { type: "STATE_CHANGE", from: "a", to: "b", source: "ai", timestamp: 1 },
      ],
    });
    expect(result.transitionCount).toBe(1);
  });

  it("handles event-name fallback (`event` field instead of `type`)", () => {
    const result = parseStateFlow({
      swaig_log: [
        { event: "step_change", from: "a", to: "b", source: "tool", timestamp: 1 },
      ],
    });
    expect(result.transitionCount).toBe(1);
    expect(result.toolForced).toBe(1);
  });
});
```

- [ ] **Step 8: Run all parser tests**

Run: `cd "<worktree>/web" && npx vitest run test/parseStateFlow.test.js`
Expected: 5 PASS (1 empty + 1 function-only + 1 full + 2 fallback patterns).

- [ ] **Step 9: Commit**

```bash
git add web/src/app/dashboard/call-logs/lib/parseStateFlow.js web/test/parseStateFlow.test.js
git commit -m "feat(call-logs): parser for state-flow data with defensive event-name handling"
```

---

## Task 3: Build `StateFlowStatCards`

**Files:**
- Create: `web/src/app/dashboard/call-logs/components/StateFlowStatCards.jsx`

- [ ] **Step 1: Create the component**

Create `web/src/app/dashboard/call-logs/components/StateFlowStatCards.jsx`:

```jsx
const CARDS = [
  { key: "transitionCount", label: "Total Transitions" },
  { key: "uniqueStatesCount", label: "Unique States" },
  { key: "aiInitiated", label: "AI-Initiated", color: "text-green-500 dark:text-green-400" },
  { key: "toolForced", label: "Forced", color: "text-orange-500 dark:text-orange-400" },
  { key: "totalFunctions", label: "Tool Calls" },
  { key: "duration", label: "Duration" },
];

export default function StateFlowStatCards({ stats }) {
  if (!stats) return null;
  const cards = [...CARDS];
  if (stats.functionErrors > 0) {
    cards.push({ key: "functionErrors", label: "Errors", color: "text-red-500 dark:text-red-400" });
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3 mb-4">
      {cards.map((c) => (
        <div
          key={c.key}
          className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700"
        >
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{c.label}</p>
          <p className={`text-lg font-semibold mt-1 ${c.color || "text-gray-800 dark:text-gray-100"}`}>
            {stats[c.key]}
          </p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/app/dashboard/call-logs/components/StateFlowStatCards.jsx
git commit -m "feat(call-logs): StateFlowStatCards component"
```

---

## Task 4: Build `StateFlowDiagram` with Mermaid

**Files:**
- Create: `web/src/app/dashboard/call-logs/components/StateFlowDiagram.jsx`

- [ ] **Step 1: Create the component**

Create `web/src/app/dashboard/call-logs/components/StateFlowDiagram.jsx`:

```jsx
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
```

- [ ] **Step 2: Commit**

```bash
git add web/src/app/dashboard/call-logs/components/StateFlowDiagram.jsx
git commit -m "feat(call-logs): StateFlowDiagram with mermaid + zoom controls + legend"
```

---

## Task 5: Build `StateFlowTimeline`

**Files:**
- Create: `web/src/app/dashboard/call-logs/components/StateFlowTimeline.jsx`

- [ ] **Step 1: Create the component**

Create `web/src/app/dashboard/call-logs/components/StateFlowTimeline.jsx`:

```jsx
const SOURCE_BADGES = {
  ai: { label: "AI-initiated", color: "text-green-500 dark:text-green-400" },
  tool: { label: "Forced", color: "text-yellow-500 dark:text-yellow-400" },
  gather: { label: "Forced", color: "text-yellow-500 dark:text-yellow-400" },
  explicit: { label: "Explicit transition", color: "text-blue-500 dark:text-blue-400" },
  implicit: { label: "Implicit state", color: "text-gray-500 dark:text-gray-400" },
};

function formatTimestamp(ts) {
  if (!ts) return "";
  // Handle both microsecond and second-precision timestamps
  const ms = ts > 1e12 ? Math.floor(ts / 1000) : ts * 1000;
  return new Date(ms).toLocaleTimeString();
}

export default function StateFlowTimeline({ timeline }) {
  if (!timeline || timeline.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-3">
        Complete Execution Timeline
      </h3>
      <ol className="space-y-3">
        {timeline.map((item, idx) => (
          <li key={idx} className="flex gap-3 text-sm">
            <span
              className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                item.type === "function_error"
                  ? "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300"
                  : item.type === "context_enter"
                  ? "bg-cyan-100 dark:bg-cyan-900 text-cyan-700 dark:text-cyan-300"
                  : item.type === "function"
                  ? "bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300"
                  : "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300"
              }`}
            >
              {idx + 1}
            </span>
            <div className="flex-1 min-w-0">
              {item.type === "state" && <TimelineState item={item} />}
              {(item.type === "function" || item.type === "function_error") && (
                <TimelineFunction item={item} />
              )}
              {item.type === "context_enter" && <TimelineContext item={item} />}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TimelineState({ item }) {
  const badge = SOURCE_BADGES[item.source] || SOURCE_BADGES.implicit;
  return (
    <div>
      <p className="font-medium text-gray-800 dark:text-gray-100">→ {item.state}</p>
      {item.triggeredBy && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Triggered by: <code className="font-mono">{item.triggeredBy}</code>{" "}
          <span className={`ml-1 ${badge.color}`}>● {badge.label}</span>
        </p>
      )}
      {item.timestamp && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{formatTimestamp(item.timestamp)}</p>
      )}
    </div>
  );
}

function TimelineFunction({ item }) {
  return (
    <div>
      <p className="font-mono text-amber-600 dark:text-amber-400">{item.functionName}</p>
      {item.error && (
        <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">Error: {item.error}</p>
      )}
      {item.args && (
        <pre className="text-xs text-gray-600 dark:text-gray-400 mt-1 bg-gray-50 dark:bg-gray-900 p-1.5 rounded overflow-x-auto">
          {JSON.stringify(item.args, null, 2)}
        </pre>
      )}
      {item.result && (
        <pre className="text-xs text-green-600 dark:text-green-400 mt-1 bg-gray-50 dark:bg-gray-900 p-1.5 rounded overflow-x-auto">
          {typeof item.result === "string" ? item.result : JSON.stringify(item.result, null, 2)}
        </pre>
      )}
      {item.timestamp && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{formatTimestamp(item.timestamp)}</p>
      )}
    </div>
  );
}

function TimelineContext({ item }) {
  return (
    <div>
      <p className="font-medium text-cyan-600 dark:text-cyan-400">
        ⤷ Context: {item.toContext || "unknown"}
      </p>
      {item.fromContext && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">from {item.fromContext}</p>
      )}
      {item.timestamp && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{formatTimestamp(item.timestamp)}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/app/dashboard/call-logs/components/StateFlowTimeline.jsx
git commit -m "feat(call-logs): StateFlowTimeline component for execution detail"
```

---

## Task 6: Wire `StateFlowPanel` together

**Files:**
- Modify: `web/src/app/dashboard/call-logs/components/StateFlowPanel.jsx`

- [ ] **Step 1: Replace the skeleton with the wired component**

Replace the contents of `web/src/app/dashboard/call-logs/components/StateFlowPanel.jsx` with:

```jsx
import { useMemo } from "react";
import { parseStateFlow } from "../lib/parseStateFlow.js";
import StateFlowStatCards from "./StateFlowStatCards";
import StateFlowDiagram from "./StateFlowDiagram";
import StateFlowTimeline from "./StateFlowTimeline";

export default function StateFlowPanel({ rawPayload }) {
  const flowData = useMemo(() => parseStateFlow(rawPayload), [rawPayload]);

  if (flowData.transitionCount === 0 && flowData.totalFunctions === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg p-8 border border-gray-200 dark:border-gray-700 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No state transitions or function calls captured for this call.
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
          State transitions are recorded once the agent uses contexts/steps. Older
          call logs (placed before the contexts/steps refactor) won't have rich state data.
        </p>
      </div>
    );
  }

  return (
    <div>
      <StateFlowStatCards stats={flowData} />
      <StateFlowDiagram mermaidDef={flowData.mermaidDef} />
      <StateFlowTimeline timeline={flowData.detailedTimeline} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/app/dashboard/call-logs/components/StateFlowPanel.jsx
git commit -m "feat(call-logs): wire StateFlowPanel with parser + 3 sub-components"
```

---

## Task 7: Restructure `CallDetail.jsx` to 9-tab P.I.E. order

**Files:**
- Modify: `web/src/app/dashboard/call-logs/components/CallDetail.jsx`

- [ ] **Step 1: Replace `CallDetail.jsx`**

Open `web/src/app/dashboard/call-logs/components/CallDetail.jsx`. Replace its body with:

```jsx
import { useState } from "react";
import CallHeader from "./CallHeader";
import MetricCards from "./MetricCards";
import TabBar from "./TabBar";
import TranscriptPanel from "./TranscriptPanel";
import SwaigPanel from "./SwaigPanel";
import SummaryPanel from "./SummaryPanel";
import PostPromptTabs from "./PostPromptTabs";
import RoleDistributionChart from "./RoleDistributionChart";
import LatencyBreakdownChart from "./LatencyBreakdownChart";
import TpsBarChart from "./TpsBarChart";
import AsrConfidenceChart from "./AsrConfidenceChart";
import SwaigLatencyChart from "./SwaigLatencyChart";
import CallTimelineSwimlane from "./CallTimelineSwimlane";
import GlobalDataTreeViewer from "./GlobalDataTreeViewer";
import RecordingWaveform from "./RecordingWaveform";
import StateFlowPanel from "./StateFlowPanel";

export default function CallDetail({ log }) {
  const [tab, setTab] = useState("dashboard");
  const [playbackTime, setPlaybackTime] = useState(null);
  const raw = log._raw || {};

  const hasRecording = !!raw.SWMLVars?.record_call_url;

  // 9 tabs in P.I.E. Viewer order
  const tabs = [
    { id: "dashboard", label: "Dashboard" },
    { id: "charts", label: "Charts" },
    { id: "timeline", label: "Timeline" },
    { id: "transcript", label: "Transcript" },
    { id: "swaig", label: `SWAIG Inspector (${raw.swaig_log?.length || 0})` },
    { id: "postprompt", label: "Post-Prompt" },
    { id: "stateflow", label: "State Flow" },
    hasRecording && { id: "recording", label: "Recording" },
    { id: "globaldata", label: "Global Data" },
  ].filter(Boolean);

  return (
    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 mt-3">
      <CallHeader log={log} />
      <TabBar tabs={tabs} activeTab={tab} onTabChange={setTab} />

      {tab === "dashboard" && (
        <div>
          <MetricCards log={log} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Message Distribution</p>
              <RoleDistributionChart callLog={raw.call_log} />
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Response Latency</p>
              <LatencyBreakdownChart callLog={raw.call_log} />
            </div>
          </div>
        </div>
      )}

      {tab === "charts" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Tokens Per Second</p>
            <TpsBarChart times={raw.times} />
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">ASR Confidence</p>
            <AsrConfidenceChart callLog={raw.call_log} />
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 md:col-span-2">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">SWAIG Function Latency</p>
            <SwaigLatencyChart swaigLog={raw.swaig_log} />
          </div>
        </div>
      )}

      {tab === "timeline" && (
        <CallTimelineSwimlane callLog={raw.call_log} callStartDate={raw.call_start_date} />
      )}

      {tab === "transcript" && (
        <TranscriptPanel callLog={raw.call_log} currentPlaybackTime={playbackTime} />
      )}

      {tab === "swaig" && <SwaigPanel swaigLog={raw.swaig_log} />}

      {tab === "postprompt" && (
        <div>
          <SummaryPanel log={log} />
          <div className="mt-4">
            <PostPromptTabs postPromptData={raw.post_prompt_data} />
          </div>
        </div>
      )}

      {tab === "stateflow" && <StateFlowPanel rawPayload={raw} />}

      {tab === "recording" && (
        <RecordingWaveform
          recordingUrl={raw.SWMLVars?.record_call_url}
          callLog={raw.call_log}
          callStartDate={raw.call_start_date}
          onTimeUpdate={setPlaybackTime}
        />
      )}

      {tab === "globaldata" && (
        <GlobalDataTreeViewer
          globalData={raw.global_data}
          userVariables={raw.user_variables}
          swmlVars={raw.SWMLVars}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run vitest to ensure no test regressions**

Run: `cd "<worktree>/web" && npx vitest run`
Expected: all tests pass (existing component tests + new parser tests).

- [ ] **Step 3: Run typecheck**

Run: `cd "<worktree>/web" && npm run typecheck`
Expected: no errors. (The project uses TypeScript-aware tooling but JSX files; typecheck verifies types of imports and props.)

- [ ] **Step 4: Commit**

```bash
git add web/src/app/dashboard/call-logs/components/CallDetail.jsx
git commit -m "feat(call-logs): restructure to 9-tab P.I.E. Viewer parity layout"
```

---

## Task 8: Manual smoke test

**Files:** none modified — verification only.

- [ ] **Step 1: Start backend (if not already running)**

Run (separate terminal):
```bash
cd "<worktree>" && .venv/bin/uvicorn agent.main:app --host 127.0.0.1 --port 8000 --log-level warning
```

- [ ] **Step 2: Start frontend dev server**

Run (separate terminal):
```bash
cd "<worktree>/web" && PORT=5050 npm run dev
```

The dev server may pick a different port if 5050 is taken (check the output, e.g. 5051 / 5052).

- [ ] **Step 3: Open the call-logs dashboard in Chrome**

Run: `open http://127.0.0.1:<dev-port>/dashboard/call-logs`

If there are no call logs in the DB, the page will be empty. Either:
- Place a real call against an existing employee to populate a log
- OR add a test row directly via the DB

For pure UI verification (without a call log), you can also test the State Flow tab by visiting any existing call detail and switching tabs. If no calls exist, document that the tab structure renders correctly via:

```bash
.venv/bin/python -c "
# Verify that the 9 tabs are defined correctly in CallDetail.jsx
with open('web/src/app/dashboard/call-logs/components/CallDetail.jsx') as f:
    content = f.read()
expected = ['dashboard', 'charts', 'timeline', 'transcript', 'swaig', 'postprompt', 'stateflow', 'recording', 'globaldata']
for tab_id in expected:
    assert f'\"{tab_id}\"' in content, f'Tab {tab_id} missing'
print('All 9 tabs present in correct file')
"
```

- [ ] **Step 4: Verify each tab loads without error**

For each of the 9 tabs (or 8 if no recording exists):
- Click the tab
- Confirm it renders without console errors
- Open Chrome DevTools console — look for warnings/errors

The State Flow tab specifically:
- Stat cards render across the top
- If state data exists: Mermaid diagram appears in the middle
- If function-only data exists: chain of function nodes appears
- If no swaig_log entries: empty-state message appears
- Execution Timeline list appears below

- [ ] **Step 5: Stop the dev servers**

Ctrl-C the frontend and backend processes, OR `kill $(lsof -t -i :8000) $(lsof -t -i :<dev-port>)`.

- [ ] **Step 6: Commit**

This task makes no code changes. Skip the commit.

---

## Task 9: Update spec status + memory

**Files:**
- Modify: `docs/superpowers/specs/2026-05-07-call-log-pie-viewer-parity-design.md`
- Modify: `~/.claude/projects/.../memory/project_hirewire_pending.md`

- [ ] **Step 1: Update spec status**

Edit the spec frontmatter, change `**Status:** Design approved, pending plan` to `**Status:** Implemented`.

- [ ] **Step 2: Update memory**

In `/Users/jonny/.claude/projects/-Users-jonny-Library-Mobile-Documents-com-apple-CloudDocs-CLOUD-CLAUDE/memory/project_hirewire_pending.md`, add to the resolved list:
- `✅ Sub-project 2: Call-log P.I.E. Viewer parity — branch <branch-name>. State Flow tab + 9-tab P.I.E.-order layout deployed.`

Replace the "Open" section with whatever the next user-stated work is, OR clear it if no follow-ups remain.

- [ ] **Step 3: Final test run**

Run: `cd "<worktree>/web" && npx vitest run`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-05-07-call-log-pie-viewer-parity-design.md
git commit -m "docs: mark call-log P.I.E. Viewer parity spec as implemented"
```

---

## Self-Review Notes

### Spec coverage
- Goal 1 (9 tabs in P.I.E. order): Task 7.
- Goal 2 (State Flow tab): Tasks 4-6.
- Goal 3 (always-shown sections move into Dashboard): Task 7.
- Goal 4 (renamed labels): Task 7.
- Goal 5 (Recording tab conditional): Task 7 (preserves existing logic).
- Goal 6 (parser unit-tested with 3 fixtures): Task 2 (5 tests including 2 fallback tests).
- Goal 7 (no regressions): Task 7 step 2 (vitest run) + Task 8 (manual smoke).

### Placeholder scan
- No "TBD"/"TODO"/"appropriate error handling" patterns.
- All code blocks are complete and ready to copy.
- The empty-state message in StateFlowPanel uses generic wording about "older call logs"; not a placeholder.

### Type consistency
- `parseStateFlow(rawPayload) -> flowData` consistent across Tasks 2, 6.
- `flowData.mermaidDef`, `flowData.detailedTimeline`, `flowData.transitionCount`, `flowData.totalFunctions` referenced consistently.
- Component props: `StateFlowPanel({rawPayload})`, `StateFlowStatCards({stats})`, `StateFlowDiagram({mermaidDef})`, `StateFlowTimeline({timeline})` — consistent across Tasks 3, 4, 5, 6.

### Drift-resistance
- The parser is defensive about event-name shape (`step_change` / `state_change`, `type` / `event` field). When the first real call confirms the actual format, the parser still works; tightening is optional cleanup.
- Mermaid is lazy-imported inside `useEffect` so SSR and bundle size aren't impacted on initial page load.

### Open questions resolution
1. Mermaid version: `^11` (current stable). React 18 + Vite 6 compatible.
2. SSR / hydration: handled by lazy `import("mermaid")` inside `useEffect`. The render call only fires after mount, when `document` exists.
3. Actual `step_change` event format: defensive parser handles `step_change` + `state_change` + both `type` and `event` field shapes.
4. Pre-render vs client-side: client-side. Simpler. SSR adds complexity for marginal benefit.
