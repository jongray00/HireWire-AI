import { describe, it, expect } from "vitest";
import { employeeRowToJson } from "../db";

describe("employeeRowToJson — end_call filter", () => {
  it("strips end_call from enabled_functions", () => {
    const row = {
      id: "a",
      project_id: "p",
      name: "Test",
      enabled_functions: JSON.stringify([
        "transfer_to_human",
        "end_call",
        "send_summary_sms",
      ]),
      speech_hints: "[]",
      business_days: "[1,2,3]",
      documents: "[]",
    };
    const json = employeeRowToJson(row);
    expect(json.enabled_functions).toEqual(["transfer_to_human", "send_summary_sms"]);
  });

  it("leaves an already-clean enabled_functions array alone", () => {
    const row = {
      id: "a",
      project_id: "p",
      name: "Test",
      enabled_functions: JSON.stringify(["transfer_to_human"]),
      speech_hints: "[]",
      business_days: "[]",
      documents: "[]",
    };
    expect(employeeRowToJson(row).enabled_functions).toEqual(["transfer_to_human"]);
  });

  it("returns null for null row (existing contract)", () => {
    expect(employeeRowToJson(null)).toBeNull();
  });
});
