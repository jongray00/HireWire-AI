# Employees Page Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Employees page in line with the rebranded HireWire.AI surfaces — migrate the palette, replace the Transfer From / Transfer To select+toggle with a true combobox, remove the `end_call` SWAIG end-to-end, switch all template defaults to empty `enabled_functions`, and rename user-visible "employee" → "agent" without touching routes, filenames, or the DB schema.

**Architecture:** All changes are surgical. The page and its supporting `PhoneNumberPicker` component get repalette'd to the literal-hex convention used in `web/src/app/login/page.jsx`. `PhoneNumberPicker` gains a `variant` prop that decouples rendering (select vs combobox) from data source. `end_call` is deleted from both the React option list and the Python SWAIG handler in `agent/main.py`; existing DB rows are sanitized at the read path so no migration is needed. Template defaults flip to `[]`. Rename is JSX-text-only — routes, files, DB columns, and SWML callback paths stay.

**Tech Stack:** React Router 7 + Vite + Tailwind (literal hex values matching CSS vars in `global.css`) on the frontend; Vitest for tests; Python FastAPI + signalwire-agents SDK on the backend; better-sqlite3 for the local store.

**Spec:** `docs/superpowers/specs/2026-05-05-employees-page-cleanup-design.md`.

**Working directory:** Project root is `/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI`. All relative paths in this plan are relative to that root unless prefixed with `web/` or `agent/`. All shell commands run from the project root unless noted.

**Pre-flight check (run once before Task 1):**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/web" && npm test -- --run 2>&1 | tail -5
```

Expected: `Test Files  1 failed | 17 passed (18)` / `Tests 3 failed | 155 passed (158)`. The 3 WizardBanner failures are pre-existing and out of scope. Any other failures are an environment problem — fix that before starting.

---

## File Structure

**Modified files (no new source files):**

| File | Change |
|---|---|
| `web/src/components/dashboard/PhoneNumberPicker.jsx` | Add `variant` prop; theme migration |
| `web/src/app/dashboard/employees/page.jsx` | Theme migration; remove `end_call` option; default `enabled_functions: []`; pass `variant="combobox"` to phone fields; UI text rename |
| `web/src/lib/templates.js` | Empty `enabled_functions` arrays in all 6 templates |
| `web/src/lib/db.ts` | Filter `end_call` from `enabled_functions` in `employeeRowToJson` |
| `agent/main.py` | Delete `end_call` SWAIG handler; remove from default arrays + prompt |
| `web/src/components/dashboard/WizardBanner.jsx` | UI text rename |
| `web/src/components/dashboard/WizardCreationCanvas.jsx` | UI text rename |
| `web/src/components/dashboard/DashboardSplitHero.jsx` | UI text rename |
| `web/src/components/dashboard/TemplateCarouselCard.jsx` | UI text rename |
| `web/src/app/dashboard/layout.jsx` | UI text rename |
| `web/src/app/dashboard/page.jsx` | UI text rename |
| `web/src/app/dashboard/templates/page.jsx` | UI text rename |

**New test files:**

| File | Purpose |
|---|---|
| `web/src/components/dashboard/__tests__/PhoneNumberPicker.test.jsx` | Cover `variant="combobox"` rendering and value passthrough |
| `web/src/lib/__tests__/db.endCallFilter.test.js` | Cover `employeeRowToJson` stripping `"end_call"` from `enabled_functions` |

---

## Task 1 — `PhoneNumberPicker` gains a `variant` prop

**Files:**
- Modify: `web/src/components/dashboard/PhoneNumberPicker.jsx`
- Test: `web/src/components/dashboard/__tests__/PhoneNumberPicker.test.jsx` (new)

**Context:** The component today renders combobox UI only when `source === "campaign-registry"`. Add `variant` to decouple rendering from data source. `variant="select"` is the default (today's behavior with `source="all"`); `variant="combobox"` opts into the existing `ComboboxField` UI but keeps the `/api/signalwire/phone-numbers` data source.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/dashboard/__tests__/PhoneNumberPicker.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PhoneNumberPicker from "../PhoneNumberPicker";

const credentials = {
  spaceUrl: "demo.signalwire.com",
  projectId: "p",
  apiToken: "t",
};

beforeEach(() => {
  global.fetch = vi.fn(() =>
    Promise.resolve({
      json: () =>
        Promise.resolve({
          success: true,
          phoneNumbers: [
            { sid: "PN1", phoneNumber: "+15551234567", friendlyName: "Sales line" },
          ],
        }),
    })
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PhoneNumberPicker", () => {
  it("renders the combobox variant with text input + caret button", async () => {
    render(
      <PhoneNumberPicker
        value=""
        onChange={() => {}}
        label="Transfer To Number"
        credentials={credentials}
        variant="combobox"
      />
    );
    expect(screen.getByLabelText(/transfer to number/i)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /open phone number list/i })).toBeEnabled()
    );
  });

  it("combobox popover lists numbers with friendly names", async () => {
    render(
      <PhoneNumberPicker
        value=""
        onChange={() => {}}
        label="Transfer To Number"
        credentials={credentials}
        variant="combobox"
      />
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /open phone number list/i })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole("button", { name: /open phone number list/i }));
    expect(screen.getByText(/\+1 \(555\) 123-4567/)).toBeInTheDocument();
    expect(screen.getByText(/Sales line/)).toBeInTheDocument();
  });

  it("combobox passes typed values through to onChange", () => {
    const onChange = vi.fn();
    render(
      <PhoneNumberPicker
        value=""
        onChange={onChange}
        label="Transfer From"
        credentials={credentials}
        variant="combobox"
      />
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "+15559998888" } });
    expect(onChange).toHaveBeenCalledWith("+15559998888");
  });

  it("defaults to select variant when no variant prop is provided", async () => {
    render(
      <PhoneNumberPicker
        value=""
        onChange={() => {}}
        label="Phone Number"
        credentials={credentials}
      />
    );
    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/web" && npx vitest run src/components/dashboard/__tests__/PhoneNumberPicker.test.jsx
```

Expected: FAIL — at minimum the "open phone number list" accessible name and the typed-value passthrough won't match because the combobox path is gated behind `source="campaign-registry"`.

- [ ] **Step 3: Add the `variant` prop and route through `ComboboxField`**

Edit `web/src/components/dashboard/PhoneNumberPicker.jsx`:

1. Update the JSDoc and signature (lines 1-25) to add `variant`:

```jsx
/**
 * @param {Object} props
 * @param {string} props.value - currently selected phone number (E.164 or empty)
 * @param {(val: string) => void} props.onChange
 * @param {string} props.label
 * @param {string} [props.placeholder]
 * @param {{ spaceUrl: string, projectId: string, apiToken: string }} props.credentials
 * @param {"all" | "campaign-registry"} [props.source]
 * @param {"select" | "combobox"} [props.variant]
 *   "select" (default for `source="all"`) — flat dropdown with a "Custom number…" toggle.
 *   "combobox" — single text input + caret button that opens a popover of pickable numbers.
 *   `source="campaign-registry"` always uses the combobox renderer regardless of this prop.
 */
export default function PhoneNumberPicker({
  value,
  onChange,
  label,
  placeholder,
  credentials,
  source = 'all',
  variant = 'select',
}) {
```

2. Replace the `if (source === 'campaign-registry')` early return (lines 70-82) with a unified combobox branch:

```jsx
const useCombobox = source === 'campaign-registry' || variant === 'combobox';

if (useCombobox) {
  return (
    <ComboboxField
      value={value || ''}
      onChange={onChange}
      label={label}
      placeholder={placeholder || '+15551234567'}
      loading={loading}
      options={phoneNumbers}
      formatNumber={formatNumber}
    />
  );
}
```

3. In `ComboboxField` (around line 178), add an accessible name to the caret button. Find the caret `<button>` tag and add `aria-label="Open phone number list"`. The exact line lives in the `ComboboxField` JSX — find the caret button with the chevron / caret icon and add `aria-label` to it.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/web" && npx vitest run src/components/dashboard/__tests__/PhoneNumberPicker.test.jsx
```

Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI"
git add web/src/components/dashboard/PhoneNumberPicker.jsx web/src/components/dashboard/__tests__/PhoneNumberPicker.test.jsx
git commit -m "feat(phone-number-picker): add variant prop for combobox rendering"
```

---

## Task 2 — Wire Transfer To / Transfer From to the combobox variant

**Files:**
- Modify: `web/src/app/dashboard/employees/page.jsx` (lines 1583-1597)

- [ ] **Step 1: Edit the two phone-number pickers**

Replace lines 1583-1597 of `web/src/app/dashboard/employees/page.jsx` with:

```jsx
                      <PhoneNumberPicker
                        value={formData.transfer_number}
                        onChange={(val) => setFormData(prev => ({ ...prev, transfer_number: val }))}
                        label="Transfer To Number"
                        placeholder="+15551234567"
                        credentials={credentials}
                        variant="combobox"
                      />
                      <div style={{ marginTop: '0.5rem' }}>
                        <PhoneNumberPicker
                          value={formData.transfer_from}
                          onChange={(val) => setFormData(prev => ({ ...prev, transfer_from: val }))}
                          label="Transfer From (Caller ID override, optional)"
                          placeholder="+15551234567"
                          credentials={credentials}
                          variant="combobox"
                        />
                      </div>
```

- [ ] **Step 2: Verify Vitest still green**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/web" && npm test -- --run 2>&1 | tail -5
```

Expected: same baseline (155/158 passing). The new `PhoneNumberPicker` tests are still green.

- [ ] **Step 3: Commit**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI"
git add web/src/app/dashboard/employees/page.jsx
git commit -m "feat(employees): use combobox variant for Transfer To/From phone fields"
```

---

## Task 3 — Strip `"end_call"` from DB read path (TDD)

**Files:**
- Modify: `web/src/lib/db.ts` (around line 537, in `employeeRowToJson`)
- Test: `web/src/lib/__tests__/db.endCallFilter.test.js` (new)

**Context:** Existing rows in the DB may have `"end_call"` baked into their `enabled_functions` JSON. After the SWAIG is removed, the UI and SWML generator must never see `"end_call"`. Filter at the row-to-JSON boundary so the rest of the codebase stays clean.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/__tests__/db.endCallFilter.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/web" && npx vitest run src/lib/__tests__/db.endCallFilter.test.js
```

Expected: FAIL — first assertion gets `["transfer_to_human", "end_call", "send_summary_sms"]` (filter not yet applied).

- [ ] **Step 3: Add the filter in `employeeRowToJson`**

In `web/src/lib/db.ts`, find line 537 (`enabled_functions: safeJsonParse(row.enabled_functions, []),`) and replace with:

```ts
    enabled_functions: safeJsonParse(row.enabled_functions, []).filter(
      (fn: string) => fn !== 'end_call'
    ),
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/web" && npx vitest run src/lib/__tests__/db.endCallFilter.test.js
```

Expected: 3 PASS.

- [ ] **Step 5: Run the full suite to check for regressions**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/web" && npm test -- --run 2>&1 | tail -5
```

Expected: still 155/158 plus the 7 new passes from Tasks 1 + 3 (so total ~162/165, with the same 3 WizardBanner failures).

- [ ] **Step 6: Commit**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI"
git add web/src/lib/db.ts web/src/lib/__tests__/db.endCallFilter.test.js
git commit -m "feat(db): strip end_call from enabled_functions at read time"
```

---

## Task 4 — Remove `end_call` from frontend FUNCTIONS list and defaults

**Files:**
- Modify: `web/src/app/dashboard/employees/page.jsx` (lines 236, 1192)

- [ ] **Step 1: Remove the FUNCTIONS entry**

In `web/src/app/dashboard/employees/page.jsx`, find line 236:

```js
  { value: 'end_call', label: 'End Call', description: 'Politely end the call with a hangup' },
```

Delete that line entirely.

- [ ] **Step 2: Update the default `enabled_functions` fallback**

Find line 1192:

```js
    enabled_functions: source.enabled_functions || ["transfer_to_human", "send_summary_sms", "end_call"],
```

Replace with:

```js
    enabled_functions: source.enabled_functions || [],
```

- [ ] **Step 3: Verify no other `end_call` references remain in this file**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && grep -n "end_call" web/src/app/dashboard/employees/page.jsx
```

Expected: no output.

- [ ] **Step 4: Run Vitest**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/web" && npm test -- --run 2>&1 | tail -5
```

Expected: same passing total as after Task 3.

- [ ] **Step 5: Commit**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI"
git add web/src/app/dashboard/employees/page.jsx
git commit -m "feat(employees): remove end_call from function options and defaults"
```

---

## Task 5 — Empty all template `enabled_functions` and remove `end_call`

**Files:**
- Modify: `web/src/lib/templates.js` (lines 75, 139, 205, 269, 335, 401)

- [ ] **Step 1: Verify the current arrays**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && grep -n "enabled_functions:" web/src/lib/templates.js
```

Expected: 6 hits at the line numbers above.

- [ ] **Step 2: Replace all six arrays with `[]`**

For each of lines 75, 139, 205, 269, 335, 401 in `web/src/lib/templates.js`, replace the line with:

```js
      enabled_functions: [],
```

(The leading indentation is 6 spaces in this file. Match the existing indentation exactly.)

- [ ] **Step 3: Verify no `end_call` remains in templates**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && grep -n "end_call" web/src/lib/templates.js
```

Expected: no output.

- [ ] **Step 4: Run the existing templates test**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/web" && npx vitest run src/lib/__tests__/templates.test.js
```

Expected: PASS (the existing tests don't assert specific function defaults).

- [ ] **Step 5: Commit**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI"
git add web/src/lib/templates.js
git commit -m "feat(templates): empty enabled_functions; users opt in"
```

---

## Task 6 — Remove `end_call` from the Python agent

**Files:**
- Modify: `agent/main.py` (lines 647-668, 1187, 1333, 1424, 1626)

**Context:** Delete the SWAIG handler, prune the prompt copy, and clear it out of every default `enabled_functions` array. Backend defaults flip to `[]` to match the spec's "users opt in" rule.

- [ ] **Step 1: Delete the `end_call` SWAIG handler**

Delete lines 647-668 in `agent/main.py`. To find them:

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && grep -n 'name="end_call"\|def end_call' agent/main.py
```

Expected before edit: `647:        name="end_call",` and `659:    def end_call(self, args, raw_data):`. Delete from the start of the `@AgentBase.tool(...)` (or equivalent) decorator block above line 647 through the closing `return result` of `def end_call(...)` (line 668 inclusive). Read the file from line 640 to line 670 first to confirm the exact decorator boundary before deleting.

- [ ] **Step 2: Remove from the default function list at line 1187**

Find the line:

```python
        functions = args.get("functions", ["transfer_to_human", "end_call"])
```

Replace with:

```python
        functions = args.get("functions", [])
```

- [ ] **Step 3: Remove the prompt line at line 1333**

Find and delete the line:

```python
            "- end_call: Politely end the call when the conversation is complete\n"
```

(Just remove that one line; the surrounding string concatenation stays intact.)

- [ ] **Step 4: Empty backend defaults at lines 1424 and 1626**

Line 1424:

```python
            "enabled_functions": data.get("enabled_functions", ["transfer_to_human", "send_summary_sms", "end_call"]),
```

Replace with:

```python
            "enabled_functions": data.get("enabled_functions", []),
```

Line 1626:

```python
                "enabled_functions": ["transfer_to_human", "send_summary_sms", "end_call"],
```

Replace with:

```python
                "enabled_functions": [],
```

- [ ] **Step 5: Verify no `end_call` references remain**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && grep -n "end_call" agent/main.py
```

Expected: no output.

- [ ] **Step 6: Smoke-start the agent to confirm it boots**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/agent" && python3 main.py > /tmp/agent-smoke.log 2>&1 &
echo $! > /tmp/agent.pid
sleep 4
grep -E "Application startup complete|ERROR|Traceback" /tmp/agent-smoke.log | head -5
kill $(cat /tmp/agent.pid)
```

Expected: `Application startup complete.` line is present; no `Traceback` or `ERROR` lines.

- [ ] **Step 7: Commit**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI"
git add agent/main.py
git commit -m "feat(agent): remove end_call SWAIG; empty enabled_functions defaults"
```

---

## Task 7 — Theme migration: `PhoneNumberPicker.jsx`

**Files:**
- Modify: `web/src/components/dashboard/PhoneNumberPicker.jsx`

**Context:** Replace the gray/blue Tailwind defaults with literal hex values matching the CSS vars in `web/src/app/global.css`. Same convention as `web/src/app/login/page.jsx`. There are two fragment strings to update (`fieldClasses` at line 62, `inputClasses` at line 162) and the `<label>` className at lines 90 + 175.

- [ ] **Step 1: Replace `fieldClasses` (line 62)**

Replace:

```js
  const fieldClasses =
    "w-full px-4 py-2 text-sm rounded-lg border " +
    "border-gray-300 dark:border-gray-600 " +
    "bg-white dark:bg-gray-700 " +
    "text-gray-900 dark:text-white " +
    "placeholder-gray-400 dark:placeholder-gray-500 " +
    "focus:ring-2 focus:ring-blue-500 focus:border-transparent";
```

With:

```js
  const fieldClasses =
    "w-full px-4 py-3 text-sm bg-[#0A0A0A] border border-[#1F1F1F] " +
    "text-[#FAFAFA] placeholder:text-[#737373] " +
    "focus:outline-none focus:ring-2 focus:ring-[#2553F4] focus:border-[#2553F4] transition-colors";
```

- [ ] **Step 2: Replace `inputClasses` (line 162)**

Replace:

```js
  const inputClasses =
    "w-full pl-4 pr-10 py-2 text-sm rounded-lg border " +
    "border-gray-300 dark:border-gray-600 " +
    "bg-white dark:bg-gray-700 " +
    "text-gray-900 dark:text-white " +
    "placeholder-gray-400 dark:placeholder-gray-500 " +
    "focus:ring-2 focus:ring-blue-500 focus:border-transparent";
```

With:

```js
  const inputClasses =
    "w-full pl-4 pr-10 py-3 text-sm bg-[#0A0A0A] border border-[#1F1F1F] " +
    "text-[#FAFAFA] placeholder:text-[#737373] " +
    "focus:outline-none focus:ring-2 focus:ring-[#2553F4] focus:border-[#2553F4] transition-colors";
```

- [ ] **Step 3: Update both `<label>` className strings (lines 90 and 175)**

Replace both occurrences of:

```jsx
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
```

With:

```jsx
      <label className="block text-sm font-medium text-[#A3A3A3] mb-2">
```

- [ ] **Step 4: Update the loading paragraph (line 95)**

Replace:

```jsx
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading phone numbers...</p>
```

With:

```jsx
        <p className="text-sm text-[#737373]">Loading phone numbers...</p>
```

- [ ] **Step 5: Confirm no gray/blue Tailwind defaults remain**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && grep -nE "(bg|border|text|focus:ring|placeholder)-(gray|blue|slate)-[0-9]+" web/src/components/dashboard/PhoneNumberPicker.jsx
```

Expected: no output.

- [ ] **Step 6: Run Vitest**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/web" && npm test -- --run 2>&1 | tail -5
```

Expected: green (same baseline + 7 new tests from earlier tasks).

- [ ] **Step 7: Commit**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI"
git add web/src/components/dashboard/PhoneNumberPicker.jsx
git commit -m "style(phone-number-picker): migrate to HireWire.AI hex tokens"
```

---

## Task 8 — Theme migration: `dashboard/employees/page.jsx`

**Files:**
- Modify: `web/src/app/dashboard/employees/page.jsx`

**Context:** Apply the same token map as Task 7 across all 37 raw utility instances on the page. This is a mechanical substitution using the table below — but the implementer should read each match and confirm it's a color/border utility (not a layout-only class with `gray` in its name).

**Token map** (from spec):

| Old Tailwind | New literal |
|---|---|
| `bg-white` / `bg-gray-50` / `bg-gray-100` | `bg-[#0A0A0A]` |
| `bg-gray-200` / `bg-gray-300` | `bg-[#111111]` |
| `bg-gray-700` / `bg-gray-800` | `bg-[#0A0A0A]` |
| `bg-gray-900` / `bg-black` | `bg-[#000000]` |
| `border-gray-200` / `border-gray-300` / `border-gray-600` / `border-gray-700` | `border-[#1F1F1F]` |
| `border-gray-500` (emphasis) | `border-[#2C2C2C]` |
| `text-gray-900` / `text-white` | `text-[#FAFAFA]` |
| `text-gray-600` / `text-gray-700` / `text-gray-200` | `text-[#A3A3A3]` |
| `text-gray-400` / `text-gray-500` | `text-[#737373]` |
| `bg-blue-500` / `bg-blue-600` (primary CTA) | `bg-[#2553F4] hover:bg-[#1E46DC]` |
| `text-blue-500` / `text-blue-600` (link/accent) | `text-[#2553F4]` |
| `focus:ring-blue-500` / `focus:border-blue-500` | `focus:ring-[#2553F4] focus:border-[#2553F4]` |
| `bg-red-500` / `text-red-500` / `border-red-500` (destructive) | use `[#E84B5B]` equivalents |

**Patterns:** Cards/panels adopt the `bg-[#0A0A0A] border border-[#1F1F1F]` chrome. Form inputs follow the recipe used in `PhoneNumberPicker.jsx` after Task 7. Primary buttons get the login-style: `bg-[#2553F4] hover:bg-[#1E46DC] text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed`, with the label rendered as `<span className="hw-mono text-[11px] tracking-[0.16em] uppercase font-semibold">…</span>` (see `web/src/app/login/page.jsx:253-268` for the reference pattern).

- [ ] **Step 1: Inventory current matches**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && grep -nE "(bg|border|text|focus:ring|placeholder)-(gray|blue|slate|red)-[0-9]+" web/src/app/dashboard/employees/page.jsx | wc -l
```

Note the count (~37 expected) so you can verify after.

- [ ] **Step 2: Apply substitutions per the token map**

Walk through each match and replace per the table above. Use `Edit` with `replace_all: true` for stable string-by-string substitutions where the old class fragment is unambiguous (e.g., `border-gray-700` → `border-[#1F1F1F]`). For ambiguous matches (e.g., a class string like `bg-gray-50 hover:bg-gray-100` where `hover:bg-gray-100` is part of a button), do them one at a time.

Do NOT touch:
- Variable names containing `gray` / `blue` / `red`
- Comments
- Strings inside `style={...}` objects (those are CSS values, not class names) unless they reference theme colors and you want to migrate those too — leave them alone in this task
- Identifier and template-literal substrings that aren't Tailwind utility classes

- [ ] **Step 3: Verify zero raw utilities remain**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && grep -nE "(bg|border|text|focus:ring|placeholder)-(gray|blue|slate|red)-[0-9]+" web/src/app/dashboard/employees/page.jsx
```

Expected: no output.

- [ ] **Step 4: Manual visual check**

Start the app (assumes Task 1's spec for the dev start works — `HIREWIRE_START` no longer needed thanks to the earlier gate fix):

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/web" && npm run dev > /tmp/web-theme-check.log 2>&1 &
echo $! > /tmp/web.pid
sleep 12
curl -s -o /dev/null -w "/dashboard/employees: %{http_code}\n" http://localhost:5001/dashboard/employees
kill $(cat /tmp/web.pid)
```

Expected: `200`. (A real visual diff requires opening the browser; if the implementer has Chrome MCP available they should grab a screenshot of `/dashboard/employees` and compare against `/login` chrome.)

- [ ] **Step 5: Run Vitest**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/web" && npm test -- --run 2>&1 | tail -5
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI"
git add web/src/app/dashboard/employees/page.jsx
git commit -m "style(employees): migrate page to HireWire.AI hex tokens"
```

---

## Task 9 — UI text rename "employee" → "agent" — Employees page

**Files:**
- Modify: `web/src/app/dashboard/employees/page.jsx`

**Rules:** JSX text content + props that are user-visible strings only (`label`, `placeholder`, `title`, `aria-label`, toast/error message strings, `<h1>`/`<h2>`/`<button>` text). Do not change variable/function names, route paths, JSON keys, import paths, comments, or DB field references.

**Casing pairs:** `Employee`→`Agent`, `employee`→`agent`, `Employees`→`Agents`, `employees`→`agents`.

- [ ] **Step 1: Find candidate strings**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && grep -n "employee\|Employee" web/src/app/dashboard/employees/page.jsx | head -50
```

Read each hit. Categorize: USER-VISIBLE (rename), or IDENTIFIER/PATH/COMMENT (leave).

- [ ] **Step 2: Per-match edits**

For every match flagged USER-VISIBLE, apply the appropriate casing pair. Examples (illustrative — actual hits will vary):

```jsx
// before
<h1>Employees</h1>
// after
<h1>Agents</h1>
```

```jsx
// before
<button>Create Employee</button>
// after
<button>Create Agent</button>
```

```jsx
// before
toast.success("Employee created");
// after
toast.success("Agent created");
```

Leave intact:
- `getAllEmployees`, `employees` table references, `enabled_functions.employee_*` keys, etc.
- `// employees fetched from db` (comments)
- Route imports like `from "../employees/..."`

- [ ] **Step 3: Verify no user-visible "employee" strings remain**

Manual scan: `grep -n "[Ee]mployee" web/src/app/dashboard/employees/page.jsx`. Confirm every remaining match is a non-user-visible identifier, comment, or path.

- [ ] **Step 4: Run Vitest**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/web" && npm test -- --run 2>&1 | tail -5
```

Expected: green. If a test asserts on user-visible "Employee" text, update the assertion.

- [ ] **Step 5: Commit**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI"
git add web/src/app/dashboard/employees/page.jsx
git commit -m "feat(employees): rename user-visible 'employee' -> 'agent'"
```

---

## Task 10 — UI text rename — wizard components

**Files:**
- Modify: `web/src/components/dashboard/WizardBanner.jsx`
- Modify: `web/src/components/dashboard/WizardCreationCanvas.jsx`
- Modify: `web/src/components/dashboard/DashboardSplitHero.jsx`
- Modify: `web/src/components/dashboard/TemplateCarouselCard.jsx`

- [ ] **Step 1: Find candidate strings**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && grep -n "employee\|Employee" \
  web/src/components/dashboard/WizardBanner.jsx \
  web/src/components/dashboard/WizardCreationCanvas.jsx \
  web/src/components/dashboard/DashboardSplitHero.jsx \
  web/src/components/dashboard/TemplateCarouselCard.jsx
```

- [ ] **Step 2: Per-match edits**

Same rules as Task 9. Visible JSX text + visible string props get renamed. Identifiers and paths stay.

- [ ] **Step 3: Update tests if any assert on the visible strings**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && grep -n "employee\|Employee" \
  web/src/components/dashboard/__tests__/WizardBanner.test.jsx \
  web/src/components/dashboard/__tests__/WizardCreationCanvas.test.jsx \
  web/src/components/dashboard/__tests__/DashboardSplitHero.test.jsx \
  web/src/components/dashboard/__tests__/TemplateCarouselCard.test.jsx
```

For each user-visible-text assertion (e.g. `getByText(/employee/i)`), update the regex/string accordingly. Do not modify the existing 3 pre-existing failing tests in `WizardBanner.test.jsx` other than to keep their text assertions consistent.

- [ ] **Step 4: Run Vitest**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/web" && npm test -- --run 2>&1 | tail -5
```

Expected: same baseline (3 pre-existing WizardBanner failures still fail; everything else passes).

- [ ] **Step 5: Commit**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI"
git add web/src/components/dashboard/WizardBanner.jsx web/src/components/dashboard/WizardCreationCanvas.jsx web/src/components/dashboard/DashboardSplitHero.jsx web/src/components/dashboard/TemplateCarouselCard.jsx web/src/components/dashboard/__tests__/
git commit -m "feat(wizard): rename user-visible 'employee' -> 'agent'"
```

---

## Task 11 — UI text rename — dashboard pages

**Files:**
- Modify: `web/src/app/dashboard/layout.jsx`
- Modify: `web/src/app/dashboard/page.jsx`
- Modify: `web/src/app/dashboard/templates/page.jsx`

- [ ] **Step 1: Find candidate strings**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && grep -n "employee\|Employee" \
  web/src/app/dashboard/layout.jsx \
  web/src/app/dashboard/page.jsx \
  web/src/app/dashboard/templates/page.jsx
```

- [ ] **Step 2: Per-match edits**

Same rules. Note: nav link `to="/dashboard/employees"` keeps the path; only the displayed link **text** changes (e.g., `<Link to="/dashboard/employees">Employees</Link>` → `<Link to="/dashboard/employees">Agents</Link>`).

- [ ] **Step 3: Run Vitest**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/web" && npm test -- --run 2>&1 | tail -5
```

Expected: green baseline.

- [ ] **Step 4: Commit**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI"
git add web/src/app/dashboard/layout.jsx web/src/app/dashboard/page.jsx web/src/app/dashboard/templates/page.jsx
git commit -m "feat(dashboard): rename user-visible 'employee' -> 'agent'"
```

---

## Task 12 — Final verification

**Files:** none (verification only)

- [ ] **Step 1: Backend `end_call` is gone**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && grep -rn "end_call" agent/ web/src/
```

Expected output: only the filter line in `web/src/lib/db.ts` (the `.filter((fn) => fn !== 'end_call')`) and the test asserting on it. No other matches.

- [ ] **Step 2: No raw gray/blue Tailwind utilities on the Employees page or the picker**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && grep -nE "(bg|border|text|focus:ring|placeholder)-(gray|blue|slate|red)-[0-9]+" \
  web/src/app/dashboard/employees/page.jsx \
  web/src/components/dashboard/PhoneNumberPicker.jsx
```

Expected: no output.

- [ ] **Step 3: Full Vitest suite**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/web" && npm test -- --run 2>&1 | tail -10
```

Expected: same 3 pre-existing WizardBanner failures + every other test green. New tests from Tasks 1 + 3 pass.

- [ ] **Step 4: Smoke-start both services**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/agent" && python3 main.py > /tmp/agent-final.log 2>&1 &
echo $! > /tmp/agent-final.pid
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/web" && npm run dev > /tmp/web-final.log 2>&1 &
echo $! > /tmp/web-final.pid
sleep 15
curl -s -o /dev/null -w "agent /docs: %{http_code}\n" http://localhost:8000/docs
curl -s -o /dev/null -w "web /dashboard/employees: %{http_code}\n" http://localhost:5001/dashboard/employees
kill $(cat /tmp/agent-final.pid) $(cat /tmp/web-final.pid)
```

Expected: both 200.

- [ ] **Step 5: Manual checklist (browser)**

Open http://localhost:5001/dashboard/employees in Chrome and confirm:

1. Page chrome matches `/login` (pure-black canvas, hairline borders, blue accent on primary CTAs).
2. "Create Agent" button appears (no longer "Create Employee").
3. Clicking "Create Agent" → pick each of the 6 templates → every function checkbox starts unchecked.
4. Enable "Transfer to Human" → Transfer To Number and Transfer From fields render as a single text input with a caret button. Click caret → popover lists incoming numbers with friendly names (e.g., `+1 (555) 123-4567 — "Sales line"`). Type a custom number → it persists.
5. Function options list does NOT contain "End Call".
6. Save an agent. Reload. Visible labels say "Agent", URL bar still reads `/dashboard/employees` (intentional per spec).

- [ ] **Step 6: No commit needed**

Verification only. If everything passes, the branch is ready for code review.

---

## Self-Review (already done by planner)

- ✅ Spec coverage: each of items 1-5 in the spec maps to one or more tasks (theme = Tasks 7+8; combobox = Tasks 1+2; end_call removal = Tasks 3-6; empty templates = Tasks 5-6; rename = Tasks 9-11).
- ✅ No placeholders. Every code change has the exact code or an exact substitution rule.
- ✅ Type/method consistency: `variant` is the same prop name in Task 1 and Task 2; `employeeRowToJson` matches the actual export name in `db.ts`.
- ✅ Test names referenced in commands match the file paths created.
