export function formatDuration(sec) {
  if (!sec || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function formatDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function getPerformanceRating(avgLatencyMs) {
  if (!avgLatencyMs) return null;
  if (avgLatencyMs < 1200) return { label: "Excellent", color: "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30" };
  if (avgLatencyMs < 1800) return { label: "Good", color: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30" };
  if (avgLatencyMs < 2500) return { label: "Fair", color: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30" };
  return { label: "Needs Improvement", color: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30" };
}

export function extractLatencyBreakdown(callLog) {
  if (!callLog) return [];
  return callLog
    .filter(m => m.role === "assistant" && m.audio_latency)
    .map((m, i) => ({
      index: i + 1,
      llm: m.latency || 0,
      utterance: (m.utterance_latency || 0) - (m.latency || 0),
      audio: (m.audio_latency || 0) - (m.utterance_latency || m.latency || 0),
      total: m.audio_latency,
    }));
}

export function extractAsrConfidence(callLog) {
  if (!callLog) return [];
  return callLog
    .filter(m => m.role === "user" && m.confidence != null)
    .map((m, i) => ({
      index: i + 1,
      confidence: Math.round(m.confidence * 100),
      content: (m.content || "").slice(0, 40),
    }));
}

export function extractTpsData(times) {
  if (!times) return [];
  return times
    .filter(t => t.tps != null && t.tps > 0 && t.tps < 10000)
    .map((t, i) => ({
      index: i + 1,
      tps: Math.round(t.tps),
      tokens: t.tokens || 0,
    }));
}

export function extractSwaigLatency(swaigLog) {
  if (!swaigLog) return [];
  const byName = {};
  swaigLog.forEach(s => {
    const name = s.command_name || "unknown";
    if (!byName[name]) byName[name] = { name, execTimes: [], funcTimes: [] };
    if (s.execution_latency) byName[name].execTimes.push(s.execution_latency);
    if (s.function_latency) byName[name].funcTimes.push(s.function_latency);
  });
  return Object.values(byName).map(g => ({
    name: g.name,
    avgExec: g.execTimes.length ? Math.round(g.execTimes.reduce((a, b) => a + b, 0) / g.execTimes.length) : 0,
    avgFunc: g.funcTimes.length ? Math.round(g.funcTimes.reduce((a, b) => a + b, 0) / g.funcTimes.length) : 0,
    calls: g.execTimes.length || g.funcTimes.length,
  }));
}

export function extractRoleDistribution(callLog) {
  if (!callLog) return [];
  const counts = {};
  callLog.forEach(m => {
    const role = m.role || "unknown";
    counts[role] = (counts[role] || 0) + 1;
  });
  const colors = { user: "#3B82F6", assistant: "#6B7280", tool: "#F59E0B", system: "#94A3B8", "system-log": "#CBD5E1" };
  return Object.entries(counts).map(([role, count]) => ({
    name: role,
    value: count,
    color: colors[role] || "#94A3B8",
  }));
}

export function buildTimelineEvents(callLog, swaigLog, callStartDate) {
  if (!callLog) return [];
  const startUs = callStartDate || 0;
  const events = [];

  callLog.forEach((m, i) => {
    if (!m.timestamp) return;
    const offsetSec = (m.timestamp - startUs) / 1_000_000;
    const durationSec = m.audio_latency ? m.audio_latency / 1000 : 1;
    events.push({
      id: `msg-${i}`,
      lane: m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : m.role === "tool" ? "SWAIG" : "System",
      start: Math.max(0, offsetSec),
      end: Math.max(0, offsetSec + durationSec),
      label: (m.content || "").slice(0, 50),
      role: m.role,
    });
  });

  return events.sort((a, b) => a.start - b.start);
}
