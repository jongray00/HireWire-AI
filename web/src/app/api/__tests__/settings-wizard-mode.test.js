// web/src/app/api/__tests__/settings-wizard-mode.test.js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

let tmpDir;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-test-"));
  vi.stubEnv("DATABASE_PATH", path.join(tmpDir, "test.db"));
  vi.resetModules();
  // Touch the db so the schema is created
  await import("@/lib/db");
});

afterEach(async () => {
  const { closeDb } = await import("@/lib/db");
  closeDb();
  vi.resetModules();
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function callGet() {
  const { GET } = await import("../settings/wizard-mode/route.js");
  return GET();
}

async function callPut(body) {
  const { PUT } = await import("../settings/wizard-mode/route.js");
  const req = new Request("http://x/api/settings/wizard-mode", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return PUT(req);
}

describe("GET /api/settings/wizard-mode", () => {
  it("returns enabled=false when the row is missing", async () => {
    const res = await callGet();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ enabled: false });
  });
});

describe("PUT /api/settings/wizard-mode", () => {
  it("upserts and returns enabled=true", async () => {
    const res = await callPut({ enabled: true });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ enabled: true });

    const after = await callGet();
    const afterJson = await after.json();
    expect(afterJson).toEqual({ enabled: true });
  });

  it("upserts and returns enabled=false", async () => {
    await callPut({ enabled: true });
    const res = await callPut({ enabled: false });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ enabled: false });

    const after = await callGet();
    const afterJson = await after.json();
    expect(afterJson).toEqual({ enabled: false });
  });

  it("rejects non-boolean body with 400", async () => {
    const res = await callPut({ enabled: "yes" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/boolean/i);
  });

  it("rejects missing body with 400", async () => {
    const res = await callPut({});
    expect(res.status).toBe(400);
  });
});
