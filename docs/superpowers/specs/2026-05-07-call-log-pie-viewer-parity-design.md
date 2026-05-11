# Call-Log Detail P.I.E. Viewer Parity

**Date:** 2026-05-07
**Status:** Design approved, pending plan
**Owner:** HireWire-AI
**Depends on:** Sub-project 1 (`employee-contexts-steps` branch — Employee Contexts+Steps Refactor) being merged. Without it, no employee call logs will have state-change events to visualize, only function calls — but the State Flow tab still renders meaningfully thanks to function-call-only fallback parsing.

## Background

The HireWire-AI call-log detail page (`web/src/app/dashboard/call-logs/components/CallDetail.jsx`) currently has 8 tabs that align ~95% with P.I.E. Viewer's structure (https://github.com/signalwire-demos/postpromptviewer). The biggest missing piece is a **State Flow** tab that renders an interactive Mermaid diagram of state transitions and function calls during the call. Per the user's feedback, this is non-negotiable.

Beyond the missing tab, the existing layout differs from P.I.E. Viewer in:
- Tab labels (HireWire uses "Functions" / "State Data"; P.I.E. uses "SWAIG Inspector" / "Global Data")
- Tab order (HireWire's order doesn't match P.I.E.)
- Always-shown KPI panel (HireWire shows MetricCards above the tabs; P.I.E. has a Dashboard tab)

This sub-project restructures the layout to match P.I.E. Viewer's 9-tab structure, adds the missing State Flow tab, and renames/reorders existing tabs. Sub-project 1 emits the underlying `step_change` events; this sub-project surfaces them.

## Goals

1. Call-log detail page has exactly 9 top-level tabs in P.I.E. Viewer order: Dashboard, Charts, Timeline, Transcript, SWAIG Inspector, Post-Prompt, State Flow, Recording, Global Data.
2. New **State Flow** tab renders a Mermaid diagram of the call's state machine + function calls, with stat cards above and an execution timeline below.
3. Always-shown sections (MetricCards, role-distribution + latency-overview charts) move into the new Dashboard tab.
4. Tab labels match P.I.E. Viewer ("Functions" → "SWAIG Inspector"; "State Data" → "Global Data").
5. Recording tab continues to be conditionally shown (hidden when no recording).
6. Parser logic for state-flow data is unit-tested and handles three input shapes: empty, function-calls-only, full state-machine payload.
7. Existing call-log functionality (transcript, SWAIG inspector, post-prompt, recording, etc.) continues to work — no regressions.

## Non-Goals

- Pixel-exact CSS port of P.I.E. Viewer's styling. HireWire's existing Tailwind dark-mode aesthetic stays.
- Image/SVG export of the Mermaid diagram (P.I.E. Viewer has copy/download buttons; ship without for v1).
- Search / filter within tab content.
- Schema changes to the `call_logs` database. We use existing `rawPayload`.
- Synthetic state events for historical call logs lacking `step_change`. We use the function-calls-only fallback for those.
- Backend changes to capture additional fields (no new payload extraction).

## Tab structure (final layout)

The page renders `CallHeader` once at the top (always shown — call ID, employee name/role, timestamp, duration, outcome badge). Below it, 9 top-level tabs:

### 1. Dashboard
KPI panel. Renders existing components:
- `MetricCards` (duration, latency, tokens, SWAIG calls)
- `RoleDistributionChart` (caller vs assistant message split)
- `LatencyBreakdownChart` (response latency over time)

These currently render always-above-tabs in `CallDetail.jsx`. They move into the Dashboard tab.

### 2. Charts
- `TpsBarChart`
- `AsrConfidenceChart`
- `SwaigLatencyChart`

(Currently the Charts tab; unchanged.)

### 3. Timeline
- `CallTimelineSwimlane`

(Currently the Timeline tab; unchanged.)

### 4. Transcript
- `TranscriptPanel`

(Currently the Transcript tab; unchanged.)

### 5. SWAIG Inspector
Tab label changes from "Functions" to "SWAIG Inspector".
- `SwaigPanel`

### 6. Post-Prompt
Currently has separate "Summary" and "Post-Prompt" tabs. Merge:
- `SummaryPanel` at top
- `PostPromptTabs` (raw / substituted / parsed sub-tabs) below

### 7. State Flow ⭐ (NEW)
The non-negotiable new feature. See "State Flow tab" section below for full detail.

### 8. Recording
- `RecordingWaveform`

Conditionally shown (only if `raw.SWMLVars?.record_call_url` exists). Currently the Recording tab; unchanged.

### 9. Global Data
Tab label changes from "State Data" to "Global Data".
- `GlobalDataTreeViewer`

## State Flow tab

### Components

Four new components in `web/src/app/dashboard/call-logs/components/`:

#### `StateFlowPanel.jsx`
Top-level container. Receives `rawPayload` (the stored post-conversation payload). Calls `parseStateFlow(rawPayload)` once via `useMemo` to derive flow data. Renders three sections:
- `<StateFlowStatCards stats={flowData} />` at top
- `<StateFlowDiagram mermaidDef={flowData.mermaidDef} />` in the middle
- `<StateFlowTimeline timeline={flowData.detailedTimeline} />` below

If `flowData.transitionCount === 0 && flowData.totalFunctions === 0`, render a centered empty-state message: "No state transitions or function calls captured for this call. State transitions are recorded for calls placed after [date employee Contexts+Steps deployed]."

#### `StateFlowStatCards.jsx`
Receives `stats` props with: `transitionCount`, `uniqueStatesCount`, `aiInitiated`, `toolForced`, `totalFunctions`, `duration`, `functionErrors`. Renders 6 stat cards in a responsive grid, plus a 7th (Errors) only when `functionErrors > 0`. Card style matches HireWire's existing `MetricCards` aesthetic.

#### `StateFlowDiagram.jsx`
Receives `mermaidDef` string prop. Renders an interactive Mermaid diagram using the `mermaid` npm package. Above the diagram: a small legend (Step / Function Call / Gather / Action / Navigation / Terminal / Error — 7 colored swatches with labels). To the side: zoom controls (+/−/reset). The diagram itself fills the available width.

If `mermaidDef === ""`, render nothing (empty-state handled by parent).

Mermaid theme is selected based on the existing dark/light mode (use a `useEffect` that reads `document.documentElement.classList.contains('dark')` or similar — match how the rest of HireWire's components detect theme).

#### `StateFlowTimeline.jsx`
Receives `timeline` array prop. Renders a vertical list of timeline entries. Each entry shows:
- Numbered marker (with type-specific color: state / function / error / context-enter / etc.)
- Type-specific content:
  - **state** entries: "→ {state_name}" + triggered-by info + source badge (AI-initiated / Forced / Explicit / Implicit)
  - **function** entries: function name in monospace + args + result + any swaig actions
  - **context_enter** entries: "⤷ Context: {to}" + from-context if available
  - **other types**: name + timestamp

Layout matches the `flow-timeline-item` pattern from postpromptviewer (vertical list with left-side markers and right-side content cards).

### Parser

New file `web/src/app/dashboard/call-logs/lib/parseStateFlow.js`. Pure function:

```js
export function parseStateFlow(rawPayload) {
  // Returns { transitions, transitionCount, uniqueStates, uniqueStatesCount,
  //          aiInitiated, toolForced, totalFunctions, functionErrors,
  //          duration, detailedTimeline, mermaidDef }
}
```

Algorithm:
1. Pull `swaig_log = rawPayload?.swaig_log || []` and `call_log = rawPayload?.call_log || []` and `call_timeline = rawPayload?.call_timeline || []`.
2. Normalize `call_timeline` entries into the `swaig_log` shape (similar to postpromptviewer's `normalizeTimeline`).
3. Walk `swaig_log` and classify each entry:
   - **State transition events:** entries with `type` matching `/^step_change$|^state_change$/` (case-insensitive). Defensive — exact event name to be confirmed when first real call lands. Extract `from`, `to`, `source` ("ai" | "tool" | "gather" | "explicit" | "implicit"), `triggeredBy` (function name if applicable).
   - **Function calls:** entries with `function` field set. Extract `function`, `args`, `result`, `swaigActions`, `error`.
   - **Context navigation:** entries with `type === "context_enter"`. Extract `fromContext`, `toContext`.
4. Build:
   - `transitions`: list of `{from, to, source, triggeredBy, timestamp}` from state events.
   - `uniqueStates`: Set of state names seen.
   - `aiInitiated`: count of transitions where `source === "ai"`.
   - `toolForced`: count where `source` is `"tool"` or `"gather"`.
   - `totalFunctions`: count of function entries.
   - `functionErrors`: count of function entries with `error` set.
   - `duration`: from `rawPayload.call_start_date` and `call_end_date`, formatted as MM:SS.
   - `detailedTimeline`: chronological merge of state events, function calls, and context-enter events, each with `type` and metadata.
   - `mermaidDef`: a Mermaid `flowchart TB` string. Each unique state becomes a blue node; each unique function becomes a gold node; edges connect them based on transition order. Function calls within a state are linked from the state node to the function node. Errors highlighted red. (See "Mermaid generation" below for exact format.)

### Mermaid generation

Mermaid string format (mirrors postpromptviewer's pattern, simplified for v1):

```
flowchart TB
    classDef step fill:#044EF4,stroke:#0340c5,color:#fff
    classDef func fill:#FFD700,stroke:#d4b200,color:#000
    classDef terminal fill:#ef4444,stroke:#dc2626,color:#fff
    classDef error fill:#450a0a,stroke:#ef4444,color:#fff

    state_greet["greet"]:::step
    state_assist["assist"]:::step
    state_wrap_up["wrap_up"]:::terminal

    func_transfer["transfer_to_human"]:::func
    func_send_sms["send_summary_sms"]:::func

    state_greet --> state_assist
    state_assist --> func_transfer
    func_transfer --> state_assist
    state_assist --> state_wrap_up
    state_wrap_up --> func_send_sms
```

Node IDs use `state_<name>` and `func_<name>` prefixes to avoid collisions. Display labels are unprefixed.

For the function-call-only fallback (no state events), the diagram is a linear chain of function calls:

```
flowchart TB
    classDef func fill:#FFD700,stroke:#d4b200,color:#000
    func_check_business_hours["check_business_hours"]:::func
    func_transfer_to_human["transfer_to_human"]:::func
    func_check_business_hours --> func_transfer_to_human
```

### Defensive event-name handling

Per memory note from sub-project 1's smoke test: the exact field name for state-transition events in `swaig_log` is unconfirmed until a real WebRTC call lands. The parser will look for ALL of these patterns (case-insensitive):
- `entry.type === "step_change"`
- `entry.type === "state_change"`
- `entry.event === "step_change"` (alternative shape)
- `entry.event === "state_change"`

If none match, the parser still emits a function-call-only flow.

When the first real call confirms the actual event format, the parser is tightened. Document the actual format in `parseStateFlow.js` comments.

## Tests

Vitest unit tests in `web/test/parseStateFlow.test.js`:

### Fixture 1: empty payload
```js
parseStateFlow({}) === {
  transitions: [],
  transitionCount: 0,
  uniqueStates: [],
  uniqueStatesCount: 0,
  aiInitiated: 0,
  toolForced: 0,
  totalFunctions: 0,
  functionErrors: 0,
  duration: "0:00",
  detailedTimeline: [],
  mermaidDef: ""
}
```

### Fixture 2: function-calls-only (no state events)
Payload has `swaig_log` with 3 function-call entries, no state events. Parser produces a Mermaid chain of 3 function nodes, `transitionCount === 0`, `totalFunctions === 3`. `detailedTimeline` has 3 entries of type `"function"`.

### Fixture 3: full payload
Payload has `swaig_log` with 2 `step_change` events (greet→assist, assist→wrap_up), 4 function calls (one with `error`), 1 context-enter event. Parser produces:
- 2 transitions, 3 unique states (greet/assist/wrap_up)
- aiInitiated count matches sources
- 4 totalFunctions, 1 functionErrors
- mermaidDef contains all node IDs
- detailedTimeline merges all events in chronological order

Component rendering tests are deferred — Mermaid generates DOM that's hard to assert against without a real browser. Integration testing happens via the manual smoke test (run the dashboard, view a call log, verify the State Flow tab renders sensibly).

## Visual styling

HireWire's existing Tailwind dark-mode aesthetic stays. The new components use the same conventions:
- `bg-white dark:bg-gray-800` for cards
- `border border-gray-200 dark:border-gray-700` for borders
- `text-gray-500 dark:text-gray-400` for muted text
- `text-xs font-medium` for stat labels

The Mermaid diagram itself uses postpromptviewer's color palette (blue states, gold functions, red terminals/errors) since those are semantic — they communicate state-vs-function-vs-error and shouldn't be re-themed for HireWire.

## Mermaid library

`web/package.json` adds `mermaid` (latest stable). The library is loaded once per `StateFlowDiagram` component mount via `useEffect`. The diagram is rendered into a ref'd `<div className="mermaid">` using `mermaid.run({ querySelector: ... })`. SSR-safe: dynamic import only when window is defined.

## Performance considerations

- `parseStateFlow(rawPayload)` is wrapped in `useMemo` keyed off `rawPayload` so it doesn't re-parse on every re-render.
- Mermaid is loaded lazily — only when the State Flow tab is selected. The npm package is ~600 KB; lazy-loading it keeps the initial bundle slim.
- `detailedTimeline` for a long call could have hundreds of entries. The timeline list uses no virtualization in v1; if that becomes an issue, a follow-up adds `react-window` or similar.

## Out-of-scope (explicit)

- Pixel-exact P.I.E. Viewer CSS — keep HireWire's existing styling.
- Mermaid SVG/image export buttons.
- Search/filter within any tab.
- DB schema changes.
- Synthetic state-event reconstruction for historical call logs.
- Custom diagram colors per role (sales / support / receptionist).
- A11y polish beyond what existing components already provide.
- Performance optimization for very long calls (>500 events).

## Files touched

| Path | Action | Responsibility |
|---|---|---|
| `web/src/app/dashboard/call-logs/components/StateFlowPanel.jsx` | New | Top-level container, useMemo for parser, empty-state handling |
| `web/src/app/dashboard/call-logs/components/StateFlowStatCards.jsx` | New | 6-7 stat cards in a grid |
| `web/src/app/dashboard/call-logs/components/StateFlowDiagram.jsx` | New | Mermaid renderer + zoom controls + legend |
| `web/src/app/dashboard/call-logs/components/StateFlowTimeline.jsx` | New | Vertical event timeline below the diagram |
| `web/src/app/dashboard/call-logs/lib/parseStateFlow.js` | New | Pure parser, exports `parseStateFlow(rawPayload)` |
| `web/test/parseStateFlow.test.js` | New | Vitest tests for parser, 3 fixtures |
| `web/src/app/dashboard/call-logs/components/CallDetail.jsx` | Modify | Restructure to 9 P.I.E.-order tabs, move always-shown sections into Dashboard, rename labels, add State Flow tab |
| `web/package.json` | Modify | Add `mermaid` dep |

## Open questions for the implementation plan

1. Confirm the exact `mermaid` package version compatible with the project's React 18 + Vite setup.
2. Confirm where SSR / hydration of Mermaid is handled — the project uses React Router 7 which can SSR; Mermaid may need a `useEffect`-based mount to avoid SSR errors.
3. Determine the actual `step_change` event field name from a live call after sub-project 1 deploys (defensive parsing handles both `step_change` and `state_change` until then).
4. Decide whether to pre-render the Mermaid SVG server-side or always client-side. Client-side is simpler; SSR adds complexity for marginal benefit.
