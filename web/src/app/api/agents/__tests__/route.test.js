// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/db", () => ({
  getEmployeesByProject: vi.fn(() => []),
  getEmployeeById: vi.fn(),
  upsertEmployee: vi.fn(),
  deleteEmployee: vi.fn(),
  employeeRowToJson: vi.fn((row) => ({ id: row.id, name: row.name })),
}));

vi.mock("@/lib/session", () => ({
  getSessionFromRequest: vi.fn(() => ({
    projectId: "test-project",
    spaceUrl: "test.signalwire.com",
  })),
}));

vi.mock("@/lib/db", async () => {
  return {
    getUserByProjectId: vi.fn(() => ({
      project_id: "test-project",
      space_url: "test.signalwire.com",
      api_token: "test-token",
      subscriber_id: null,
      subscriber_data: null,
    })),
    getEmployeesByProject: vi.fn(() => [
      { id: "emp1", name: "Agent One", status: "active" },
    ]),
    getEmployeeById: vi.fn((id) =>
      id === "emp1"
        ? { id: "emp1", name: "Agent One", status: "active", enabled_functions: "[]" }
        : null
    ),
    upsertEmployee: vi.fn(),
    deleteEmployee: vi.fn(),
    employeeRowToJson: vi.fn((row) => row ? { id: row.id, name: row.name } : null),
  };
});

import { getEmployeesByProject, getEmployeeById, upsertEmployee, deleteEmployee } from "@/lib/db";

describe("Agent CRUD API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) }));
  });

  it("validates that agent schema module exports correctly", async () => {
    const { validateAgentConfig, AVAILABLE_FUNCTIONS } = await import("@/lib/agentSchema");
    expect(validateAgentConfig).toBeDefined();
    expect(AVAILABLE_FUNCTIONS).toHaveLength(7);
  });

  it("validates agent config rejects empty name", async () => {
    const { validateAgentConfig } = await import("@/lib/agentSchema");
    const result = validateAgentConfig({ prompt: "test" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("name is required");
  });

  it("validates agent config accepts valid config", async () => {
    const { validateAgentConfig } = await import("@/lib/agentSchema");
    const result = validateAgentConfig({ name: "Test", prompt: "Do things" });
    expect(result.valid).toBe(true);
  });

  it("converts config to backend payload format", async () => {
    const { configToBackendPayload } = await import("@/lib/agentSchema");
    const payload = configToBackendPayload(
      { name: "Bot", prompt: "Help", functions: ["end_call"], businessHours: { start: 10, end: 17, days: [1, 2, 3] } },
      { id: "x", projectId: "p" }
    );
    expect(payload.enabled_functions).toEqual(["end_call"]);
    expect(payload.business_hours_start).toBe(10);
    expect(payload.id).toBe("x");
  });
});
