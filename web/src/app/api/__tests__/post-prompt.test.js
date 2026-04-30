// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

let tmpDir;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sally-pp-test-"));
  vi.stubEnv("DATABASE_PATH", path.join(tmpDir, "test.db"));
  vi.resetModules();
  const { upsertUser, getDb } = await import("@/lib/db");
  upsertUser({ projectId: "p1", spaceUrl: "s.signalwire.com", apiToken: "t" });
  // Seed a real employee for the agent-built-id test
  const db = getDb();
  db.prepare(
    "INSERT INTO employees (id, project_id, name, role, kind, is_hidden) VALUES (?, ?, ?, ?, ?, ?)"
  ).run("emp_x", "p1", "Sarah", "Billing Support", "employee", 0);
});

afterEach(async () => {
  const { closeDb } = await import("@/lib/db");
  closeDb();
  vi.resetModules();
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function postWith(employeeIdSeg, payload) {
  const { POST } = await import("../post-prompt/[[...path]]/route.js");
  const req = new Request("http://x/api/post-prompt/" + employeeIdSeg, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return POST(req, { params: { path: [employeeIdSeg] } });
}

describe("post-prompt webhook", () => {
  it("wizard call: stores call_log with employee_id='wizard-p1' and built_agent_id", async () => {
    const res = await postWith("wizard", {
      call_id: "c1",
      project_id: "p1",
      call_log: [{ role: "user", content: "hi" }],
      swaig_log: [],
      global_data: {},
      post_prompt_data: {
        substituted: JSON.stringify({
          summary: "Built billing-support agent Sarah",
          outcome: "resolved",
          sentiment: "positive",
          topics: ["billing"],
          agent_built_id: "emp_x",
        }),
      },
    });
    expect(res.status).toBe(200);

    const { getDb } = await import("@/lib/db");
    const db = getDb();
    const row = db.prepare("SELECT * FROM call_logs WHERE id = ?").get("c1");
    expect(row).toBeDefined();
    expect(row.employee_id).toBe("wizard-p1");
    expect(row.built_agent_id).toBe("emp_x");
    expect(row.summary).toContain("Sarah");
  });

  it("wizard call without agent_built_id stores null built_agent_id", async () => {
    const res = await postWith("wizard", {
      call_id: "c2",
      project_id: "p1",
      call_log: [],
      swaig_log: [],
      global_data: {},
      post_prompt_data: {
        substituted: JSON.stringify({ summary: "abandoned", outcome: "abandoned" }),
      },
    });
    expect(res.status).toBe(200);
    const { getDb } = await import("@/lib/db");
    const row = getDb().prepare("SELECT built_agent_id FROM call_logs WHERE id = ?").get("c2");
    expect(row.built_agent_id).toBeNull();
  });

  it("regular employee call still works (regression)", async () => {
    const res = await postWith("emp_x", {
      call_id: "c3",
      project_id: "p1",
      call_log: [],
      swaig_log: [],
      global_data: {},
      post_prompt_data: { substituted: '{"summary":"ok"}' },
    });
    expect(res.status).toBe(200);
    const { getDb } = await import("@/lib/db");
    const row = getDb().prepare("SELECT employee_id FROM call_logs WHERE id = ?").get("c3");
    expect(row.employee_id).toBe("emp_x");
  });
});
