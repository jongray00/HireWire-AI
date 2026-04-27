# Wizard Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the small embedded wizard preview with a focal two-column creation canvas, rewrite the wizard agent's prompt as POM, and persist wizard calls to call_logs for debugging.

**Architecture:** Sibling-component split. `WizardBanner` stays as the inline call surface; a new `WizardCreationCanvas` opens on the first wizard event and renders transcript + structured config side-by-side with a 4-checkpoint stepper. Communication is one-way over the existing `wizard-event` window broadcast plus a new `onTranscript` channel from `useWizardCall`. Wizard pseudo-employee rows are seeded per-project on user connect so the post-prompt webhook persists wizard sessions to `call_logs` without FK violations.

**Tech Stack:** React Router v7, `@signalwire/js@^3.29.1`, Tailwind CSS, better-sqlite3, Vitest, Python FastAPI, signalwire-agents SDK (POM)

**Spec:** `docs/superpowers/specs/2026-04-27-wizard-redesign-design.md`

---

## File Structure

### Files to Create

| Path | Responsibility |
|---|---|
| `web/src/components/dashboard/WizardCreationCanvas.jsx` | Two-column creation overlay (transcript + config + checkpoints) |
| `web/src/components/dashboard/__tests__/WizardCreationCanvas.test.jsx` | Canvas component tests |
| `web/src/app/hooks/__tests__/useWizardCall.test.js` | Hook tests covering `onTranscript` |
| `web/src/lib/__tests__/db.migration.test.js` | Schema migration + seed tests |

### Files to Modify

| Path | What changes |
|---|---|
| `web/src/lib/wizardEvents.js` | Add `WIZARD_CHECKPOINT` and `WIZARD_SAID` event types |
| `web/src/lib/db.ts` | Add `kind`/`is_hidden` columns to employees, `built_agent_id` to call_logs, filter wizard from `getEmployeesByProject`, seed wizard pseudo-employee on `upsertUser` |
| `web/src/app/api/post-prompt/[[...path]]/route.js` | Map `'wizard'` path → per-project pseudo-employee id, persist `built_agent_id` |
| `web/src/app/hooks/useWizardCall.js` | Add `onTranscript` callback; subscribe to SDK partial-recognition events |
| `web/src/components/dashboard/WizardBanner.jsx` | Strip preview/question/created-state from center column (canvas owns these now) |
| `web/src/app/dashboard/layout.jsx` | Mount `WizardCreationCanvas` next to `WizardBanner` |
| `web/src/app/dashboard/call-logs/page.jsx` | Add 🧙 wizard pill, built-agent link, `[All]/[Employees]/[Wizard]` filter chip |
| `web/src/app/dashboard/call-logs/__tests__/components.test.jsx` | Tests for the wizard pill, link, filter chip |
| `web/src/app/api/__tests__/post-prompt.test.js` (existing) | Tests for `built_agent_id` field; wizard FK no-error path |
| `web/src/components/dashboard/__tests__/wizard-flow.test.jsx` | Extend integration test with full new event sequence |
| `agent/main.py` | Rewrite `WizardAgent` prompt as 6 POM sections; add `mark_checkpoint` SWAIG tool; emit `wizard_said` from every tool; rewrite `set_post_prompt` JSON shape |
| `docs/DEMO_SCRIPT.md` | Update walkthrough for the new canvas experience |

### Tasks

20 tasks across 7 phases. Each task is self-contained, ends in a single commit, and includes failing tests before implementation per TDD.

---

## Phase A: Foundation — Schema, Seed, Post-Prompt

### Task 1: Schema migration — add `kind`, `is_hidden`, `built_agent_id`

**Files:**
- Modify: `web/src/lib/db.ts:120-138` (extend the existing migration block)
- Create: `web/src/lib/__tests__/db.migration.test.js`

- [ ] **Step 1: Write the failing migration test**

Create `web/src/lib/__tests__/db.migration.test.js`:

```javascript
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

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
}

describe("db migrations", () => {
  it("fresh DB has kind, is_hidden, built_agent_id columns", async () => {
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/__tests__/db.migration.test.js`
Expected: FAIL — "expected [...] to contain 'kind'"

- [ ] **Step 3: Add the columns to the migration block**

In `web/src/lib/db.ts`, find the `employeeColumnsToAdd` array around line 121–130 and extend it. Replace:

```typescript
  const employeeColumnsToAdd = [
    { name: 'business_hours_start', type: 'INTEGER DEFAULT 9' },
    { name: 'business_hours_end', type: 'INTEGER DEFAULT 18' },
    { name: 'business_days', type: "TEXT DEFAULT '[0,1,2,3,4]'" },
    { name: 'documents', type: "TEXT DEFAULT '[]'" },
    { name: 'email_provider', type: "TEXT DEFAULT ''" },
    { name: 'sendgrid_api_key', type: "TEXT DEFAULT ''" },
    { name: 'email_from_address', type: "TEXT DEFAULT ''" },
    { name: 'email_from_name', type: "TEXT DEFAULT ''" },
  ];
```

with:

```typescript
  const employeeColumnsToAdd = [
    { name: 'business_hours_start', type: 'INTEGER DEFAULT 9' },
    { name: 'business_hours_end', type: 'INTEGER DEFAULT 18' },
    { name: 'business_days', type: "TEXT DEFAULT '[0,1,2,3,4]'" },
    { name: 'documents', type: "TEXT DEFAULT '[]'" },
    { name: 'email_provider', type: "TEXT DEFAULT ''" },
    { name: 'sendgrid_api_key', type: "TEXT DEFAULT ''" },
    { name: 'email_from_address', type: "TEXT DEFAULT ''" },
    { name: 'email_from_name', type: "TEXT DEFAULT ''" },
    { name: 'kind', type: "TEXT NOT NULL DEFAULT 'employee'" },
    { name: 'is_hidden', type: 'INTEGER NOT NULL DEFAULT 0' },
  ];

  const callLogColumnsToAdd = [
    { name: 'built_agent_id', type: 'TEXT' },
  ];
```

Add the loop for the new array after the existing loop (after line 138):

```typescript
  for (const col of callLogColumnsToAdd) {
    try {
      db.exec(`ALTER TABLE call_logs ADD COLUMN ${col.name} ${col.type}`);
    } catch (e: any) {
      if (!e.message.includes('duplicate column')) throw e;
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/__tests__/db.migration.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/db.ts web/src/lib/__tests__/db.migration.test.js
git commit -m "feat: add kind/is_hidden/built_agent_id columns for wizard sessions"
```

---

### Task 2: Wizard pseudo-employee seed + getEmployeesByProject filter

**Files:**
- Modify: `web/src/lib/db.ts:184` (add filter to `getEmployeesByProject`)
- Modify: `web/src/lib/db.ts` (around `upsertUser` — add wizard seed)
- Modify: `web/src/lib/__tests__/db.migration.test.js` (add seed + filter tests)

- [ ] **Step 1: Write the failing tests**

Append to `web/src/lib/__tests__/db.migration.test.js`:

```javascript
import { upsertUser, getEmployeesByProject, getEmployeeById } from "../db.ts";

describe("wizard pseudo-employee", () => {
  it("upsertUser seeds a hidden wizard pseudo-employee for the project", () => {
    upsertUser({ projectId: "p1", spaceUrl: "s.signalwire.com", apiToken: "t" });
    const wizard = getEmployeeById("wizard-p1");
    expect(wizard).toBeDefined();
    expect(wizard.kind).toBe("wizard");
    expect(wizard.is_hidden).toBe(1);
    expect(wizard.project_id).toBe("p1");
  });

  it("seed is idempotent — calling upsertUser twice produces one wizard row", () => {
    upsertUser({ projectId: "p1", spaceUrl: "s.signalwire.com", apiToken: "t" });
    upsertUser({ projectId: "p1", spaceUrl: "s.signalwire.com", apiToken: "t" });
    const db = getDb();
    const rows = db.prepare("SELECT id FROM employees WHERE id = ?").all("wizard-p1");
    expect(rows.length).toBe(1);
  });

  it("getEmployeesByProject excludes wizard rows", () => {
    upsertUser({ projectId: "p1", spaceUrl: "s.signalwire.com", apiToken: "t" });
    const db = getDb();
    db.prepare(
      "INSERT INTO employees (id, project_id, name, role, kind, is_hidden) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("e1", "p1", "Alice", "Sales", "employee", 0);
    const employees = getEmployeesByProject("p1");
    expect(employees.map((e) => e.id)).toEqual(["e1"]);
  });
});
```

(Make sure `getDb` is imported at the top of the file — extend the existing import line if needed.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/__tests__/db.migration.test.js`
Expected: FAIL — `getEmployeeById('wizard-p1')` returns undefined

- [ ] **Step 3: Add wizard-seed call to `upsertUser`**

In `web/src/lib/db.ts`, find the `upsertUser` function. After the existing INSERT/UPDATE for users completes, add a wizard-employee seed at the end of the function (immediately before its closing `}`):

```typescript
  // Seed a hidden wizard pseudo-employee for this project so post-prompt
  // call logs can use it as the FK target without violating constraints.
  db.prepare(`
    INSERT OR IGNORE INTO employees (id, project_id, name, role, kind, is_hidden)
    VALUES (?, ?, 'Setup Wizard', 'Agent Builder', 'wizard', 1)
  `).run(`wizard-${data.projectId}`, data.projectId);
```

- [ ] **Step 4: Filter wizard rows from `getEmployeesByProject`**

Replace line 184:

```typescript
  return db.prepare('SELECT * FROM employees WHERE project_id = ? AND status = ? ORDER BY created_at DESC').all(projectId, 'active') as any[];
```

with:

```typescript
  return db.prepare(
    "SELECT * FROM employees WHERE project_id = ? AND status = ? AND is_hidden = 0 AND kind = 'employee' ORDER BY created_at DESC"
  ).all(projectId, 'active') as any[];
```

Apply the same filter to the all-employees query on line 189:

```typescript
  return db.prepare(
    "SELECT * FROM employees WHERE status = ? AND is_hidden = 0 AND kind = 'employee' ORDER BY created_at DESC"
  ).all('active') as any[];
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/lib/__tests__/db.migration.test.js`
Expected: PASS (all 5 tests green)

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/db.ts web/src/lib/__tests__/db.migration.test.js
git commit -m "feat: seed per-project wizard pseudo-employee on user upsert"
```

---

### Task 3: Post-prompt route — wizard mapping + built_agent_id

**Files:**
- Modify: `web/src/app/api/post-prompt/[[...path]]/route.js`
- Create or modify: `web/src/app/api/__tests__/post-prompt.test.js`

- [ ] **Step 1: Write the failing tests**

Create `web/src/app/api/__tests__/post-prompt.test.js`:

```javascript
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

afterEach(() => {
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/app/api/__tests__/post-prompt.test.js`
Expected: FAIL — wizard test gets FK error or wrong employee_id

- [ ] **Step 3: Update the route to map wizard path and persist `built_agent_id`**

In `web/src/app/api/post-prompt/[[...path]]/route.js`:

(a) Update the `insertCallLog` import line at the top:

```javascript
import { insertCallLog, getCallLogs, getEmployeeById, callLogRowToJson, insertCallAction, getCallActions } from '@/lib/db';
```

stays as-is.

(b) After the `const employeeId = pathSegments[0] || 'unknown';` line (~line 40), add wizard mapping:

```javascript
    // Wizard sessions are stored against a per-project pseudo-employee
    // so the FK to employees(id) is satisfied. Path always says "wizard"
    // — we resolve to "wizard-${projectId}" using the payload's project id.
    const projectId = payload.project_id || payload.space_id || null;
    const resolvedEmployeeId = employeeId === 'wizard' && projectId
      ? `wizard-${projectId}`
      : employeeId;
```

(c) Replace every later use of `employeeId` (in the `getEmployeeById(employeeId)` call, in the `insertCallLog({ ... employeeId, ... })`, in the `insertCallAction(callId, employeeId, ...)` loop, and in log strings) with `resolvedEmployeeId`. Specifically:

```javascript
    const emp = getEmployeeById(resolvedEmployeeId);
```

```javascript
    insertCallLog({
      id: logId,
      projectId: payload.project_id || payload.space_id || null,
      employeeId: resolvedEmployeeId,
      employeeName,
      employeeRole,
      // ... existing fields ...
      builtAgentId: postPromptData?.agent_built_id || null,  // ← NEW field
      rawPayload: payload,
    });
```

```javascript
    for (const mapping of actionMappings) {
      const actionData = globalData[mapping.key];
      if (actionData && typeof actionData === 'object') {
        try {
          insertCallAction(callId, resolvedEmployeeId, mapping.type, actionData);
          // ...
```

(d) Add `builtAgentId` to the `insertCallLog` signature in `web/src/lib/db.ts`. Find the `insertCallLog` function (~line 350-390) and:

- Add `builtAgentId?: string;` to the data type at the top.
- Add `built_agent_id` to the INSERT column list.
- Add `@builtAgentId` to the VALUES clause.
- Add `builtAgentId: data.builtAgentId || null,` to the `stmt.run({...})` object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/app/api/__tests__/post-prompt.test.js`
Expected: PASS (3/3)

- [ ] **Step 5: Run the full migration test suite again to confirm no regressions**

Run: `cd web && npx vitest run src/lib/__tests__/db.migration.test.js`
Expected: PASS (5/5)

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/db.ts web/src/app/api/post-prompt/[[...path]]/route.js web/src/app/api/__tests__/post-prompt.test.js
git commit -m "feat: post-prompt route maps wizard path to per-project pseudo-employee, persists built_agent_id"
```

---

## Phase B: Wizard Agent — POM prompt + new tool + transcript echo

### Task 4: Add `mark_checkpoint` SWAIG tool

**Files:**
- Modify: `agent/main.py` (add tool method to `WizardAgent` class)

- [ ] **Step 1: Add the tool method**

In `agent/main.py`, inside the `WizardAgent` class (after the `update_agent_preview` method around line 971 and before `create_agent`), add:

```python
    @AgentBase.tool(
        name="mark_checkpoint",
        description=(
            "Mark a build-progress checkpoint reached. Call exactly once per stage, "
            "in order: identity, voice, capabilities, review."
        ),
        parameters={
            "type": "object",
            "properties": {
                "stage": {
                    "type": "string",
                    "enum": ["identity", "voice", "capabilities", "review"],
                    "description": "Which checkpoint to mark"
                }
            },
            "required": ["stage"]
        }
    )
    def mark_checkpoint(self, args, raw_data):
        stage = args.get("stage", "")
        logger.info(f"[wizard] mark_checkpoint: {stage}")
        result = SwaigFunctionResult("")  # silent — no spoken response
        result.swml_user_event({
            "type": "wizard_checkpoint",
            "stage": stage
        })
        return result
```

- [ ] **Step 2: Boot-smoke the agent**

Run: `cd agent && python3 -c "from main import app; print('ok')"`
Expected: prints "ok" with no import errors.

- [ ] **Step 3: Commit**

```bash
git add agent/main.py
git commit -m "feat: add mark_checkpoint SWAIG tool to WizardAgent"
```

---

### Task 5: Emit `wizard_said` echo from every existing wizard SWAIG tool

**Files:**
- Modify: `agent/main.py` (add a second `swml_user_event` per existing tool result in `WizardAgent`)

- [ ] **Step 1: Update `ask_config_question`**

In `agent/main.py`, find `def ask_config_question` (~line 838). After the existing `result.swml_user_event({"type": "agent_config_question", ...})` call and before `return result`, add:

```python
        result.swml_user_event({
            "type": "wizard_said",
            "text": "I've displayed the options on your screen. Take a look and let me know which one feels right."
        })
```

(Use the *exact same string* the `SwaigFunctionResult(...)` constructor receives so transcript and TTS match.)

- [ ] **Step 2: Update `preview_agent`**

In `def preview_agent`, after the `result.swml_user_event({"type": "agent_preview", ...})` call and before `return result`, add:

```python
        result.swml_user_event({
            "type": "wizard_said",
            "text": f"I've shown a preview of {name} on your screen. Does that look good, or would you like to make any changes?"
        })
```

- [ ] **Step 3: Update `update_agent_preview`**

After its existing `result.swml_user_event(...)`:

```python
        result.swml_user_event({
            "type": "wizard_said",
            "text": "I've updated the preview on your screen with those changes."
        })
```

- [ ] **Step 4: Update `create_agent` — echo on success path only**

Find `def create_agent` (~line 1017). After it builds the success `SwaigFunctionResult` and emits `agent_created`, add a `wizard_said` echo with the same text the result was constructed with. (If the function has multiple return paths, add the echo only on the success path. If errors return their own `SwaigFunctionResult`, mirror them too.)

- [ ] **Step 5: Update `finalize_agent` similarly**

Find `def finalize_agent`. After it emits `agent_ready`, add:

```python
        result.swml_user_event({
            "type": "wizard_said",
            "text": <same string as the SwaigFunctionResult>
        })
```

- [ ] **Step 6: Boot-smoke**

Run: `cd agent && python3 -c "from main import app; print('ok')"`
Expected: prints "ok"

- [ ] **Step 7: Commit**

```bash
git add agent/main.py
git commit -m "feat: emit wizard_said event from every WizardAgent tool for live transcript"
```

---

### Task 6: Rewrite the wizard's POM prompt — six sections

**Files:**
- Modify: `agent/main.py` (replace `WizardAgent.__init__` prompt sections + temperature)

- [ ] **Step 1: Replace the existing prompt sections**

In `agent/main.py`, find the `WizardAgent.__init__` method. Locate the three existing `prompt_add_section(...)` calls ("Identity", "Setup Flow", "Available Capabilities") and the `set_param("temperature", 0.8)` line. Replace **all four** with the following block:

```python
        # ---------- §1 Identity ----------
        self.prompt_add_section(
            "Identity",
            body=(
                "You are the Agent Wizard for Sally Sales — a warm, knowledgeable setup assistant "
                "who builds custom AI voice agents for the user through a short phone conversation. "
                "You make the experience feel collaborative and exciting, like working with a coworker "
                "who really knows the product. You speak in short, friendly sentences (a phone call, "
                "not a lecture). You do not pretend to be human, and you do not over-apologize. "
                "The user is on the dashboard with a creation canvas open in front of them — let the "
                "screen do the heavy lifting for visual choices, and use your voice for guidance and rapport."
            )
        )

        # ---------- §2 Discovery ----------
        self.prompt_add_section(
            "Discovery — read the user's intent first",
            bullets=[
                "Open with a 1-line greeting and a single open question: \"What kind of agent would you like to build today?\"",
                "Listen to the answer and silently classify the user as one of: Specific (concrete use case), Vague (\"just build me something\"), Template-seeking (names a known type), Iterating (references an existing agent), or Curious/browsing.",
                "Specific: skip ahead — name, role, and prompt are mostly inferable from what they said.",
                "Vague: offer 3–4 starting points via ask_config_question (Sales / Support / Scheduling / Knowledge concierge).",
                "Template-seeking: confirm and proceed with that template's defaults.",
                "Iterating: acknowledge, copy what they referenced, and only collect the diffs.",
                "Curious/browsing: briefly enumerate the four archetypes above, then re-ask.",
                "Once you have a working name + role + 1-sentence purpose, call mark_checkpoint(\"identity\")."
            ]
        )

        # ---------- §3 Building ----------
        self.prompt_add_section(
            "Building — fill in the rest",
            bullets=[
                "Always emit preview_agent immediately after identity is captured, even with partial info — the user wants to see progress in the canvas.",
                "Use voice-only for free-form fields: name, greeting wording, custom prompt phrasing, what to say when transferring.",
                "Use ask_config_question for fixed sets: voice (openai.shimmer / openai.nova / openai.alloy), pace (friendly / professional / direct), capabilities (multi-select).",
                "After voice + greeting are confirmed, call mark_checkpoint(\"voice\").",
                "For capabilities, present them as multi-select via ask_config_question (use list_available_functions for the current set). After the user picks, call update_agent_preview with the function list, then walk through any per-capability config (transfer phone, hours, KB, etc.). When all selected capabilities are configured, call mark_checkpoint(\"capabilities\").",
                "Use update_agent_preview aggressively — every field change fires it. The canvas is watching.",
                "Keep spoken responses short (at most 2 sentences) while the canvas is doing the visual work."
            ]
        )

        # ---------- §4 Confirmation ----------
        self.prompt_add_section(
            "Confirmation",
            bullets=[
                "Before creating, recap in one breath: \"Okay — {name}, a {role} with {voice}'s voice, who can {top 2-3 capabilities}. Sound right?\"",
                "Wait for explicit yes. If the user hesitates or asks for changes, treat it as another update_agent_preview cycle — don't push.",
                "On explicit confirmation, call mark_checkpoint(\"review\"). Only then proceed to creation.",
                "If the user says \"scrap it\" or \"start over\", clear the preview by calling update_agent_preview with empty fields and return to Discovery."
            ]
        )

        # ---------- §5 Creation ----------
        self.prompt_add_section(
            "Creation",
            bullets=[
                "Say something brief and confident — \"Building {name} now…\" — then call create_agent with the full config. Silence during the call is okay (the canvas shows progress).",
                "When create_agent returns successfully, call finalize_agent immediately.",
                "After finalize, say: \"{name} is live. You can call them right from the canvas, or end this call and I'll get out of your way.\"",
                "If create_agent fails, surface the error briefly (\"Hmm, the build didn't go through — {short reason}. Want to try again?\") and offer to retry."
            ]
        )

        # ---------- §6 Conversation Style (cross-cutting) ----------
        self.prompt_add_section(
            "Conversation Style",
            bullets=[
                "1–2 sentences per turn. Phone-call cadence, not chatbot.",
                "Don't read out long lists — defer to ask_config_question so the user sees options on screen instead.",
                "Don't say \"I'm calling the function now\" or narrate tool use. Just call the tool and let the screen update.",
                "Use the user's words back at them when summarizing — if they said \"billing questions\", don't translate to \"customer service inquiries\".",
                "Never invent capabilities the system doesn't have (video, payments, CRM integration). Say so plainly and offer the closest supported behavior.",
                "When in doubt, ask. One question, then listen."
            ]
        )

        self.set_param("temperature", 0.7)
```

- [ ] **Step 2: Update `function_fillers` in the existing `add_language(...)` block**

Find the `add_language(name="English", ...)` call near line 729. Replace its `function_fillers` list with:

```python
            function_fillers=[
                "Updating the preview...",
                "Building it now...",
                "One moment while I set this up..."
            ]
```

`mark_checkpoint` itself stays silent — it has no `function_fillers` because the tool returns an empty `SwaigFunctionResult("")`.

- [ ] **Step 3: Boot-smoke**

Run: `cd agent && python3 -c "from main import app; print('ok')"`
Expected: prints "ok"

- [ ] **Step 4: Commit**

```bash
git add agent/main.py
git commit -m "feat: rewrite WizardAgent prompt as six POM sections (Identity/Discovery/Building/Confirmation/Creation/Style)"
```

---

### Task 7: Rewrite `set_post_prompt` to emit `agent_built_id`

**Files:**
- Modify: `agent/main.py:779-788` (the wizard's `set_post_prompt` block)

- [ ] **Step 1: Replace the post-prompt instruction**

In `agent/main.py`, find the `WizardAgent`'s `set_post_prompt(...)` call (around line 779). Replace it with:

```python
        # Configure post-prompt for call logging
        self.set_post_prompt(
            "Summarize this wizard session as JSON with exactly these fields:\n"
            '- "summary": 2-3 sentence summary of what was discussed/created\n'
            '- "caller_intent": what the user wanted to build\n'
            '- "outcome": one of "resolved", "transferred", "abandoned", or "follow_up_needed"\n'
            '- "sentiment": one of "positive", "neutral", or "negative"\n'
            '- "topics": array of topic keyword strings\n'
            '- "follow_up": any action items or follow-up needed (null if none)\n'
            '- "agent_built_id": the employee id returned by create_agent if you created an agent in this session, otherwise null\n'
            "Respond ONLY with the JSON object, no extra text."
        )
```

- [ ] **Step 2: Boot-smoke**

Run: `cd agent && python3 -c "from main import app; print('ok')"`
Expected: prints "ok"

- [ ] **Step 3: Commit**

```bash
git add agent/main.py
git commit -m "feat: WizardAgent post-prompt emits agent_built_id linking session to created employee"
```

---

## Phase C: Hook — onTranscript Channel

### Task 8: Extend `useWizardCall` with `onTranscript`

**Files:**
- Modify: `web/src/app/hooks/useWizardCall.js`
- Create: `web/src/app/hooks/__tests__/useWizardCall.test.js`

- [ ] **Step 1: Write failing tests for `onTranscript`**

Create `web/src/app/hooks/__tests__/useWizardCall.test.js`:

```javascript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

let mockClient;
let mockSession;

beforeEach(() => {
  mockSession = {
    on: vi.fn(),
    start: vi.fn(() => Promise.resolve()),
    hangup: vi.fn(() => Promise.resolve()),
  };
  mockClient = {
    on: vi.fn(),
    dial: vi.fn(() => Promise.resolve(mockSession)),
  };
  vi.doMock("@signalwire/js", () => ({
    SignalWire: vi.fn(() => Promise.resolve(mockClient)),
  }));
  global.fetch = vi.fn((url) => {
    if (url.endsWith("/api/auth/session")) return Promise.resolve({ ok: true });
    if (url.endsWith("/api/signalwire/widget-token"))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ token: "tok" }) });
    return Promise.reject(new Error("unexpected fetch: " + url));
  });
});

describe("useWizardCall", () => {
  it("forwards SDK partial recognition events to onTranscript", async () => {
    const onTranscript = vi.fn();
    const { useWizardCall } = await import("../useWizardCall.js");
    const { result } = renderHook(() => useWizardCall({ onTranscript }));

    await act(async () => {
      await result.current.startCall();
    });

    // Find the partial-recognition handler the hook subscribed to. The hook
    // should subscribe to the SDK's partial event under one of these names.
    const partialHandler = (mockClient.on.mock.calls.find(
      ([name]) => name === "prompt" || name === "call.updated"
    ) || [])[1];
    expect(partialHandler).toBeDefined();

    act(() => {
      partialHandler({ partial_recognition: { text: "hello there", final: false } });
    });

    expect(onTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", text: "hello there", isPartial: true })
    );
  });

  it("forwards wizard_said user_event to onTranscript as wizard role", async () => {
    const onTranscript = vi.fn();
    const { useWizardCall } = await import("../useWizardCall.js");
    const { result } = renderHook(() => useWizardCall({ onTranscript }));

    await act(async () => {
      await result.current.startCall();
    });

    const userEventHandler = mockClient.on.mock.calls.find(([name]) => name === "user_event")?.[1];
    expect(userEventHandler).toBeDefined();

    act(() => {
      userEventHandler({ event: { type: "wizard_said", text: "Welcome!" } });
    });

    expect(onTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ role: "wizard", text: "Welcome!", isPartial: false })
    );
  });

  it("does not call onTranscript for non-transcript user_events (regression)", async () => {
    const onEvent = vi.fn();
    const onTranscript = vi.fn();
    const { useWizardCall } = await import("../useWizardCall.js");
    const { result } = renderHook(() => useWizardCall({ onEvent, onTranscript }));

    await act(async () => {
      await result.current.startCall();
    });

    const userEventHandler = mockClient.on.mock.calls.find(([name]) => name === "user_event")?.[1];

    act(() => {
      userEventHandler({ event: { type: "agent_preview", name: "Sarah" } });
    });

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "agent_preview" }));
    expect(onTranscript).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/app/hooks/__tests__/useWizardCall.test.js`
Expected: FAIL — `onTranscript` is not part of the hook's API yet.

- [ ] **Step 3: Add `onTranscript` to the hook**

In `web/src/app/hooks/useWizardCall.js`:

(a) Update the function signature:

```javascript
export function useWizardCall({ onEvent, onTranscript } = {}) {
```

(b) After the existing `client.on("user_event", ...)` subscription, add filtering for `wizard_said`:

```javascript
      // Existing user_event handler — split into onEvent vs onTranscript
      client.on("user_event", (params) => {
        const eventData = params?.event || params;
        if (eventData?.type === "wizard_said") {
          if (onTranscript) {
            onTranscript({
              role: "wizard",
              text: eventData.text || "",
              isPartial: false,
              t: Date.now(),
            });
          }
          return;
        }
        if (onEvent) onEvent(eventData);
      });
```

(c) Add SDK partial-recognition subscription right after the `user_event` listener (the SDK version pinned is `@signalwire/js@^3.29.1`; subscribe to both candidate event names defensively):

```javascript
      const handlePartial = (params) => {
        if (!onTranscript) return;
        const partial = params?.partial_recognition || params?.detail?.partial_recognition;
        if (!partial?.text) return;
        onTranscript({
          role: "user",
          text: partial.text,
          isPartial: !partial.final,
          t: Date.now(),
        });
      };
      try { client.on("prompt", handlePartial); } catch {}
      try { client.on("call.updated", handlePartial); } catch {}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/app/hooks/__tests__/useWizardCall.test.js`
Expected: PASS (3/3)

- [ ] **Step 5: Run the whole web suite to confirm no banner regressions**

Run: `cd web && npm test`
Expected: All previously-passing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/hooks/useWizardCall.js web/src/app/hooks/__tests__/useWizardCall.test.js
git commit -m "feat: useWizardCall.onTranscript splits wizard_said + SDK partials into transcript stream"
```

---

## Phase D: WizardCreationCanvas

### Task 9: Add new event constants and parser entries

**Files:**
- Modify: `web/src/lib/wizardEvents.js`

- [ ] **Step 1: Extend the `WIZARD_EVENTS` object**

Replace the contents of `web/src/lib/wizardEvents.js` with:

```javascript
/**
 * Wizard Agent Real-Time Event Protocol
 *
 * These event types are sent by the Python wizard agent via swml_user_event()
 * and received in the browser on the client.on('user_event', ...) channel.
 */

export const WIZARD_EVENTS = {
  AGENT_PREVIEW: 'agent_preview',
  AGENT_CREATED: 'agent_created',
  AGENT_UPDATED: 'agent_updated',
  AGENT_CONFIG_QUESTION: 'agent_config_question',
  AGENT_READY: 'agent_ready',
  WIZARD_CHECKPOINT: 'wizard_checkpoint',
  WIZARD_SAID: 'wizard_said',
};

/**
 * Parse a user_event payload and extract wizard event data if present.
 * @param {object} event - The raw event from SignalWire
 * @returns {{ type: string, data: object } | null}
 */
export function parseWizardEvent(event) {
  const detail = event?.detail || event?.call_state?.user_input || event;
  if (!detail?.type) return null;

  const knownTypes = Object.values(WIZARD_EVENTS);
  if (!knownTypes.includes(detail.type)) return null;

  return { type: detail.type, data: detail };
}
```

- [ ] **Step 2: Run the existing tests to confirm no regressions**

Run: `cd web && npx vitest run src/components/dashboard/__tests__/wizard-flow.test.jsx src/components/dashboard/__tests__/WizardBanner.test.jsx`
Expected: PASS (existing tests unchanged behavior)

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/wizardEvents.js
git commit -m "feat: add WIZARD_CHECKPOINT and WIZARD_SAID event types"
```

---

### Task 10: Create `WizardCreationCanvas` skeleton + visibility logic

**Files:**
- Create: `web/src/components/dashboard/WizardCreationCanvas.jsx`
- Create: `web/src/components/dashboard/__tests__/WizardCreationCanvas.test.jsx`

- [ ] **Step 1: Write failing visibility tests**

Create `web/src/components/dashboard/__tests__/WizardCreationCanvas.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

let capturedOnTranscript;
let capturedOnEvent;
const mockEndCall = vi.fn();

vi.mock("@/app/hooks/useWizardCall", () => ({
  useWizardCall: ({ onEvent, onTranscript } = {}) => {
    capturedOnEvent = onEvent;
    capturedOnTranscript = onTranscript;
    return {
      startCall: vi.fn(),
      endCall: mockEndCall,
      calling: window.__testWizardCalling || false,
      connected: window.__testWizardConnected || false,
      connectionState: window.__testWizardConnectionState || "idle",
      error: null,
      videoRef: { current: null },
    };
  },
}));

import WizardCreationCanvas from "../WizardCreationCanvas";

describe("WizardCreationCanvas — visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.__testWizardCalling = false;
    window.__testWizardConnected = false;
    window.__testWizardConnectionState = "idle";
    capturedOnEvent = null;
    capturedOnTranscript = null;
  });

  it("is hidden by default when no call is active", () => {
    const { container } = render(<WizardCreationCanvas />);
    expect(container.querySelector('[data-testid="wizard-canvas"]')).toBeNull();
  });

  it("opens on first agent_config_question event during active call", () => {
    window.__testWizardCalling = true;
    window.__testWizardConnected = true;
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => {
      capturedOnEvent({ type: "agent_config_question", question: "What kind?", options: ["A"], field: "role" });
    });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("wizard-canvas")).toBeDefined();
    expect(screen.getByText("What kind?")).toBeDefined();
  });

  it("opens on first agent_preview event during active call", () => {
    window.__testWizardCalling = true;
    window.__testWizardConnected = true;
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => {
      capturedOnEvent({ type: "agent_preview", name: "Sarah", role: "Support" });
    });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("wizard-canvas")).toBeDefined();
  });

  it("stays hidden if call ends without any wizard event", () => {
    window.__testWizardCalling = true;
    const { rerender, container } = render(<WizardCreationCanvas />);
    window.__testWizardCalling = false;
    window.__testWizardConnected = false;
    rerender(<WizardCreationCanvas />);
    expect(container.querySelector('[data-testid="wizard-canvas"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/dashboard/__tests__/WizardCreationCanvas.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the component skeleton**

Create `web/src/components/dashboard/WizardCreationCanvas.jsx`:

```jsx
"use client";

import { useState, useCallback, useEffect } from "react";
import { Wand2, X } from "lucide-react";
import { useWizardCall } from "@/app/hooks/useWizardCall";
import { WIZARD_EVENTS, parseWizardEvent } from "@/lib/wizardEvents";

/**
 * WizardCreationCanvas — focal overlay for the agent-being-built experience.
 *
 * Hidden until the first wizard event during an active call. Opens with a
 * two-column layout: live transcript (left), structured config + checkpoint
 * stepper (right). Backdrop click does not dismiss.
 */
export default function WizardCreationCanvas() {
  const [hasReceivedFirstEvent, setHasReceivedFirstEvent] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [config, setConfig] = useState({});
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [checkpoints, setCheckpoints] = useState({
    identity: false, voice: false, capabilities: false, review: false
  });
  const [createdAgent, setCreatedAgent] = useState(null);
  const [readyAgent, setReadyAgent] = useState(null);

  const handleEvent = useCallback((eventData) => {
    const parsed = parseWizardEvent(eventData);
    if (!parsed) return;

    if (
      parsed.type === WIZARD_EVENTS.AGENT_CONFIG_QUESTION ||
      parsed.type === WIZARD_EVENTS.AGENT_PREVIEW
    ) {
      setHasReceivedFirstEvent(true);
    }

    switch (parsed.type) {
      case WIZARD_EVENTS.AGENT_CONFIG_QUESTION:
        setCurrentQuestion(parsed.data);
        break;
      case WIZARD_EVENTS.AGENT_PREVIEW:
        setConfig((prev) => ({ ...prev, ...parsed.data }));
        setCurrentQuestion(null);
        break;
      case WIZARD_EVENTS.WIZARD_CHECKPOINT:
        setCheckpoints((prev) => ({ ...prev, [parsed.data.stage]: true }));
        break;
      case WIZARD_EVENTS.AGENT_CREATED:
        setCreatedAgent(parsed.data.employee);
        break;
      case WIZARD_EVENTS.AGENT_READY:
        setReadyAgent(parsed.data);
        break;
      default:
        break;
    }
  }, []);

  const handleTranscript = useCallback((line) => {
    setTranscript((prev) => {
      // Replace partial with new partial; append final lines.
      if (line.isPartial && prev.length > 0 && prev[prev.length - 1].isPartial && prev[prev.length - 1].role === line.role) {
        return [...prev.slice(0, -1), line];
      }
      return [...prev, line];
    });
  }, []);

  const { calling, connected, connectionState, endCall } = useWizardCall({
    onEvent: handleEvent,
    onTranscript: handleTranscript,
  });

  const isCallActive = calling || connected;

  // Hide canvas when call ends and there's nothing to show
  useEffect(() => {
    if (!isCallActive && !createdAgent && !readyAgent) {
      // Reset for next call
      setHasReceivedFirstEvent(false);
      setTranscript([]);
      setConfig({});
      setCurrentQuestion(null);
      setCheckpoints({ identity: false, voice: false, capabilities: false, review: false });
    }
  }, [isCallActive, createdAgent, readyAgent]);

  const shouldShow = hasReceivedFirstEvent || createdAgent;
  if (!shouldShow) return null;

  const handleDismiss = () => {
    setCreatedAgent(null);
    setReadyAgent(null);
    setHasReceivedFirstEvent(false);
  };

  return (
    <div
      data-testid="wizard-canvas"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <div className="w-[85vw] h-[80vh] max-w-6xl bg-gray-900 border border-purple-500/40 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header — placeholder; populated in Task 12 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-purple-500/20">
          <div className="flex items-center gap-3">
            <Wand2 className="w-5 h-5 text-purple-400" />
            <span className="font-medium text-white">Setup Wizard</span>
            {connectionState === "connected" && (
              <span className="text-xs text-green-400">● Live</span>
            )}
          </div>
          {!isCallActive && (
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Close wizard canvas"
              className="p-1.5 text-gray-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Body — placeholder; populated in Tasks 11-13 */}
        <div className="flex-1 grid grid-cols-2 divide-x divide-purple-500/20 overflow-hidden">
          <div data-testid="wizard-transcript" className="p-6 overflow-y-auto" />
          <div data-testid="wizard-config" className="p-6 overflow-y-auto">
            {currentQuestion && <div>{currentQuestion.question}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/dashboard/__tests__/WizardCreationCanvas.test.jsx`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/dashboard/WizardCreationCanvas.jsx web/src/components/dashboard/__tests__/WizardCreationCanvas.test.jsx
git commit -m "feat: WizardCreationCanvas skeleton with event-driven visibility"
```

---

### Task 11: Canvas — transcript column

**Files:**
- Modify: `web/src/components/dashboard/WizardCreationCanvas.jsx` (replace empty transcript div)
- Modify: `web/src/components/dashboard/__tests__/WizardCreationCanvas.test.jsx` (add transcript test)

- [ ] **Step 1: Add failing transcript test**

Append to `WizardCreationCanvas.test.jsx`:

```jsx
describe("WizardCreationCanvas — transcript", () => {
  beforeEach(() => {
    window.__testWizardCalling = true;
    window.__testWizardConnected = true;
  });

  it("renders wizard and user transcript lines in chronological order", () => {
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => { capturedOnEvent({ type: "agent_config_question", question: "?", options: [], field: "x" }); });
    act(() => { capturedOnTranscript({ role: "wizard", text: "Hi there", isPartial: false, t: 1 }); });
    act(() => { capturedOnTranscript({ role: "user", text: "hello", isPartial: false, t: 2 }); });
    rerender(<WizardCreationCanvas />);
    const transcriptCol = screen.getByTestId("wizard-transcript");
    expect(transcriptCol.textContent).toContain("Hi there");
    expect(transcriptCol.textContent).toContain("hello");
    // Wizard line comes before user line
    expect(transcriptCol.textContent.indexOf("Hi there")).toBeLessThan(
      transcriptCol.textContent.indexOf("hello")
    );
  });

  it("replaces partial user line with the next partial from same role", () => {
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => { capturedOnEvent({ type: "agent_config_question", question: "?", options: [], field: "x" }); });
    act(() => { capturedOnTranscript({ role: "user", text: "hel", isPartial: true, t: 1 }); });
    act(() => { capturedOnTranscript({ role: "user", text: "hello world", isPartial: true, t: 2 }); });
    rerender(<WizardCreationCanvas />);
    const transcriptCol = screen.getByTestId("wizard-transcript");
    expect(transcriptCol.textContent).toContain("hello world");
    expect(transcriptCol.textContent).not.toContain("hel ");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/dashboard/__tests__/WizardCreationCanvas.test.jsx`
Expected: FAIL — transcript column is empty.

- [ ] **Step 3: Render the transcript**

In `WizardCreationCanvas.jsx`, replace the empty `<div data-testid="wizard-transcript" ... />` with:

```jsx
          <div
            data-testid="wizard-transcript"
            className="p-6 overflow-y-auto space-y-3 bg-gray-950/40"
          >
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-3">📜 Conversation</div>
            {transcript.length === 0 && (
              <p className="text-sm text-gray-500 italic">Waiting for the conversation to begin…</p>
            )}
            {transcript.map((line, i) => (
              <div key={`${line.t}-${i}`} className={`flex gap-2 text-sm ${line.role === "wizard" ? "text-purple-200" : "text-gray-200"}`}>
                <span className={`shrink-0 font-medium ${line.role === "wizard" ? "text-purple-400" : "text-blue-400"}`}>
                  {line.role === "wizard" ? "Wizard:" : "You:"}
                </span>
                <span className={line.isPartial ? "italic opacity-70" : ""}>{line.text}</span>
              </div>
            ))}
          </div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/dashboard/__tests__/WizardCreationCanvas.test.jsx`
Expected: PASS (6/6)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/dashboard/WizardCreationCanvas.jsx web/src/components/dashboard/__tests__/WizardCreationCanvas.test.jsx
git commit -m "feat: render live transcript column in WizardCreationCanvas"
```

---

### Task 12: Canvas — config column + 4-checkpoint stepper

**Files:**
- Modify: `web/src/components/dashboard/WizardCreationCanvas.jsx`
- Modify: `web/src/components/dashboard/__tests__/WizardCreationCanvas.test.jsx`

- [ ] **Step 1: Add failing tests for config and stepper**

Append to `WizardCreationCanvas.test.jsx`:

```jsx
describe("WizardCreationCanvas — config + stepper", () => {
  beforeEach(() => {
    window.__testWizardCalling = true;
    window.__testWizardConnected = true;
  });

  it("renders config fields as agent_preview events arrive", () => {
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => {
      capturedOnEvent({
        type: "agent_preview",
        name: "Sarah",
        role: "Billing Support",
        voice: "openai.shimmer",
      });
    });
    rerender(<WizardCreationCanvas />);
    const config = screen.getByTestId("wizard-config");
    expect(config.textContent).toContain("Sarah");
    expect(config.textContent).toContain("Billing Support");
    expect(config.textContent).toContain("openai.shimmer");
  });

  it("merges update_agent_preview into existing config", () => {
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => { capturedOnEvent({ type: "agent_preview", name: "Sarah", role: "Support" }); });
    act(() => { capturedOnEvent({ type: "agent_preview", voice: "openai.nova", greeting: "Hi!" }); });
    rerender(<WizardCreationCanvas />);
    const config = screen.getByTestId("wizard-config");
    expect(config.textContent).toContain("Sarah");
    expect(config.textContent).toContain("openai.nova");
    expect(config.textContent).toContain("Hi!");
  });

  it("checkpoint stepper advances on wizard_checkpoint events", () => {
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => { capturedOnEvent({ type: "agent_preview", name: "Sarah" }); });
    act(() => { capturedOnEvent({ type: "wizard_checkpoint", stage: "identity" }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("checkpoint-identity")).toHaveAttribute("data-state", "passed");
    expect(screen.getByTestId("checkpoint-voice")).toHaveAttribute("data-state", "pending");
  });

  it("out-of-order checkpoints don't regress earlier ones", () => {
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => { capturedOnEvent({ type: "agent_preview", name: "Sarah" }); });
    act(() => { capturedOnEvent({ type: "wizard_checkpoint", stage: "identity" }); });
    act(() => { capturedOnEvent({ type: "wizard_checkpoint", stage: "voice" }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("checkpoint-identity")).toHaveAttribute("data-state", "passed");
    expect(screen.getByTestId("checkpoint-voice")).toHaveAttribute("data-state", "passed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/dashboard/__tests__/WizardCreationCanvas.test.jsx`
Expected: FAIL — config column doesn't render fields, no stepper.

- [ ] **Step 3: Render the config column**

In `WizardCreationCanvas.jsx`, replace the existing config column div with:

```jsx
          <div data-testid="wizard-config" className="p-6 overflow-y-auto space-y-4">
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-3">🤖 Building agent</div>
            <ConfigField label="Name" value={config.name} />
            <ConfigField label="Role" value={config.role} />
            <ConfigField label="Voice" value={config.voice} />
            <ConfigField label="Greeting" value={config.greeting} />
            <ConfigField
              label="Capabilities"
              value={config.functions?.length ? config.functions.join(", ") : null}
            />
            <ConfigField label="Knowledge" value={config.knowledgeDocs?.length ? `${config.knowledgeDocs.length} docs` : null} />
            <ConfigField label="Hours" value={config.businessHours} />

            {currentQuestion && (
              <div className="mt-6 p-4 bg-purple-900/30 border border-purple-500/40 rounded-lg">
                <p className="text-sm text-white font-medium mb-2">{currentQuestion.question}</p>
                <div className="flex flex-wrap gap-1.5">
                  {currentQuestion.options?.map((opt, i) => (
                    <span key={i} className="px-2.5 py-1 bg-purple-600/30 border border-purple-500/40 rounded-lg text-xs text-purple-200">
                      {opt}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {config.prompt && (
              <div className="mt-6 pt-4 border-t border-purple-500/20">
                <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Prompt preview</div>
                <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono">{config.prompt}</pre>
              </div>
            )}
          </div>
```

Add the `ConfigField` helper component at the bottom of the same file (above `export default`):

```jsx
function ConfigField({ label, value }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-xs uppercase tracking-wide text-gray-500 w-24 shrink-0">{label}</span>
      <span className={`text-sm ${value ? "text-white" : "text-gray-600 italic"}`}>
        {value || "—"}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Render the checkpoint stepper in the header**

Replace the canvas header block to include the stepper. Replace the existing header `<div className="flex items-center justify-between px-6 py-4 border-b border-purple-500/20">...</div>` with:

```jsx
        <div className="flex items-center justify-between px-6 py-4 border-b border-purple-500/20">
          <div className="flex items-center gap-3">
            <Wand2 className="w-5 h-5 text-purple-400" />
            <span className="font-medium text-white">Setup Wizard</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckpointDot label="Identity" state={checkpoints.identity ? "passed" : "pending"} testid="checkpoint-identity" />
            <span className="text-gray-600">━</span>
            <CheckpointDot label="Voice" state={checkpoints.voice ? "passed" : "pending"} testid="checkpoint-voice" />
            <span className="text-gray-600">━</span>
            <CheckpointDot label="Capabilities" state={checkpoints.capabilities ? "passed" : "pending"} testid="checkpoint-capabilities" />
            <span className="text-gray-600">━</span>
            <CheckpointDot label="Review" state={checkpoints.review ? "passed" : "pending"} testid="checkpoint-review" />
          </div>
          <div className="flex items-center gap-3">
            {connectionState === "connected" && (
              <span className="text-xs text-green-400">● Live</span>
            )}
            {!isCallActive && (
              <button
                type="button"
                onClick={handleDismiss}
                aria-label="Close wizard canvas"
                className="p-1.5 text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
```

Add the `CheckpointDot` helper next to `ConfigField`:

```jsx
function CheckpointDot({ label, state, testid }) {
  const colors = {
    pending: "bg-gray-700 text-gray-500",
    passed: "bg-purple-600 text-white",
  };
  return (
    <div data-testid={testid} data-state={state} className="flex items-center gap-1.5">
      <span className={`w-2.5 h-2.5 rounded-full ${colors[state]}`} />
      <span className={`text-xs ${state === "passed" ? "text-purple-300" : "text-gray-500"}`}>{label}</span>
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/dashboard/__tests__/WizardCreationCanvas.test.jsx`
Expected: PASS (10/10)

- [ ] **Step 6: Commit**

```bash
git add web/src/components/dashboard/WizardCreationCanvas.jsx web/src/components/dashboard/__tests__/WizardCreationCanvas.test.jsx
git commit -m "feat: WizardCreationCanvas config column and 4-checkpoint stepper"
```

---

### Task 13: Canvas — created/ready celebratory state + dismiss gating

**Files:**
- Modify: `web/src/components/dashboard/WizardCreationCanvas.jsx`
- Modify: `web/src/components/dashboard/__tests__/WizardCreationCanvas.test.jsx`

- [ ] **Step 1: Add failing tests**

Append to `WizardCreationCanvas.test.jsx`:

```jsx
describe("WizardCreationCanvas — created/ready states", () => {
  it("shows celebratory state on agent_created", () => {
    window.__testWizardCalling = true;
    window.__testWizardConnected = true;
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => {
      capturedOnEvent({
        type: "agent_created",
        employee: { id: "e1", name: "Sarah", role: "Support" }
      });
    });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByText(/Sarah is ready/i)).toBeDefined();
  });

  it("shows 'Call your new agent' CTA after agent_ready", () => {
    window.__testWizardCalling = true;
    window.__testWizardConnected = true;
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => { capturedOnEvent({ type: "agent_created", employee: { id: "e1", name: "Sarah" } }); });
    act(() => { capturedOnEvent({ type: "agent_ready", employee_id: "e1", swml_route: "/swml/e1" }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByRole("button", { name: /call your new agent/i })).toBeDefined();
  });

  it("close button is disabled while call is active", () => {
    window.__testWizardCalling = true;
    window.__testWizardConnected = true;
    const { rerender } = render(<WizardCreationCanvas />);
    act(() => { capturedOnEvent({ type: "agent_preview", name: "Sarah" }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.queryByLabelText("Close wizard canvas")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/dashboard/__tests__/WizardCreationCanvas.test.jsx`
Expected: FAIL — no celebratory text, no CTA.

- [ ] **Step 3: Add the created/ready states**

In `WizardCreationCanvas.jsx`, add a celebratory banner that renders ABOVE the two-column body when `createdAgent` is set. Insert this just inside the `flex-1 grid grid-cols-2...` div's parent (between header and body):

```jsx
        {createdAgent && (
          <div className="px-6 py-4 bg-gradient-to-r from-green-900/30 to-purple-900/30 border-b border-green-500/30 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">✨</span>
              <div>
                <p className="text-sm font-medium text-green-300">{createdAgent.name} is ready</p>
                <p className="text-xs text-gray-400">{createdAgent.role}</p>
              </div>
            </div>
            {readyAgent && (
              <button
                type="button"
                aria-label="Call your new agent"
                className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-medium text-white transition-colors"
              >
                Call your new agent
              </button>
            )}
          </div>
        )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/dashboard/__tests__/WizardCreationCanvas.test.jsx`
Expected: PASS (13/13)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/dashboard/WizardCreationCanvas.jsx web/src/components/dashboard/__tests__/WizardCreationCanvas.test.jsx
git commit -m "feat: WizardCreationCanvas celebratory state and Call-Your-New-Agent CTA"
```

---

## Phase E: Integration

### Task 14: Refactor `WizardBanner` — remove preview/question/created from center column

**Files:**
- Modify: `web/src/components/dashboard/WizardBanner.jsx`
- Modify: `web/src/components/dashboard/__tests__/WizardBanner.test.jsx` (update assertions for the new center)

- [ ] **Step 1: Update banner tests**

In `WizardBanner.test.jsx`, find the test that asserts the banner shows preview cards (likely "shows agent created confirmation" or "shows question…"). Update those assertions to check that the banner *does not* render those — it should only render call status and an idle hint. Replace the relevant `it(...)` blocks with:

```jsx
  it("shows 'Speak to the wizard...' hint during active call with no events", () => {
    window.__testWizardCalling = true;
    window.__testWizardConnected = true;
    window.__testWizardConnectionState = "connected";
    render(<WizardBanner />);
    expect(screen.getByText(/Speak to the wizard/i)).toBeDefined();
  });

  it("does NOT render preview/question/created cards anymore (canvas owns those)", () => {
    window.__testWizardCalling = true;
    window.__testWizardConnected = true;
    window.__testWizardConnectionState = "connected";
    const { rerender } = render(<WizardBanner />);
    window.__testWizardOnEvent({
      type: "agent_preview",
      name: "Sarah",
      role: "Support",
    });
    rerender(<WizardBanner />);
    // Sarah's name should NOT appear in the banner — canvas renders it
    expect(screen.queryByText("Sarah")).toBeNull();
  });
```

(Delete or rewrite the older "shows agent created confirmation" / "shows question when agent_config_question event fires" tests so they no longer assert banner-side rendering of those events.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/dashboard/__tests__/WizardBanner.test.jsx`
Expected: FAIL — banner still renders Sarah, hint text missing.

- [ ] **Step 3: Strip preview/question/created from `WizardBanner.jsx`**

In `WizardBanner.jsx`:

(a) Remove the `preview`, `question`, `createdAgent`, `readyAgent` state variables.

(b) Simplify `handleWizardEvent` — keep the broadcast for other listeners (employees-page highlight) but remove banner-side state updates:

```javascript
  const handleWizardEvent = useCallback((eventData) => {
    const parsed = parseWizardEvent(eventData);
    if (!parsed) return;
    // Broadcast to other listeners (canvas, employees page).
    window.dispatchEvent(new CustomEvent("wizard-event", { detail: parsed.data }));
  }, []);
```

(c) Remove the `WIZARD_EVENTS` import-only-for-banner cases (you can keep the import since it's used by `parseWizardEvent`).

(d) Replace the entire `{/* Center: Question / Preview / Created */}` block (the central `<div className="flex-1 min-w-0">...`) with:

```jsx
          <div className="flex-1 min-w-0">
            {isActive && (
              <p className="text-sm text-gray-400">
                Speak to the wizard to start building your agent…
              </p>
            )}
          </div>
```

(e) Drop the `hasResults` branch and the trailing `<X>` dismiss button — the banner has no after-call state to show now. The banner is only ever idle, error, or active.

(f) Update the `if (!isActive && !hasResults && !error)` and `if (!isActive && !hasResults && error)` conditions to drop `&& !hasResults`:

```jsx
  // Idle CTA bar
  if (!isActive && !error) { /* ... */ }

  // Error state
  if (!isActive && error) { /* ... */ }

  // Active banner
  return ( /* ... */ );
```

(g) Remove the `import` of `Sparkles, Check, MessageCircle` if they were only used in the removed JSX — leave Wand2, Phone, PhoneOff, X if still referenced.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/dashboard/__tests__/WizardBanner.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/dashboard/WizardBanner.jsx web/src/components/dashboard/__tests__/WizardBanner.test.jsx
git commit -m "refactor: WizardBanner no longer renders preview/question/created (canvas owns them)"
```

---

### Task 15: Mount `WizardCreationCanvas` in dashboard layout

**Files:**
- Modify: `web/src/app/dashboard/layout.jsx`

- [ ] **Step 1: Add import and mount**

In `web/src/app/dashboard/layout.jsx`, near the existing `import WizardBanner from ...` line (around line 19):

```javascript
import WizardBanner from "@/components/dashboard/WizardBanner";
import WizardCreationCanvas from "@/components/dashboard/WizardCreationCanvas";
```

Find the existing `<WizardBanner />` usage (around line 264). Replace:

```jsx
        <WizardBanner />
```

with:

```jsx
        <WizardBanner />
        <WizardCreationCanvas />
```

- [ ] **Step 2: Smoke check by running the dev server**

Run: `cd web && npm run dev` (in another terminal if not already running). Open `http://localhost:5000/dashboard` (or 5001 if 5000 is taken). Confirm the dashboard renders without console errors. The canvas should be invisible because no call is active.

- [ ] **Step 3: Run full web test suite**

Run: `cd web && npm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/dashboard/layout.jsx
git commit -m "feat: mount WizardCreationCanvas globally in dashboard layout"
```

---

### Task 16: Extend `wizard-flow.test.jsx` with the full new event sequence

**Files:**
- Modify: `web/src/components/dashboard/__tests__/wizard-flow.test.jsx`

- [ ] **Step 1: Replace the integration test with a fuller sequence**

Open `web/src/components/dashboard/__tests__/wizard-flow.test.jsx`. The existing test renders `WizardBanner` and walks through events. Replace it to render `WizardCreationCanvas` and walk the full new sequence including checkpoints:

```jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";

let capturedOnEvent;
let capturedOnTranscript;

vi.mock("@/app/hooks/useWizardCall", () => ({
  useWizardCall: ({ onEvent, onTranscript } = {}) => {
    capturedOnEvent = onEvent;
    capturedOnTranscript = onTranscript;
    return {
      startCall: vi.fn(),
      endCall: vi.fn(),
      calling: true,
      connected: true,
      connectionState: "connected",
      error: null,
      videoRef: { current: null },
    };
  },
}));

import WizardCreationCanvas from "../WizardCreationCanvas";

describe("Wizard Flow Integration — full new sequence", () => {
  it("walks question → checkpoint(identity) → preview → update → checkpoints(voice/capabilities) → review → created → ready", () => {
    const { rerender } = render(<WizardCreationCanvas />);

    // Step 1: First question opens the canvas
    act(() => {
      capturedOnEvent({ type: "agent_config_question", question: "What kind of agent?", options: ["Support", "Sales"], field: "role" });
    });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("wizard-canvas")).toBeDefined();
    expect(screen.getByText("What kind of agent?")).toBeDefined();

    // Step 2: Identity checkpoint
    act(() => { capturedOnEvent({ type: "wizard_checkpoint", stage: "identity" }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("checkpoint-identity")).toHaveAttribute("data-state", "passed");

    // Step 3: Preview clears the question card
    act(() => {
      capturedOnEvent({ type: "agent_preview", name: "Sarah", role: "Customer Support", voice: "openai.shimmer" });
    });
    rerender(<WizardCreationCanvas />);
    expect(screen.queryByText("What kind of agent?")).toBeNull();
    const config = screen.getByTestId("wizard-config");
    expect(config.textContent).toContain("Sarah");
    expect(config.textContent).toContain("openai.shimmer");

    // Step 4: Update preview merges
    act(() => { capturedOnEvent({ type: "agent_preview", greeting: "Hi, this is Sarah." }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("wizard-config").textContent).toContain("Hi, this is Sarah.");

    // Step 5: Voice + Capabilities checkpoints
    act(() => { capturedOnEvent({ type: "wizard_checkpoint", stage: "voice" }); });
    act(() => { capturedOnEvent({ type: "wizard_checkpoint", stage: "capabilities" }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("checkpoint-voice")).toHaveAttribute("data-state", "passed");
    expect(screen.getByTestId("checkpoint-capabilities")).toHaveAttribute("data-state", "passed");

    // Step 6: Review checkpoint
    act(() => { capturedOnEvent({ type: "wizard_checkpoint", stage: "review" }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("checkpoint-review")).toHaveAttribute("data-state", "passed");

    // Step 7: Agent created
    act(() => {
      capturedOnEvent({ type: "agent_created", employee: { id: "e1", name: "Sarah", role: "Customer Support" } });
    });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByText(/Sarah is ready/i)).toBeDefined();

    // Step 8: Agent ready → CTA
    act(() => { capturedOnEvent({ type: "agent_ready", employee_id: "e1", swml_route: "/swml/e1" }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByRole("button", { name: /call your new agent/i })).toBeDefined();

    // Step 9: Transcript also captured
    act(() => { capturedOnTranscript({ role: "wizard", text: "Welcome!", isPartial: false, t: 1 }); });
    rerender(<WizardCreationCanvas />);
    expect(screen.getByTestId("wizard-transcript").textContent).toContain("Welcome!");
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/dashboard/__tests__/wizard-flow.test.jsx`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/components/dashboard/__tests__/wizard-flow.test.jsx
git commit -m "test: wizard-flow integration covers full new sequence including checkpoints"
```

---

## Phase F: Call Logs UI

### Task 17: Call Logs page — wizard pill + built-agent link + filter chip

**Files:**
- Modify: `web/src/app/dashboard/call-logs/page.jsx`
- Modify: `web/src/lib/db.ts` (extend `callLogRowToJson` to expose `built_agent_id`)
- Modify: `web/src/app/dashboard/call-logs/__tests__/components.test.jsx`

- [ ] **Step 1: Expose `built_agent_id` in the API**

In `web/src/lib/db.ts`, find `callLogRowToJson` (search for the function). Add `builtAgentId: row.built_agent_id || null,` to its return object.

- [ ] **Step 2: Write failing UI tests**

In `web/src/app/dashboard/call-logs/__tests__/components.test.jsx`, add a new `describe` block at the bottom:

```jsx
describe("Call Logs — wizard rows", () => {
  const baseLog = (overrides = {}) => ({
    id: "c1",
    timestamp: new Date().toISOString(),
    duration_sec: 30,
    summary: "test",
    employee_name: "Sarah",
    employee_role: "Support",
    employeeId: "emp_x",
    builtAgentId: null,
    actions: [],
    ...overrides,
  });

  it("renders 🧙 Wizard Session pill for employeeId='wizard-{projectId}'", () => {
    const logs = [baseLog({ employeeId: "wizard-p1", employee_name: "Setup Wizard" })];
    render(<CallLogsList logs={logs} filter="all" />);
    expect(screen.getByText(/Wizard Session/i)).toBeDefined();
  });

  it("renders 'Built: {name}' link when builtAgentId is set", () => {
    const logs = [baseLog({ employeeId: "wizard-p1", builtAgentId: "emp_x" })];
    const employees = [{ id: "emp_x", name: "Sarah" }];
    render(<CallLogsList logs={logs} employees={employees} filter="all" />);
    const link = screen.getByRole("link", { name: /Built: Sarah/i });
    expect(link.getAttribute("href")).toContain("emp_x");
  });

  it("filter='wizard' shows only wizard rows", () => {
    const logs = [
      baseLog({ id: "c1", employeeId: "emp_x" }),
      baseLog({ id: "c2", employeeId: "wizard-p1" }),
    ];
    render(<CallLogsList logs={logs} filter="wizard" />);
    expect(screen.queryByText("c1")).toBeNull();
    expect(screen.queryByText("c2")).toBeDefined();
  });

  it("filter='employees' hides wizard rows", () => {
    const logs = [
      baseLog({ id: "c1", employeeId: "emp_x" }),
      baseLog({ id: "c2", employeeId: "wizard-p1" }),
    ];
    render(<CallLogsList logs={logs} filter="employees" />);
    expect(screen.queryByText("Wizard Session")).toBeNull();
  });
});
```

(`CallLogsList` is the list component the page imports; if the page renders inline, extract a small `<CallLogsList>` sub-component that takes `logs`, `employees`, `filter` and use it from the page.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd web && npx vitest run src/app/dashboard/call-logs/__tests__/components.test.jsx`
Expected: FAIL — wizard pill / built link / filter not implemented.

- [ ] **Step 4: Implement the wizard pill, link, and filter**

In `web/src/app/dashboard/call-logs/page.jsx`:

(a) Add a small `isWizardLog` helper:

```javascript
const isWizardLog = (log) => typeof log.employeeId === "string" && log.employeeId.startsWith("wizard-");
```

(b) Add filter state at the top of the page component:

```javascript
const [filter, setFilter] = useState("all"); // "all" | "employees" | "wizard"
```

(c) Filter chip UI above the list:

```jsx
<div className="flex gap-2 mb-4">
  {["all", "employees", "wizard"].map((f) => (
    <button
      key={f}
      type="button"
      onClick={() => setFilter(f)}
      className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
        filter === f
          ? "bg-purple-600 text-white"
          : "bg-gray-800 text-gray-300 hover:bg-gray-700"
      }`}
    >
      {f === "all" ? "All" : f === "employees" ? "Employees" : "🧙 Wizard"}
    </button>
  ))}
</div>
```

(d) Filter the logs list:

```javascript
const visibleLogs = logs.filter((log) => {
  if (filter === "all") return true;
  if (filter === "wizard") return isWizardLog(log);
  return !isWizardLog(log);
});
```

(e) For each log row, when `isWizardLog(log)` is true, render the 🧙 pill instead of the employee name. When `log.builtAgentId` is set, render a link to that employee:

```jsx
{isWizardLog(log) ? (
  <span className="px-2 py-0.5 bg-purple-600/20 border border-purple-500/40 rounded-full text-xs text-purple-300">
    🧙 Wizard Session
  </span>
) : (
  <span className="text-sm text-white">{log.employee_name}</span>
)}
{log.builtAgentId && (
  <a
    href={`/dashboard/employees/${log.builtAgentId}`}
    className="ml-2 text-xs text-green-400 hover:text-green-300"
  >
    → Built: {employeesById[log.builtAgentId]?.name || log.builtAgentId}
  </a>
)}
```

(`employeesById` is whatever map the page already uses; if not present, derive from the existing employees list with `useMemo`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/app/dashboard/call-logs/__tests__/components.test.jsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/db.ts web/src/app/dashboard/call-logs/page.jsx web/src/app/dashboard/call-logs/__tests__/components.test.jsx
git commit -m "feat: call logs page renders wizard pill, built-agent link, and All/Employees/Wizard filter"
```

---

## Phase G: Documentation + Final Verification

### Task 18: Update `docs/DEMO_SCRIPT.md`

**Files:**
- Modify: `docs/DEMO_SCRIPT.md`

- [ ] **Step 1: Replace the wizard section**

In `docs/DEMO_SCRIPT.md`, find Section "4. Call the Setup Wizard". Replace it with:

```markdown
### 4. Call the Setup Wizard (2-3 minutes) — THE MAIN EVENT
- The purple **Setup Wizard** banner is at the top of every page
- Click **Call Now**
- Allow microphone access when prompted
- The banner expands — you'll see "Connecting..." → "Live"

**Say to the wizard:**
> "Build me a customer support agent for a software company. It should handle bug reports and billing questions."

- Watch the **Wizard Creation Canvas** open over the dashboard — the wizard's voice drives a 4-checkpoint progression (Identity → Voice → Capabilities → Review) at the top of the panel
- The left column streams the live transcript; the right column populates structured fields and a prompt preview as the wizard collects info
- Say: "Add email follow-ups and make the voice more professional"
- The canvas updates immediately — voice changes, functions list grows
- Say: "Looks good, create it"
- The canvas flips to a celebratory "✨ {name} is ready" state with a "Call your new agent" CTA

### 5. Inspect the Wizard Session (30 seconds)
- End the wizard call
- Navigate to **Call Logs** — the wizard call appears with a 🧙 **Wizard Session** pill and a "→ Built: {name}" link
- Open it — the transcript view shows the full conversation, useful for debugging the wizard's progression
```

- [ ] **Step 2: Commit**

```bash
git add docs/DEMO_SCRIPT.md
git commit -m "docs: update demo walkthrough for wizard creation canvas + call-log debugging"
```

---

### Task 19: Run full test suite + agent boot smoke

**Files:** None (verification only)

- [ ] **Step 1: Run all frontend tests**

Run: `cd web && npm test`
Expected: All ~126 tests pass (existing 111 + ~15 new).

- [ ] **Step 2: Boot-smoke the Python agent**

Run: `cd agent && python3 -c "from main import app; print('ok')"`
Expected: prints "ok"

- [ ] **Step 3: If anything fails — fix and re-commit**

If a test fails or the agent fails to import, fix the issue, commit with a descriptive message (e.g., `fix: resolve test failure in WizardCreationCanvas — checkpoint state out-of-order regression`), and re-run.

---

### Task 20: Manual demo verification

**Files:** None (verification only)

- [ ] **Step 1: Start the agent + ngrok + web**

In separate terminals:

```bash
cd agent && python3 main.py
ngrok http 8000
cd web && npm run dev
```

Confirm the agent log shows "🔍 Auto-detected ngrok URL: …".

- [ ] **Step 2: Run the wizard end-to-end (success path)**

Open the dashboard. Click the wizard's **Call Now** button. When asked, speak the demo line from `docs/DEMO_SCRIPT.md`. Watch the canvas open on the first wizard event, fill in fields, advance checkpoints, and end with the celebratory state. Confirm:

- Canvas opens automatically on first event
- Transcript on the left streams both wizard and user lines
- Config on the right populates as the wizard collects info
- All 4 checkpoint dots transition from gray to purple in order
- "✨ {name} is ready" + "Call your new agent" CTA appears
- After hangup, navigate to `/dashboard/call-logs` and confirm: 🧙 Wizard Session pill, "→ Built: {name}" link, and the transcript renders chronologically when expanded

- [ ] **Step 3: Run the wizard end-to-end (abandoned path)**

Start a new wizard call. Say a few things, then hang up before the wizard says "Building it now…". Confirm:

- Canvas closes on call end (or shows "Session ended — nothing was created" if it had opened)
- A row appears in `/dashboard/call-logs` with the 🧙 pill but **no** "→ Built" link
- `built_agent_id` is null for that row (verify via the SQLite DB or by inspecting the UI)

- [ ] **Step 4: Final commit if any small fixes were needed**

If manual testing surfaced bugs, fix them in tight commits with descriptive messages. Otherwise no commit is needed for this task.

---

## Summary

| Phase | Tasks | Key Deliverable |
|---|---|---|
| A: Foundation | 1-3 | Schema columns, wizard pseudo-employee, post-prompt route accepts wizard + built_agent_id |
| B: Wizard agent | 4-7 | `mark_checkpoint` tool, `wizard_said` echoes, six POM sections, post-prompt JSON shape |
| C: Hook | 8 | `useWizardCall.onTranscript` channel |
| D: Canvas | 9-13 | `WizardCreationCanvas` (visibility, transcript, config + stepper, celebratory states) |
| E: Integration | 14-16 | Banner refactor, layout mount, end-to-end integration test |
| F: Call Logs UI | 17 | Wizard pill, built-agent link, filter chip |
| G: Docs + verify | 18-20 | DEMO_SCRIPT update, full test suite, manual run-through |

**Total: 20 tasks**
