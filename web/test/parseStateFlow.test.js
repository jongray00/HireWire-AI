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
    expect(result.mermaidDef).toContain("func_send_summary_sms");
    // Linear chain: check → transfer → sms
    expect(result.mermaidDef).toContain("func_check_business_hours --> func_transfer_to_human");
    expect(result.mermaidDef).toContain("func_transfer_to_human --> func_send_summary_sms");
  });

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
