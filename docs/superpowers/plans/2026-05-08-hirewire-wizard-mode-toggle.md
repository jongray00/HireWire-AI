# HireWire Wizard Mode Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the wizard a user-toggleable "Wizard Mode" setting (default OFF) so HireWire-AI can replace the standalone HireWire app, then archive the HireWire repo.

**Architecture:** Server-side `app_settings` row `wizard_mode_enabled` (default `false`) read/written via a new `/api/settings/wizard-mode` route. A `useWizardMode` hook fetches the flag on mount. The Settings page exposes a toggle. The Dashboard's `DashboardSplitHero` accepts a `wizardEnabled` prop and renders only `TemplateCarouselCard` (full-width) when `false`, or the existing two-column `WizardCallCard` + `TemplateCarouselCard` layout when `true`. Server-side wizard infrastructure (agent route, wizard API, wizard DB tables) stays mounted unconditionally — the toggle is purely a render gate.

**Tech Stack:** React 18, React Router v7 (file-system routes), Vite, Vitest + React Testing Library, better-sqlite3, lucide-react icons, Tailwind CSS.

**Working directory for all paths:** `/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI`

---

## File Structure

**New files:**
- `web/src/app/api/settings/wizard-mode/route.js` — GET/PUT route handlers.
- `web/src/app/api/__tests__/settings-wizard-mode.test.js` — route handler tests.
- `web/src/app/hooks/useWizardMode.js` — React hook for the toggle state.
- `web/src/app/hooks/__tests__/useWizardMode.test.js` — hook tests.
- `web/src/components/dashboard/__tests__/DashboardSplitHero.test.jsx` — component tests for the gated render.

**Modified files:**
- `web/src/components/dashboard/DashboardSplitHero.jsx` — accept `wizardEnabled` prop, conditionally render.
- `web/src/app/dashboard/page.jsx` — call `useWizardMode`, pass `wizardEnabled` to `DashboardSplitHero`.
- `web/src/app/dashboard/settings/page.jsx` — add Wizard Mode card with toggle.

**Untouched (intentional):** All wizard component/hook/lib/api files, `agent/main.py` wizard router, `db.ts` schema, `agentSchema.js`. The toggle is a render gate, not a feature deletion.

---

## Task 1: Add settings constant and verify db helpers

**Files:**
- Modify: `web/src/lib/db.ts` (no functional change — just confirm `getSetting` / `setSetting` exist around line 482)

- [ ] **Step 1: Confirm `getSetting` and `setSetting` exist**

Run:
```bash
grep -n "export function getSetting\|export function setSetting" web/src/lib/db.ts
```

Expected output:
```
485:export function getSetting(key: string): string | null {
492:export function setSetting(key: string, value: string) {
```

- [ ] **Step 2: Confirm `app_settings` table is created in the schema**

Run:
```bash
grep -n "CREATE TABLE IF NOT EXISTS app_settings" web/src/lib/db.ts
```

Expected output: a single match around line 99.

If both checks pass, no code change is needed in this task. Skip to commit.

- [ ] **Step 3: Commit (no-op marker for plan history)**

If git status shows no changes, skip the commit and proceed to Task 2. Otherwise:

```bash
git add web/src/lib/db.ts
git commit -m "chore(plan): verify app_settings helpers for wizard-mode toggle"
```

---

## Task 2: Write the failing GET test for the wizard-mode API

**Files:**
- Create: `web/src/app/api/__tests__/settings-wizard-mode.test.js`

- [ ] **Step 1: Create the test file with the failing GET test**

```javascript
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:
```bash
cd web && npx vitest run src/app/api/__tests__/settings-wizard-mode.test.js
```

Expected: FAIL with module-not-found error for `../settings/wizard-mode/route.js`.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/__tests__/settings-wizard-mode.test.js
git commit -m "test(settings): add failing GET test for wizard-mode route"
```

---

## Task 3: Implement the GET handler

**Files:**
- Create: `web/src/app/api/settings/wizard-mode/route.js`

- [ ] **Step 1: Create the route file with a minimal GET handler**

```javascript
// web/src/app/api/settings/wizard-mode/route.js
/**
 * Wizard Mode Settings API
 *
 * GET: returns { enabled: boolean }. False if the row is absent.
 * PUT: body { enabled: boolean }; upserts the row; returns { enabled: boolean }.
 */

import { getSetting, setSetting } from "@/lib/db";

const KEY = "wizard_mode_enabled";

export async function GET() {
  try {
    const raw = getSetting(KEY);
    const enabled = raw === "true";
    return Response.json({ enabled });
  } catch (error) {
    console.error("[Wizard Mode] GET failed:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    if (typeof body?.enabled !== "boolean") {
      return Response.json(
        { error: "enabled must be boolean" },
        { status: 400 }
      );
    }
    setSetting(KEY, body.enabled ? "true" : "false");
    return Response.json({ enabled: body.enabled });
  } catch (error) {
    console.error("[Wizard Mode] PUT failed:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Run the GET test and confirm it passes**

Run:
```bash
cd web && npx vitest run src/app/api/__tests__/settings-wizard-mode.test.js -t "GET"
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/settings/wizard-mode/route.js
git commit -m "feat(settings): add wizard-mode GET/PUT route"
```

---

## Task 4: Add the remaining route tests (PUT + GET-after-PUT + validation)

**Files:**
- Modify: `web/src/app/api/__tests__/settings-wizard-mode.test.js`

- [ ] **Step 1: Append the remaining `describe` blocks**

Append below the existing `describe("GET /api/settings/wizard-mode", ...)` block:

```javascript
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
```

- [ ] **Step 2: Run all wizard-mode tests**

Run:
```bash
cd web && npx vitest run src/app/api/__tests__/settings-wizard-mode.test.js
```

Expected: 5 passing tests, 0 failing.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/__tests__/settings-wizard-mode.test.js
git commit -m "test(settings): cover PUT and validation for wizard-mode route"
```

---

## Task 5: Write the failing test for `useWizardMode` hook

**Files:**
- Create: `web/src/app/hooks/__tests__/useWizardMode.test.js`

- [ ] **Step 1: Create the test file**

```javascript
// web/src/app/hooks/__tests__/useWizardMode.test.js
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import { useWizardMode } from "../useWizardMode";

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetchOnce(payload, { ok = true, status = 200 } = {}) {
  global.fetch.mockResolvedValueOnce({
    ok,
    status,
    json: async () => payload,
  });
}

describe("useWizardMode", () => {
  it("starts in loading state with enabled=false", () => {
    mockFetchOnce({ enabled: true }); // resolves later
    const { result } = renderHook(() => useWizardMode());
    expect(result.current.loading).toBe(true);
    expect(result.current.enabled).toBe(false);
  });

  it("populates enabled from the GET response", async () => {
    mockFetchOnce({ enabled: true });
    const { result } = renderHook(() => useWizardMode());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith("/api/settings/wizard-mode");
  });

  it("falls back to enabled=false on GET error", async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const { result } = renderHook(() => useWizardMode());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(false);
  });

  it("setEnabled(true) optimistically updates and persists", async () => {
    mockFetchOnce({ enabled: false }); // initial GET
    mockFetchOnce({ enabled: true });  // PUT response
    const { result } = renderHook(() => useWizardMode());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(result.current.enabled).toBe(true);
    expect(global.fetch).toHaveBeenLastCalledWith("/api/settings/wizard-mode", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
  });

  it("reverts optimistic update when PUT fails", async () => {
    mockFetchOnce({ enabled: false }); // initial GET
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: "boom" }) });
    const { result } = renderHook(() => useWizardMode());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.setEnabled(true)).rejects.toThrow();
    });

    expect(result.current.enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:
```bash
cd web && npx vitest run src/app/hooks/__tests__/useWizardMode.test.js
```

Expected: FAIL with module-not-found for `../useWizardMode`.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/hooks/__tests__/useWizardMode.test.js
git commit -m "test(hooks): add failing tests for useWizardMode"
```

---

## Task 6: Implement `useWizardMode` hook

**Files:**
- Create: `web/src/app/hooks/useWizardMode.js`

- [ ] **Step 1: Create the hook**

```javascript
// web/src/app/hooks/useWizardMode.js
"use client";

import { useCallback, useEffect, useState } from "react";

const ENDPOINT = "/api/settings/wizard-mode";

export function useWizardMode() {
  const [enabled, setEnabledState] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(ENDPOINT);
        if (!res.ok) throw new Error("GET failed: " + res.status);
        const data = await res.json();
        if (!cancelled) setEnabledState(Boolean(data?.enabled));
      } catch (err) {
        console.warn("[useWizardMode] falling back to disabled:", err.message);
        if (!cancelled) setEnabledState(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setEnabled = useCallback(async (next) => {
    const previous = enabled;
    setEnabledState(next);
    try {
      const res = await fetch(ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error("PUT failed: " + res.status);
      const data = await res.json();
      setEnabledState(Boolean(data?.enabled));
    } catch (err) {
      setEnabledState(previous);
      throw err;
    }
  }, [enabled]);

  return { enabled, loading, setEnabled };
}
```

- [ ] **Step 2: Run the hook tests and confirm they pass**

Run:
```bash
cd web && npx vitest run src/app/hooks/__tests__/useWizardMode.test.js
```

Expected: 5 passing tests.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/hooks/useWizardMode.js
git commit -m "feat(hooks): add useWizardMode for wizard-mode toggle state"
```

---

## Task 7: Write the failing test for `DashboardSplitHero` gated render

**Files:**
- Create: `web/src/components/dashboard/__tests__/DashboardSplitHero.test.jsx`

- [ ] **Step 1: Create the test file**

```jsx
// web/src/components/dashboard/__tests__/DashboardSplitHero.test.jsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../WizardCallCard", () => ({
  default: () => <div data-testid="wizard-call-card">wizard</div>,
}));
vi.mock("../TemplateCarouselCard", () => ({
  default: ({ templates }) => (
    <div data-testid="template-carousel">{templates.length} templates</div>
  ),
}));

import DashboardSplitHero from "../DashboardSplitHero";

describe("DashboardSplitHero", () => {
  const templates = [{ id: "t1" }, { id: "t2" }];

  it("renders only TemplateCarouselCard when wizardEnabled is false", () => {
    render(<DashboardSplitHero templates={templates} wizardEnabled={false} />);
    expect(screen.queryByTestId("wizard-call-card")).toBeNull();
    expect(screen.getByTestId("template-carousel")).toBeInTheDocument();
  });

  it("renders both cards when wizardEnabled is true", () => {
    render(<DashboardSplitHero templates={templates} wizardEnabled={true} />);
    expect(screen.getByTestId("wizard-call-card")).toBeInTheDocument();
    expect(screen.getByTestId("template-carousel")).toBeInTheDocument();
  });

  it("defaults to wizardEnabled=false when prop is omitted", () => {
    render(<DashboardSplitHero templates={templates} />);
    expect(screen.queryByTestId("wizard-call-card")).toBeNull();
    expect(screen.getByTestId("template-carousel")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:
```bash
cd web && npx vitest run src/components/dashboard/__tests__/DashboardSplitHero.test.jsx
```

Expected: FAIL — the first test fails because `WizardCallCard` is currently rendered unconditionally.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/dashboard/__tests__/DashboardSplitHero.test.jsx
git commit -m "test(dashboard): add failing tests for DashboardSplitHero wizard gating"
```

---

## Task 8: Make `DashboardSplitHero` honor `wizardEnabled`

**Files:**
- Modify: `web/src/components/dashboard/DashboardSplitHero.jsx`

- [ ] **Step 1: Replace the file with the gated implementation**

Replace the entire file with:

```jsx
"use client";

import WizardCallCard from "./WizardCallCard";
import TemplateCarouselCard from "./TemplateCarouselCard";

/**
 * DashboardSplitHero — two-column hero on the dashboard home.
 * When `wizardEnabled` is true: WizardCallCard (left) + TemplateCarouselCard (right).
 * When `wizardEnabled` is false: TemplateCarouselCard only, full-width.
 * Stacks vertically below `lg:`.
 */
export default function DashboardSplitHero({ templates = [], wizardEnabled = false }) {
  if (!wizardEnabled) {
    return (
      <section aria-label="Create an agent">
        <TemplateCarouselCard templates={templates} />
      </section>
    );
  }

  return (
    <section
      aria-label="Create an agent"
      className="grid grid-cols-1 lg:grid-cols-2 gap-4"
    >
      <WizardCallCard />
      <TemplateCarouselCard templates={templates} />
    </section>
  );
}
```

- [ ] **Step 2: Run the component tests and confirm they pass**

Run:
```bash
cd web && npx vitest run src/components/dashboard/__tests__/DashboardSplitHero.test.jsx
```

Expected: 3 passing tests.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/dashboard/DashboardSplitHero.jsx
git commit -m "feat(dashboard): gate wizard column behind wizardEnabled prop"
```

---

## Task 9: Wire `useWizardMode` into the dashboard page

**Files:**
- Modify: `web/src/app/dashboard/page.jsx` (lines around 13 and 112/208)

- [ ] **Step 1: Add the hook import**

After line 13 (`import DashboardSplitHero from "@/components/dashboard/DashboardSplitHero";`), add:

```jsx
import { useWizardMode } from "@/app/hooks/useWizardMode";
```

- [ ] **Step 2: Call the hook inside the dashboard component**

Find the function body of the default export (the dashboard page component). Near the top of the function (alongside other `useState`/`useEffect` calls), add:

```jsx
const { enabled: wizardEnabled } = useWizardMode();
```

- [ ] **Step 3: Pass `wizardEnabled` into both `DashboardSplitHero` usages**

Replace both occurrences of `<DashboardSplitHero templates={TEMPLATES} />` (currently at lines 112 and 208) with:

```jsx
<DashboardSplitHero templates={TEMPLATES} wizardEnabled={wizardEnabled} />
```

- [ ] **Step 4: Verify no broken imports or refs**

Run:
```bash
cd web && npx tsc --noEmit
```

Expected: no new errors introduced by this change. (Pre-existing errors elsewhere are unrelated and acceptable.)

- [ ] **Step 5: Commit**

```bash
git add web/src/app/dashboard/page.jsx
git commit -m "feat(dashboard): pass wizardEnabled from useWizardMode to split hero"
```

---

## Task 10: Add the Wizard Mode card to the Settings page

**Files:**
- Modify: `web/src/app/dashboard/settings/page.jsx`

- [ ] **Step 1: Import the hook and an icon**

In the lucide-react import block (lines 4–19), add `Wand2` to the imported icons:

```jsx
import {
  Globe,
  RefreshCw,
  Check,
  AlertTriangle,
  ExternalLink,
  Save,
  Loader2,
  Shield,
  Server,
  Phone,
  Trash2,
  Wrench,
  Eye,
  EyeOff,
  Wand2,
} from "lucide-react";
```

After line 19 add:

```jsx
import { useWizardMode } from "@/app/hooks/useWizardMode";
```

- [ ] **Step 2: Call the hook inside `SettingsPage`**

Inside `SettingsPage`, after the existing `useState` declarations near the top of the component body (right after `const [phoneNumbers, setPhoneNumbers] = useState([]);` around line 41), add:

```jsx
const {
  enabled: wizardEnabled,
  loading: wizardLoading,
  setEnabled: setWizardEnabled,
} = useWizardMode();
const [wizardSaveError, setWizardSaveError] = useState(null);

const handleWizardToggle = async () => {
  setWizardSaveError(null);
  try {
    await setWizardEnabled(!wizardEnabled);
  } catch (err) {
    setWizardSaveError(err.message || "Failed to save Wizard Mode");
  }
};
```

- [ ] **Step 3: Add the Wizard Mode section right above the Domain Configuration section**

Find the comment `{/* Domain Configuration */}` (around line 349). Immediately before it, insert:

```jsx
{/* Wizard Mode */}
<div className="bg-[#0A0A0A] border border-[#1F1F1F] p-6">
  <h2 className="text-lg lg:text-xl font-medium text-[#FAFAFA] tracking-tight mb-1 flex items-center space-x-2">
    <Wand2 size={20} />
    <span>Wizard Mode</span>
  </h2>
  <p className="text-sm text-[#A3A3A3] mb-4">
    Show the guided wizard panel on the dashboard. Off by default.
  </p>
  <div className="flex items-center justify-between">
    <span className="text-sm text-[#FAFAFA]">
      {wizardLoading
        ? "Loading…"
        : wizardEnabled
          ? "Wizard is visible on the dashboard."
          : "Wizard is hidden on the dashboard."}
    </span>
    <button
      type="button"
      role="switch"
      aria-checked={wizardEnabled}
      aria-label="Toggle Wizard Mode"
      disabled={wizardLoading}
      onClick={handleWizardToggle}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        wizardEnabled ? "bg-[#FAFAFA]" : "bg-[#1F1F1F]"
      } ${wizardLoading ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
          wizardEnabled
            ? "translate-x-6 bg-[#0A0A0A]"
            : "translate-x-1 bg-[#FAFAFA]"
        }`}
      />
    </button>
  </div>
  {wizardSaveError && (
    <p className="mt-3 text-sm text-red-400">{wizardSaveError}</p>
  )}
</div>
```

- [ ] **Step 4: Run typecheck**

Run:
```bash
cd web && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 5: Run all existing tests to confirm no regressions**

Run:
```bash
cd web && npx vitest run
```

Expected: all tests pass (the suite includes the new wizard-mode, useWizardMode, and DashboardSplitHero tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/app/dashboard/settings/page.jsx
git commit -m "feat(settings): add Wizard Mode toggle card"
```

---

## Task 11: Manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Reset local DB to simulate a fresh install**

```bash
rm -f web/data/sally.db web/data/sally-wal.db web/data/sally-shm.db || true
```

(Adjust filenames if the local DB lives elsewhere — check `.data/` and `web/data/` directories.)

- [ ] **Step 2: Start the dev server**

```bash
cd web && npm run dev
```

Expected: server starts on the configured port without errors.

- [ ] **Step 3: Verify default-OFF state**

In a browser, navigate to the dashboard. Expected: `TemplateCarouselCard` renders full-width; no wizard call card is visible.

- [ ] **Step 4: Toggle ON via Settings**

Navigate to `/dashboard/settings`. Find the "Wizard Mode" card, click the toggle. Expected: switch flips to ON, no error shown.

- [ ] **Step 5: Verify dashboard now shows the wizard**

Navigate back to `/dashboard`. Expected: two-column hero with `WizardCallCard` on the left and `TemplateCarouselCard` on the right.

- [ ] **Step 6: Toggle OFF and verify**

Back to Settings, flip the toggle off, navigate to dashboard. Expected: single-column `TemplateCarouselCard` again.

- [ ] **Step 7: Confirm persistence across reload**

Reload the dashboard page. Expected: the last-saved state is preserved.

- [ ] **Step 8: Stop the dev server**

Ctrl-C the dev server.

- [ ] **Step 9: No commit needed (verification only).**

---

## Task 12: Archive the standalone HireWire repo

**Files:**
- Modify (in the `HireWire` repo, not `HireWire-AI`): `README.md`

This task targets the *other* repo at `/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire`.

- [ ] **Step 1: Add the deprecation banner at the top of HireWire's README**

In `/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire/README.md`, prepend:

```markdown
> **Archived.** This project has been merged into [HireWire-AI](https://github.com/jongray00/HireWire-AI).
> Toggle "Wizard Mode" off in Settings for the original HireWire experience.

```

(Keep one blank line between the banner and the existing content.)

- [ ] **Step 2: Commit the banner**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire" \
  && git add README.md \
  && git commit -m "docs: archive notice — superseded by HireWire-AI"
```

- [ ] **Step 3: Push the banner commit**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire" \
  && git push origin main
```

Expected: push succeeds.

- [ ] **Step 4: Archive the repo on GitHub**

Run:
```bash
gh repo archive jongray00/HireWire --yes
```

Expected: command completes silently. The repo's GitHub page now shows the "Archived" banner; `gh repo view jongray00/HireWire --json isArchived -q .isArchived` returns `true`.

---

## Self-Review Checklist (run before handing off)

- [ ] Spec coverage: every section in the spec maps to a task above (data layer → Task 1; API → Tasks 2–4; client hook → Tasks 5–6; dashboard wiring → Tasks 7–9; Settings UI → Task 10; manual smoke → Task 11; repo archival → Task 12).
- [ ] No placeholders: all code blocks contain real code; no `TODO`, `TBD`, "similar to", or vague "add validation" steps.
- [ ] Type/name consistency: `wizard_mode_enabled` (DB key), `wizardEnabled` (component prop), `useWizardMode` (hook), `/api/settings/wizard-mode` (route) — names are consistent across tasks.
- [ ] No mocking the database in route tests (per repo policy, route tests use a real temp SQLite DB via `DATABASE_PATH` stub — matches existing `post-prompt.test.js` pattern).
- [ ] `WIZARD_ENABLED` env var is *not* introduced anywhere — toggle is runtime-only via the settings table.
