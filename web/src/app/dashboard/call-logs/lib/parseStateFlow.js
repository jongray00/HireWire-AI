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
