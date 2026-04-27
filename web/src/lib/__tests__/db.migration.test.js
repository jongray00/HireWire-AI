// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import Database from "better-sqlite3";

let tmpDir;
let dbPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sally-db-test-"));
  dbPath = path.join(tmpDir, "test.db");
  vi.stubEnv("DATABASE_PATH", dbPath);
});

afterEach(async () => {
  const { closeDb } = await import("../db.ts");
  closeDb();
  vi.resetModules();
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
}

describe("db migrations", () => {
  it("fresh DB has kind, is_hidden, built_agent_id columns", async () => {
    vi.resetModules();
    const { getDb } = await import("../db.ts");
    const db = getDb();
    expect(columnNames(db, "employees")).toContain("kind");
    expect(columnNames(db, "employees")).toContain("is_hidden");
    expect(columnNames(db, "call_logs")).toContain("built_agent_id");
  });

  it("existing DB without new columns gets them added without data loss", async () => {
    // Set up a "pre-migration" DB with only the original columns
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE users (project_id TEXT PRIMARY KEY);
      CREATE TABLE employees (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES users(project_id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        role TEXT
      );
      CREATE TABLE call_logs (
        id TEXT PRIMARY KEY,
        employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL
      );
      INSERT INTO users (project_id) VALUES ('p1');
      INSERT INTO employees (id, project_id, name, role) VALUES ('e1', 'p1', 'Alice', 'Sales');
      INSERT INTO call_logs (id, employee_id) VALUES ('c1', 'e1');
    `);
    raw.close();

    // Now import db.ts — its initSchema() runs on first getDb() call
    vi.resetModules();
    const { getDb } = await import("../db.ts");
    const db = getDb();

    expect(columnNames(db, "employees")).toContain("kind");
    expect(columnNames(db, "employees")).toContain("is_hidden");
    expect(columnNames(db, "call_logs")).toContain("built_agent_id");

    // Existing data preserved
    const emp = db.prepare("SELECT * FROM employees WHERE id = ?").get("e1");
    expect(emp.name).toBe("Alice");
    const log = db.prepare("SELECT * FROM call_logs WHERE id = ?").get("c1");
    expect(log.employee_id).toBe("e1");
  });
});
