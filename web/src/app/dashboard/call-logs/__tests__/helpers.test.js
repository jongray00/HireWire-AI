import { describe, it, expect } from "vitest";
import {
  formatDuration,
  formatDate,
  getPerformanceRating,
  extractLatencyBreakdown,
  extractAsrConfidence,
  extractTpsData,
  extractSwaigLatency,
  extractRoleDistribution,
  buildTimelineEvents,
} from "../components/helpers";
import { makeCallLogMessage, makeSwaigEntry } from "./fixtures";

// Phase 0: helpers
describe("formatDuration", () => {
  it("returns — for falsy values", () => {
    expect(formatDuration(0)).toBe("—");
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
  });
  it("formats seconds only", () => {
    expect(formatDuration(45)).toBe("45s");
  });
  it("formats minutes and seconds", () => {
    expect(formatDuration(125)).toBe("2m 5s");
  });
});

describe("formatDate", () => {
  it("returns — for falsy", () => {
    expect(formatDate(null)).toBe("—");
  });
  it("formats ISO date string", () => {
    const result = formatDate("2026-03-24T12:00:00Z");
    expect(result).toBeTruthy();
    expect(result).not.toBe("—");
  });
});

// Phase 1: performance rating
describe("getPerformanceRating", () => {
  it("returns null for no latency", () => {
    expect(getPerformanceRating(null)).toBeNull();
  });
  it("returns Excellent for < 1200ms", () => {
    expect(getPerformanceRating(800).label).toBe("Excellent");
  });
  it("returns Good for 1200-1800ms", () => {
    expect(getPerformanceRating(1500).label).toBe("Good");
  });
  it("returns Fair for 1800-2500ms", () => {
    expect(getPerformanceRating(2000).label).toBe("Fair");
  });
  it("returns Needs Improvement for > 2500ms", () => {
    expect(getPerformanceRating(3000).label).toBe("Needs Improvement");
  });
});

// Phase 2: data extraction
describe("extractLatencyBreakdown", () => {
  it("returns empty for null", () => {
    expect(extractLatencyBreakdown(null)).toEqual([]);
  });
  it("extracts assistant latency decomposition", () => {
    const log = [
      makeCallLogMessage("assistant", { latency: 400, utterance_latency: 650, audio_latency: 1000 }),
      makeCallLogMessage("user"),
      makeCallLogMessage("assistant", { latency: 300, utterance_latency: 500, audio_latency: 800 }),
    ];
    const result = extractLatencyBreakdown(log);
    expect(result).toHaveLength(2);
    expect(result[0].llm).toBe(400);
    expect(result[0].utterance).toBe(250); // 650-400
    expect(result[0].audio).toBe(350); // 1000-650
    expect(result[0].total).toBe(1000);
  });
});

describe("extractAsrConfidence", () => {
  it("returns empty for null", () => {
    expect(extractAsrConfidence(null)).toEqual([]);
  });
  it("extracts user message confidence", () => {
    const log = [
      makeCallLogMessage("user", { confidence: 0.95 }),
      makeCallLogMessage("assistant"),
      makeCallLogMessage("user", { confidence: 0.72 }),
    ];
    const result = extractAsrConfidence(log);
    expect(result).toHaveLength(2);
    expect(result[0].confidence).toBe(95);
    expect(result[1].confidence).toBe(72);
  });
});

describe("extractTpsData", () => {
  it("returns empty for null", () => {
    expect(extractTpsData(null)).toEqual([]);
  });
  it("filters invalid TPS values", () => {
    const times = [
      { tps: 150, tokens: 100 },
      { tps: 0, tokens: 0 },
      { tps: 99999, tokens: 10 }, // overflow, filtered
      { tps: 120, tokens: 80 },
    ];
    const result = extractTpsData(times);
    expect(result).toHaveLength(2);
    expect(result[0].tps).toBe(150);
    expect(result[1].tps).toBe(120);
  });
});

describe("extractSwaigLatency", () => {
  it("returns empty for null", () => {
    expect(extractSwaigLatency(null)).toEqual([]);
  });
  it("groups by command name", () => {
    const log = [
      makeSwaigEntry({ command_name: "transfer", execution_latency: 200, function_latency: 150 }),
      makeSwaigEntry({ command_name: "transfer", execution_latency: 300, function_latency: 200 }),
      makeSwaigEntry({ command_name: "lookup", execution_latency: 100, function_latency: 80 }),
    ];
    const result = extractSwaigLatency(log);
    expect(result).toHaveLength(2);
    const transfer = result.find((r) => r.name === "transfer");
    expect(transfer.avgExec).toBe(250);
    expect(transfer.avgFunc).toBe(175);
    expect(transfer.calls).toBe(2);
  });
});

describe("extractRoleDistribution", () => {
  it("returns empty for null", () => {
    expect(extractRoleDistribution(null)).toEqual([]);
  });
  it("counts messages by role", () => {
    const log = [
      makeCallLogMessage("user"),
      makeCallLogMessage("assistant"),
      makeCallLogMessage("assistant"),
      makeCallLogMessage("tool"),
    ];
    const result = extractRoleDistribution(log);
    expect(result.find((r) => r.name === "user").value).toBe(1);
    expect(result.find((r) => r.name === "assistant").value).toBe(2);
    expect(result.find((r) => r.name === "tool").value).toBe(1);
  });
});

// Phase 4: timeline
describe("buildTimelineEvents", () => {
  it("returns empty for null", () => {
    expect(buildTimelineEvents(null)).toEqual([]);
  });
  it("builds events sorted by start time", () => {
    const start = 1000000000000;
    const log = [
      makeCallLogMessage("user", { timestamp: start + 5_000_000 }),
      makeCallLogMessage("assistant", { timestamp: start + 10_000_000, audio_latency: 1000 }),
    ];
    const events = buildTimelineEvents(log, null, start);
    expect(events).toHaveLength(2);
    expect(events[0].lane).toBe("User");
    expect(events[0].start).toBe(5);
    expect(events[1].lane).toBe("Assistant");
    expect(events[1].start).toBe(10);
  });
});
