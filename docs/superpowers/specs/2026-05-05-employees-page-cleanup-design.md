# Employees Page Cleanup — Design Spec

**Date:** 2026-05-05
**Status:** Approved (brainstorm)
**Owner:** Jon Gray

## Problem

The Employees page has drifted from the rest of the app on five fronts:

1. **Theme drift.** `web/src/app/dashboard/employees/page.jsx` uses 37 raw `bg-gray-*` / `border-gray-*` / `bg-blue-*` / `text-gray-*` Tailwind utilities and zero references to the HireWire.AI theme tokens defined in `web/src/app/global.css`. The page reads as the old gray/blue palette next to the login page's pure-black + blue-accent treatment. `web/src/components/dashboard/PhoneNumberPicker.jsx` shares the problem.
2. **Phone-number entry mismatch.** The Transfer From / Transfer To fields render as a `<select>` with a "Custom number…" toggle that swaps to a free-text input. Users want a single text input with a dropdown affordance — type or pick — and the friendly name visible in the picker. The component already implements that pattern as `ComboboxField` but it's gated behind `source="campaign-registry"`, which fetches a different (10DLC-only) data set.
3. **Dead `end_call` SWAIG function.** `agent/main.py:647-668` defines an `end_call` SWAIG that calls `result.hangup()`, but the AI ends calls naturally without an explicit function call. The option clutters the UI checkbox list and the default `enabled_functions` arrays.
4. **Pre-checked template functions.** Each of the 6 templates in `web/src/lib/templates.js` pre-fills `enabled_functions` with 5–7 functions. New users see a wall of pre-checked boxes and have to opt out. The expected behavior is opt-in.
5. **"Employee" terminology.** The product is "virtual agents" but the UI calls them employees. 45 files reference the word.

## Goals

1. Make the Employees page visually consistent with the rest of the rebranded HireWire.AI surfaces (login, dashboard hero).
2. Replace the select+toggle on Transfer From / Transfer To with a single combobox: text input + dropdown of incoming phone numbers, friendly name shown in each option.
3. Remove the `end_call` SWAIG end-to-end (UI options, template defaults, backend handler, prompt copy).
4. Switch all 6 templates' `enabled_functions` defaults to `[]` so the user opts in.
5. Rename user-visible "employee" → "agent" without touching routes, filenames, DB columns, or SWML callback paths.

## Non-Goals

- Redesigning the Employees page IA, layout, or form structure beyond palette and the two phone-number fields.
- Renaming the `/dashboard/employees` route, the DB `employees` table, the `/swml/{employee_id}` SWAIG endpoint, the `/api/employees/sync` route, or filenames. (Explicitly deferred — these would risk breaking already-provisioned SignalWire phone numbers and collide with the existing `/api/agents` endpoint.)
- Migrating existing agent rows in the DB whose `enabled_functions` contains `"end_call"` — handled by a one-time read-path filter instead of a schema migration.
- Touching the WizardBanner test suite (3 pre-existing failures, unrelated).

## Decisions Locked During Brainstorm

| # | Question | Decision |
|---|---|---|
| Q1 | What does "End Call is not a function" mean? | **C** — remove everywhere (UI, templates, backend handler) |
| Q2 | Scope of "employee → agent" rename? | **A** — UI text only |
| Q3 | How to wire combobox? | **A** — generalize `PhoneNumberPicker` with new `variant` prop |

## Design

### 1. Theme migration

**Files:**
- `web/src/app/dashboard/employees/page.jsx`
- `web/src/components/dashboard/PhoneNumberPicker.jsx`

**Convention.** Follow the existing pattern in `web/src/app/login/page.jsx`: Tailwind arbitrary hex literals matching the CSS vars in `global.css`. Don't introduce theme-token classes (`bg-theme-secondary`) here, because the rest of the rebranded surface uses literals and we want one convention per page.

**Token map:**

| Purpose | Class | CSS var |
|---|---|---|
| Canvas | `bg-[#000000]` | `--bg-primary` |
| Panel | `bg-[#0A0A0A]` | `--bg-secondary` |
| Elevated surface | `bg-[#111111]` | `--bg-tertiary` |
| Hover | `bg-[#1F1F1F]` | `--bg-hover` |
| Hairline border | `border-[#1F1F1F]` | `--border` |
| Hairline emphasis | `border-[#2C2C2C]` | `--border-light` |
| Primary text | `text-[#FAFAFA]` | `--text-primary` |
| Secondary text | `text-[#A3A3A3]` | `--text-secondary` |
| Tertiary text (eyebrow / micro-label) | `text-[#737373]` + `hw-mono` | `--text-tertiary` |
| Disabled text | `text-[#404040]` | `--text-disabled` |
| Primary CTA | `bg-[#2553F4]` + `focus:ring-[#2553F4]` | `--accent-primary` |
| Destructive / alert | `text-[#E84B5B]` | `--accent-secondary` |

**Patterns to copy from `login/page.jsx`:**
- Card chrome: `bg-[#0A0A0A] border border-[#1F1F1F] p-8` with the 3px left blue gutter `<span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#2553F4]" />` for primary panels.
- Form fields: `w-full px-4 py-3 bg-[#0A0A0A] border border-[#1F1F1F] text-[#FAFAFA] placeholder:text-[#737373] focus:outline-none focus:ring-2 focus:ring-[#2553F4] focus:border-[#2553F4] transition-colors`.
- Eyebrow labels: `hw-mono text-[10px] tracking-[0.18em] uppercase text-[#737373]`.
- Primary buttons: solid `bg-[#2553F4] hover:bg-[#1E46DC] text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed`, with the button label rendered as a `hw-mono text-[11px] tracking-[0.16em] uppercase font-semibold` span (matches `web/src/app/login/page.jsx:253-268`).

### 2. PhoneNumberPicker — `variant` prop

**Change.** Add `variant?: "select" | "combobox"` to `PhoneNumberPicker.jsx`. Default `"select"` for backward compat.

**Decoupling.** `source` stays as the data flag (`"all"` vs `"campaign-registry"`). `variant` picks the rendering. `source="campaign-registry"` continues to render combobox unconditionally (today's behavior). `source="all"` honors the `variant` prop.

**Combobox + all data source.** `ComboboxField` is reused as-is; the only change is the data feed. When `source="all" + variant="combobox"`, the component fetches from `/api/signalwire/phone-numbers` (already its current source for `"all"`) and passes the resulting `[{ phoneNumber, friendlyName, sid }, ...]` array into `ComboboxField` with the existing formatter:

```
{formatNumber(pn.phoneNumber)}{pn.friendlyName ? ` — "${pn.friendlyName}"` : ''}
```

This is the same friendly-name format the current `<select>` already uses, so the option text stays identical — only the affordance changes.

**Call sites updated.** `employees/page.jsx:1583-1597` — both Transfer To and Transfer From pass `variant="combobox"`. No other call sites need changes.

### 3. Remove `end_call` everywhere

**Frontend (`web/src/app/dashboard/employees/page.jsx`):**
- `:236` — drop the entry from the `FUNCTIONS` array.
- `:1192` — remove `"end_call"` from default `enabled_functions`.

**Templates (`web/src/lib/templates.js`):**
- Lines 75, 139, 205, 269, 335, 401 — strip `"end_call"` from each array.

**Backend (`agent/main.py`):**
- `:647-668` — delete the SWAIG function definition (`name="end_call"` and `def end_call(...)`).
- `:1187` — remove from default function list.
- `:1333` — remove the prompt line `"- end_call: Politely end the call when the conversation is complete\n"`.
- `:1424, :1626` — remove from `enabled_functions` defaults.

**DB read-path filter.** `web/src/lib/db.ts` — in `getAllEmployees` and `getEmployeeById`, after parsing `enabled_functions` JSON, filter out `"end_call"` so existing rows that still contain it don't crash the UI or attempt to call a function the backend no longer exposes.

### 4. Empty default `enabled_functions`

- `web/src/lib/templates.js` lines 75, 139, 205, 269, 335, 401 — change each to `enabled_functions: []`.
- `web/src/app/dashboard/employees/page.jsx:1192` — `enabled_functions: source.enabled_functions || []`.
- `agent/main.py:1424, :1626` — change defaults to `[]`.

**Note.** Existing agent rows in the DB keep their stored `enabled_functions`. Only new agents created via "Use this template" start with all checkboxes unchecked.

### 5. UI text rename

**In scope** — JSX text content, labels, placeholders, toasts, headings, page titles, section headers, button labels, error messages.

**Out of scope** — routes, filenames, import paths, DB columns, SWML param names, API paths, variable names, function names, comments, JSDoc.

**Casing pairs:**
- `Employee` → `Agent`
- `employee` → `agent`
- `Employees` → `Agents`
- `employees` → `agents`

**Files containing user-visible strings to update:**
- `web/src/app/dashboard/employees/page.jsx` (page title, section headers, button labels, modal copy)
- `web/src/components/dashboard/WizardBanner.jsx`
- `web/src/components/dashboard/WizardCreationCanvas.jsx`
- `web/src/components/dashboard/DashboardSplitHero.jsx`
- `web/src/components/dashboard/TemplateCarouselCard.jsx`
- `web/src/app/dashboard/layout.jsx` (nav)
- `web/src/app/dashboard/page.jsx` (home copy)
- `web/src/app/dashboard/templates/page.jsx`
- Toast / notification strings wherever they live in the affected files

**Method.** Per-file targeted edits, not a global `sed`. The implementer must look at each match and confirm it's a user-visible string. Identifiers, route paths, and JSON keys must be skipped.

**Known cosmetic gap.** The URL bar will still read `/dashboard/employees` after this change. Acceptable — flagged for a future renamed-route follow-up.

## Data flow

No backend or DB schema changes. Read-path adjustments only:

- DB → `getAllEmployees` / `getEmployeeById` strip `"end_call"` from each row's `enabled_functions` before returning. Other consumers see a clean list.
- Frontend → fewer options in the FUNCTIONS array; templates seed empty arrays.
- SWML generation (`agent/main.py`) → `enabled_functions` arrays no longer include `end_call`; the backend handler is gone, so any stale arrays that slip through render no SWAIG entry for it.

## Error handling

- `PhoneNumberPicker` combobox: `phone-numbers` endpoint failure already short-circuits to an empty options array (existing `.catch`) — caret button becomes disabled because `hasOptions` is false. Typed values still pass through. No change needed.
- `end_call` migration: if the backend receives a SWAIG callback for `end_call` (theoretically possible from an in-flight call placed before deploy), the SDK responds with an unknown-function error. Acceptable for a short window; the AI will still hang up naturally.
- DB read-path filter is a pure JS array filter — no failure modes.

## Testing

**Vitest suite** (`cd web && npm test`):
- Must stay green. Today: 155/158. The 3 WizardBanner failures are pre-existing and out of scope.

**New test** — `PhoneNumberPicker` with `variant="combobox"` renders the text input, caret button, and popover-on-click; typed values flow through `onChange`; selecting a popover row replaces the input value with the formatted number.

**Manual checklist:**
1. Load `/dashboard/employees`. Visual parity with `/login` chrome — pure-black canvas, hairline borders, blue accent on CTA, no gray/blue Tailwind defaults visible.
2. Click "Create Agent" → pick each of the 6 templates → verify all function checkboxes start unchecked.
3. Enable Transfer to Human → both Transfer To and Transfer From render as text input with caret. Click caret → popover lists incoming numbers with friendly names. Type a new number → it persists.
4. Save an agent. Reload. Confirm `end_call` is not in the function list and not stored.
5. `grep -ri "end_call" web/src agent/` returns no matches outside removed comments / migration filter.
6. URL `/dashboard/employees` still loads (route unchanged). Page title and visible copy say "Agents".

## Out-of-scope follow-ups

- Renaming the `/dashboard/employees` route, DB `employees` table, and SWML `{employee_id}` param. Will collide with the existing `/api/agents` endpoint and break already-provisioned SignalWire phone numbers; needs its own design.
- Cleaning up the 3 WizardBanner test failures.
- Theme migration of dashboard pages outside `/employees`.
