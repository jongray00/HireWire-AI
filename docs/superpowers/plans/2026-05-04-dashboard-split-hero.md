# Dashboard Split Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the global wizard banner + the dashboard's "Create Employee" quick action with a split-hero on the dashboard home that presents two equal-weight creation paths (Wizard call, Templates), repositioned based on whether any employees exist.

**Architecture:** Add three new components (`DashboardSplitHero`, `WizardCallCard`, `TemplateCarouselCard`) under `web/src/components/dashboard/`. Reuse the existing `WizardBanner` (which owns the wizard call lifecycle) by giving it an `inline` variant — no logic extraction, no risk of breaking the SignalWire/SDK plumbing. Move the templates data into a shared `lib/templates.js` so both the templates page and the carousel render from one source.

**Tech Stack:** React + React Router 7 + Vite + Tailwind + Vitest + Testing Library. Existing wizard call flow uses `useWizardCall`, `useDomainAutoSync`, `WizardCreationCanvas`, and the `wizard-*` window event bus — all unchanged.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `web/src/lib/templates.js` | Create | Single source of truth for template metadata (id, name, description, icon, color, defaultData). Imported by both the templates page and the carousel. |
| `web/src/lib/__tests__/templates.test.js` | Create | Asserts shape and ≥1 templates exported. |
| `web/src/components/dashboard/WizardBanner.jsx` | Modify | Add `variant` prop: `"global"` (default, current outer margins) or `"inline"` (no outer margins, ready to live inside a card column). |
| `web/src/components/dashboard/__tests__/WizardBanner.test.jsx` | Modify | Add a test for `variant="inline"` rendering without outer margin classes. |
| `web/src/components/dashboard/TemplateCarouselCard.jsx` | Create | Right column of the hero. Renders up to 4 template tiles + "Browse all N →" link. |
| `web/src/components/dashboard/__tests__/TemplateCarouselCard.test.jsx` | Create | Tests rendering, navigation, fallback when 0 templates. |
| `web/src/components/dashboard/WizardCallCard.jsx` | Create | Left column of the hero. Wraps `<WizardBanner variant="inline" />` in the Path-A card frame (gradient bg, "PATH A" label, title, body). |
| `web/src/components/dashboard/__tests__/WizardCallCard.test.jsx` | Create | Tests that the inline banner is rendered and the card frame around it is correct. |
| `web/src/components/dashboard/DashboardSplitHero.jsx` | Create | 50/50 grid (lg+) / stacked (sm). Composes the two cards. |
| `web/src/components/dashboard/__tests__/DashboardSplitHero.test.jsx` | Create | Tests both columns render. |
| `web/src/app/dashboard/page.jsx` | Modify | Insert `<DashboardSplitHero />` with positioning rule. Remove "Getting Started" + "Welcome back" hero blocks. Remove "Create Employee" + "Browse Templates" quick actions. |
| `web/src/app/dashboard/__tests__/dashboard-positioning.test.jsx` | Create | Asserts hero is rendered before stats when employees=0, after stats when >0. |
| `web/src/app/dashboard/layout.jsx` | Modify | Remove `<WizardBanner />` mount. Keep `<WizardCreationCanvas />`. |
| `web/src/app/dashboard/templates/page.jsx` | Modify | Remove the inline `TEMPLATES` array; import from `lib/templates.js`. |
| `web/src/components/dashboard/__tests__/wizard-flow.test.jsx` | Modify | Mount the dashboard page (or `DashboardSplitHero`) instead of `<WizardBanner />` standalone. |

---

## Task 1: Extract templates to `lib/templates.js`

**Files:**
- Create: `web/src/lib/templates.js`
- Create: `web/src/lib/__tests__/templates.test.js`
- Modify: `web/src/app/dashboard/templates/page.jsx`

- [ ] **Step 1.1: Write failing test**

Create `web/src/lib/__tests__/templates.test.js`:

```js
import { describe, it, expect } from "vitest";
import { TEMPLATES, getTemplateById } from "../templates.js";

describe("templates module", () => {
  it("exports a non-empty array", () => {
    expect(Array.isArray(TEMPLATES)).toBe(true);
    expect(TEMPLATES.length).toBeGreaterThan(0);
  });

  it("each template has required fields", () => {
    for (const t of TEMPLATES) {
      expect(typeof t.id).toBe("string");
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(typeof t.color).toBe("string");
      expect(t.icon).toBeTruthy(); // a component
      expect(t.defaultData).toBeTruthy();
    }
  });

  it("ids are unique", () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getTemplateById returns the matching template or undefined", () => {
    const first = TEMPLATES[0];
    expect(getTemplateById(first.id)).toBe(first);
    expect(getTemplateById("nope-not-here")).toBeUndefined();
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run from `web/`:
```bash
npx vitest run src/lib/__tests__/templates.test.js
```
Expected: FAIL — `templates.js` does not exist.

- [ ] **Step 1.3: Create `lib/templates.js`**

Open `web/src/app/dashboard/templates/page.jsx`. Cut the entire `const TEMPLATES = [...]` array (currently starts ~line 22). Move it into a new file `web/src/lib/templates.js`. Add the lucide imports the array depends on (Briefcase, HeadphonesIcon, Calendar, ShoppingCart, Phone, plus any other icons used) — just the icons referenced inside template entries.

```js
// web/src/lib/templates.js
import {
  Briefcase,
  HeadphonesIcon,
  Calendar,
  ShoppingCart,
  Phone,
  // ...keep whatever icons the original TEMPLATES array referenced
} from "lucide-react";

export const TEMPLATES = [
  // ... paste the entire array body here, unchanged
];

export function getTemplateById(id) {
  return TEMPLATES.find((t) => t.id === id);
}
```

In `web/src/app/dashboard/templates/page.jsx`, delete the now-unused lucide icon imports that were only used for templates, and add:
```js
import { TEMPLATES } from "@/lib/templates";
```

- [ ] **Step 1.4: Run test to verify it passes**

```bash
npx vitest run src/lib/__tests__/templates.test.js
```
Expected: PASS, 4 tests.

- [ ] **Step 1.5: Run full test suite to ensure templates page still works**

```bash
npx vitest run
```
Expected: PASS for everything (or only pre-existing failures unrelated to this change).

- [ ] **Step 1.6: Manual sanity check**

If the dev server is running, navigate to `/dashboard/templates` in the browser — the page should render exactly as before. (No commit yet — user will commit when they choose.)

---

## Task 2: Add `variant` prop to `WizardBanner`

**Files:**
- Modify: `web/src/components/dashboard/WizardBanner.jsx`
- Modify: `web/src/components/dashboard/__tests__/WizardBanner.test.jsx`

- [ ] **Step 2.1: Read existing test file**

Read `web/src/components/dashboard/__tests__/WizardBanner.test.jsx` to understand the existing setup (mocks, render helpers).

- [ ] **Step 2.2: Add failing test for inline variant**

Append to that test file:

```jsx
it("variant='inline' drops outer mx/mt margin classes", () => {
  const { container } = render(<WizardBanner variant="inline" />);
  const root = container.firstChild;
  // The outermost wrapper of the idle CTA should NOT have the global margin
  // classes that pad the banner to the page edges.
  expect(root.className || "").not.toMatch(/\bmx-4\b/);
  expect(root.className || "").not.toMatch(/\bmt-4\b/);
});

it("variant defaults to 'global' (preserves existing margin classes)", () => {
  const { container } = render(<WizardBanner />);
  const root = container.firstChild;
  expect(root.className || "").toMatch(/\bmx-4\b/);
});
```

(Adjust the `.firstChild` access if the test setup wraps the component — match what existing tests do.)

- [ ] **Step 2.3: Run test to verify it fails**

```bash
npx vitest run src/components/dashboard/__tests__/WizardBanner.test.jsx
```
Expected: FAIL — variant prop ignored.

- [ ] **Step 2.4: Add the prop**

Modify `WizardBanner.jsx`:

```jsx
export default function WizardBanner({ onAgentCreated, variant = "global" }) {
  // ... unchanged code above ...
  const outer = variant === "inline" ? "" : "mx-4 lg:mx-6 mt-4 mb-0";
  // ... near each return that currently uses `mx-4 lg:mx-6 mt-4 mb-0`, swap that
  // string for `${outer}` (use a className template literal):
  //   <div className={outer}>...</div>
  //   <div className={outer}>...</div>
}
```

There are 4 places in the current `WizardBanner.jsx` that use `mx-4 lg:mx-6 mt-4 mb-0` (the SyncToast outer, the idle CTA outer, the failed-to-connect panel, the generic-error outer, the active-banner outer). Replace each with `outer`. Important: when `outer` is empty string, the resulting `className=""` is fine — Tailwind ignores it. If a parent wraps already with margins, the inline variant slots in cleanly.

- [ ] **Step 2.5: Run tests to verify pass**

```bash
npx vitest run src/components/dashboard/__tests__/WizardBanner.test.jsx
```
Expected: PASS.

```bash
npx vitest run
```
Expected: PASS for everything.

---

## Task 3: Build `TemplateCarouselCard`

**Files:**
- Create: `web/src/components/dashboard/TemplateCarouselCard.jsx`
- Create: `web/src/components/dashboard/__tests__/TemplateCarouselCard.test.jsx`

- [ ] **Step 3.1: Write failing tests**

```jsx
// TemplateCarouselCard.test.jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import TemplateCarouselCard from "../TemplateCarouselCard";

const sampleTemplates = [
  { id: "a", name: "Alpha", description: "A", color: "blue", icon: () => null, defaultData: {} },
  { id: "b", name: "Bravo", description: "B", color: "green", icon: () => null, defaultData: {} },
  { id: "c", name: "Charlie", description: "C", color: "purple", icon: () => null, defaultData: {} },
  { id: "d", name: "Delta", description: "D", color: "orange", icon: () => null, defaultData: {} },
  { id: "e", name: "Echo", description: "E", color: "pink", icon: () => null, defaultData: {} },
];

const renderWith = (templates) =>
  render(
    <MemoryRouter>
      <TemplateCarouselCard templates={templates} />
    </MemoryRouter>
  );

describe("TemplateCarouselCard", () => {
  it("renders the path label and title", () => {
    renderWith(sampleTemplates);
    expect(screen.getByText(/path b/i)).toBeInTheDocument();
    expect(screen.getByText(/pick a template/i)).toBeInTheDocument();
  });

  it("renders up to 4 template tiles", () => {
    renderWith(sampleTemplates);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    expect(screen.getByText("Delta")).toBeInTheDocument();
    expect(screen.queryByText("Echo")).not.toBeInTheDocument();
  });

  it("'Browse all N' link goes to /dashboard/templates with correct count", () => {
    renderWith(sampleTemplates);
    const link = screen.getByRole("link", { name: /browse all 5/i });
    expect(link).toHaveAttribute("href", "/dashboard/templates");
  });

  it("renders an empty-state link when no templates are passed", () => {
    renderWith([]);
    const link = screen.getByRole("link", { name: /browse all/i });
    expect(link).toHaveAttribute("href", "/dashboard/templates");
  });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

```bash
npx vitest run src/components/dashboard/__tests__/TemplateCarouselCard.test.jsx
```
Expected: FAIL — module does not exist.

- [ ] **Step 3.3: Implement `TemplateCarouselCard.jsx`**

```jsx
"use client";

import { Link } from "react-router";
import { ArrowRight } from "lucide-react";

/**
 * TemplateCarouselCard — Path B in the dashboard split hero.
 * Shows up to 4 template tiles + "Browse all N →" link to /dashboard/templates.
 */
export default function TemplateCarouselCard({ templates = [] }) {
  const visible = templates.slice(0, 4);
  const total = templates.length;

  return (
    <div className="relative bg-[#0A0A0A] border border-[#1F1F1F] p-6 h-full flex flex-col">
      <div className="hw-mono text-[10px] tracking-[0.18em] uppercase text-[#737373] mb-2">
        Path B
      </div>
      <h2 className="text-xl lg:text-2xl font-medium text-[#FAFAFA] tracking-tight mb-2">
        Pick a template
      </h2>
      <p className="text-sm text-[#A3A3A3] mb-5">
        Start from a pre-built agent and customize.
      </p>

      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 mb-4">
        {visible.map((t) => {
          const Icon = t.icon;
          return (
            <Link
              key={t.id}
              to={`/dashboard/templates#${t.id}`}
              className="shrink-0 w-[160px] bg-[#0F0F0F] border border-[#1F1F1F] hover:border-[#2553F4]/60 transition-colors p-3 flex flex-col gap-2"
            >
              <div className="w-8 h-8 border border-[#1F1F1F] flex items-center justify-center">
                {Icon ? <Icon className="w-4 h-4 text-[#A3A3A3]" /> : null}
              </div>
              <div className="text-sm text-[#FAFAFA] font-medium leading-tight">{t.name}</div>
              <div className="hw-mono text-[9px] tracking-[0.14em] uppercase text-[#737373]">
                {t.color}
              </div>
            </Link>
          );
        })}
      </div>

      <Link
        to="/dashboard/templates"
        className="mt-auto inline-flex items-center gap-2 self-start px-4 py-2 border border-[#1F1F1F] hover:border-[#2553F4]/60 hover:text-[#FAFAFA] text-[#A3A3A3] transition-colors"
      >
        <span className="hw-mono text-[10px] tracking-[0.16em] uppercase">
          {total > 0 ? `Browse all ${total}` : "Browse all"}
        </span>
        <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}
```

- [ ] **Step 3.4: Run tests to verify pass**

```bash
npx vitest run src/components/dashboard/__tests__/TemplateCarouselCard.test.jsx
```
Expected: PASS, 4 tests.

---

## Task 4: Build `WizardCallCard`

**Files:**
- Create: `web/src/components/dashboard/WizardCallCard.jsx`
- Create: `web/src/components/dashboard/__tests__/WizardCallCard.test.jsx`

- [ ] **Step 4.1: Write failing test**

```jsx
// WizardCallCard.test.jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import WizardCallCard from "../WizardCallCard";

// The card embeds <WizardBanner variant="inline" />, which depends on hooks
// that talk to SignalWire. Mock the banner to keep this card test focused on
// composition.
vi.mock("../WizardBanner", () => ({
  default: ({ variant }) => (
    <div data-testid="wizard-banner-mock" data-variant={variant}>
      MOCK_BANNER
    </div>
  ),
}));

describe("WizardCallCard", () => {
  it("renders Path A label, title, and body", () => {
    render(<WizardCallCard />);
    expect(screen.getByText(/path a/i)).toBeInTheDocument();
    expect(screen.getByText(/build by voice/i)).toBeInTheDocument();
    expect(
      screen.getByText(/call the wizard/i)
    ).toBeInTheDocument();
  });

  it("embeds the wizard banner with variant='inline'", () => {
    render(<WizardCallCard />);
    const banner = screen.getByTestId("wizard-banner-mock");
    expect(banner).toBeInTheDocument();
    expect(banner.dataset.variant).toBe("inline");
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
npx vitest run src/components/dashboard/__tests__/WizardCallCard.test.jsx
```
Expected: FAIL — module does not exist.

- [ ] **Step 4.3: Implement `WizardCallCard.jsx`**

```jsx
"use client";

import WizardBanner from "./WizardBanner";

/**
 * WizardCallCard — Path A in the dashboard split hero.
 * Card frame around the existing inline WizardBanner so the call lifecycle
 * (mic, SignalWire SDK, session-log) keeps working without touching internals.
 */
export default function WizardCallCard() {
  return (
    <div
      className="relative border border-[#1F1F1F] p-6 h-full flex flex-col"
      style={{
        background: "linear-gradient(180deg, #0A0A0A 0%, #091333 100%)",
      }}
    >
      <div className="hw-mono text-[10px] tracking-[0.18em] uppercase text-[#5478F8] mb-2">
        Path A
      </div>
      <h2 className="text-xl lg:text-2xl font-medium text-[#FAFAFA] tracking-tight mb-2">
        Build by voice
      </h2>
      <p className="text-sm text-[#A3A3A3] mb-5">
        Call the wizard. It interviews you and creates an employee in about a minute.
      </p>
      <div className="mt-auto">
        <WizardBanner variant="inline" />
      </div>
    </div>
  );
}
```

- [ ] **Step 4.4: Run test to verify it passes**

```bash
npx vitest run src/components/dashboard/__tests__/WizardCallCard.test.jsx
```
Expected: PASS, 2 tests.

---

## Task 5: Build `DashboardSplitHero`

**Files:**
- Create: `web/src/components/dashboard/DashboardSplitHero.jsx`
- Create: `web/src/components/dashboard/__tests__/DashboardSplitHero.test.jsx`

- [ ] **Step 5.1: Write failing test**

```jsx
// DashboardSplitHero.test.jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import DashboardSplitHero from "../DashboardSplitHero";

vi.mock("../WizardBanner", () => ({
  default: () => <div data-testid="wizard-banner-mock">MOCK_BANNER</div>,
}));

describe("DashboardSplitHero", () => {
  it("renders both columns", () => {
    render(
      <MemoryRouter>
        <DashboardSplitHero templates={[]} />
      </MemoryRouter>
    );
    expect(screen.getByText(/build by voice/i)).toBeInTheDocument();
    expect(screen.getByText(/pick a template/i)).toBeInTheDocument();
    expect(screen.getByTestId("wizard-banner-mock")).toBeInTheDocument();
  });

  it("passes templates through to the carousel", () => {
    const Icon = () => null;
    const tpls = [
      { id: "a", name: "Alpha", description: "A", color: "blue", icon: Icon, defaultData: {} },
    ];
    render(
      <MemoryRouter>
        <DashboardSplitHero templates={tpls} />
      </MemoryRouter>
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

```bash
npx vitest run src/components/dashboard/__tests__/DashboardSplitHero.test.jsx
```
Expected: FAIL — module does not exist.

- [ ] **Step 5.3: Implement `DashboardSplitHero.jsx`**

```jsx
"use client";

import WizardCallCard from "./WizardCallCard";
import TemplateCarouselCard from "./TemplateCarouselCard";

/**
 * DashboardSplitHero — two-column hero on the dashboard home.
 * Path A (left): wizard call. Path B (right): template carousel.
 * Stacks vertically below `lg:`.
 *
 * Position on the page (top vs bottom) is decided by the dashboard page based
 * on whether any employees exist.
 */
export default function DashboardSplitHero({ templates = [] }) {
  return (
    <section
      aria-label="Create an employee"
      className="grid grid-cols-1 lg:grid-cols-2 gap-4"
    >
      <WizardCallCard />
      <TemplateCarouselCard templates={templates} />
    </section>
  );
}
```

- [ ] **Step 5.4: Run test to verify pass**

```bash
npx vitest run src/components/dashboard/__tests__/DashboardSplitHero.test.jsx
```
Expected: PASS, 2 tests.

---

## Task 6: Wire `DashboardSplitHero` into `dashboard/page.jsx`

**Files:**
- Modify: `web/src/app/dashboard/page.jsx`
- Create: `web/src/app/dashboard/__tests__/dashboard-positioning.test.jsx`

- [ ] **Step 6.1: Write failing positioning test**

```jsx
// dashboard-positioning.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import DashboardPage from "../page";

vi.mock("@/components/dashboard/WizardBanner", () => ({
  default: () => <div data-testid="wizard-banner-mock" />,
}));
// MSW or fetch mock — replace with whatever the project already uses.
// Stubs below are minimal: success returns no employees / employees as needed.

const mockFetch = (employees) => {
  global.fetch = vi.fn(async (url) => {
    if (String(url).includes("/api/employees/sync")) {
      return { ok: true, json: async () => ({ success: true, employees }) };
    }
    return { ok: true, json: async () => ({ success: true }) };
  });
};

beforeEach(() => {
  // Avoid leaking real localStorage between tests.
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DashboardPage positioning", () => {
  it("renders the split hero ABOVE the stats grid when there are no employees", async () => {
    mockFetch([]);
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText(/build by voice/i)).toBeInTheDocument();
    });
    const hero = screen.getByText(/build by voice/i).closest("section");
    const stats = screen.getByText(/total employees/i);
    expect(hero.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders the split hero BELOW the stats grid when there are employees", async () => {
    mockFetch([{ id: "e1", name: "X" }]);
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText(/build by voice/i)).toBeInTheDocument();
    });
    const hero = screen.getByText(/build by voice/i).closest("section");
    const stats = screen.getByText(/total employees/i);
    expect(stats.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
```

If the project uses MSW elsewhere, adapt to it. The stat label "total employees" is the existing label in `dashboard/page.jsx` — confirm by reading the file before running the test.

- [ ] **Step 6.2: Run test to verify it fails**

```bash
npx vitest run src/app/dashboard/__tests__/dashboard-positioning.test.jsx
```
Expected: FAIL — split hero is not in the dashboard.

- [ ] **Step 6.3: Edit `dashboard/page.jsx`**

In `web/src/app/dashboard/page.jsx`:

1. Add imports near the top:
   ```jsx
   import DashboardSplitHero from "@/components/dashboard/DashboardSplitHero";
   import { TEMPLATES } from "@/lib/templates";
   ```

2. Remove the `Plus` and `FileText` lucide imports if they are now unused (they were used by the old "Create Employee" / "Browse Templates" quick actions and the Getting Started hero). Re-check and remove only if truly unused — leave any still referenced.

3. **Remove** the `quickActions` entries for `"Create Employee"` and `"Browse Templates"` (keep `"View Employees"` and any other entries unchanged).

4. **Remove** the entire `{isFirstTime && (...)}` "Getting Started" hero block (the one with title "Hire an AI employee").

5. **Remove** the entire `{!isFirstTime && (...)}` "Welcome back" panel.

6. **Insert** the split hero with the positioning rule, around the stats and recent activity:

   ```jsx
   const isFirstTime = !loading && stats.totalEmployees === 0;
   const showHeroAtTop = loading || isFirstTime;

   return (
     <div className="max-w-7xl mx-auto space-y-8">
       {showHeroAtTop && <DashboardSplitHero templates={TEMPLATES} />}

       {/* Stats Grid (existing block) */}
       {/* ... unchanged ... */}

       {/* Recent Activity / Quick Actions (existing blocks) */}
       {/* ... unchanged ... */}

       {!showHeroAtTop && <DashboardSplitHero templates={TEMPLATES} />}
     </div>
   );
   ```

   `showHeroAtTop` defaults to "top" while data is loading, which avoids a flicker on a brand-new account.

- [ ] **Step 6.4: Run positioning test to verify pass**

```bash
npx vitest run src/app/dashboard/__tests__/dashboard-positioning.test.jsx
```
Expected: PASS, 2 tests.

- [ ] **Step 6.5: Run full test suite**

```bash
npx vitest run
```
Expected: PASS for everything.

---

## Task 7: Remove `<WizardBanner />` from `dashboard/layout.jsx`

**Files:**
- Modify: `web/src/app/dashboard/layout.jsx`

- [ ] **Step 7.1: Remove the mount**

In `web/src/app/dashboard/layout.jsx`:

1. Delete the import:
   ```jsx
   import WizardBanner from "@/components/dashboard/WizardBanner";
   ```
2. Delete the `<WizardBanner />` line (around line 271). **Keep** the `<WizardCreationCanvas />` line on the next line.

- [ ] **Step 7.2: Run tests**

```bash
npx vitest run
```
Expected: PASS. (`wizard-flow.test.jsx` may now fail if it relied on the layout rendering the banner. If so, continue to Task 8.)

---

## Task 8: Update `wizard-flow` integration test

**Files:**
- Modify: `web/src/components/dashboard/__tests__/wizard-flow.test.jsx`

- [ ] **Step 8.1: Read the existing test**

Read the file end-to-end. Identify what it mounts (likely `<WizardBanner />` directly, or a wrapper).

- [ ] **Step 8.2: Update the mount**

Replace the standalone `<WizardBanner />` mount with the new card composition:

```jsx
import { MemoryRouter } from "react-router";
import DashboardSplitHero from "../DashboardSplitHero";

// inside the test:
render(
  <MemoryRouter>
    <DashboardSplitHero templates={[]} />
  </MemoryRouter>
);
```

The hero embeds `<WizardCallCard />` → `<WizardBanner variant="inline" />`. The banner's behavior is unchanged, so existing assertions about call lifecycle, transcript events, and post-prompt logging should keep working as-is. If any assertions look at outer DOM structure (e.g. `mx-4` margin), update them to look at inner banner content instead.

- [ ] **Step 8.3: Run tests to verify pass**

```bash
npx vitest run src/components/dashboard/__tests__/wizard-flow.test.jsx
```
Expected: PASS.

---

## Task 9: Browser verification

- [ ] **Step 9.1: Restart dev servers if needed**

If the backend or frontend already auto-reloaded, skip. Otherwise:
```bash
# In one shell, from web/
npm run dev
# In another shell, from agent/
python3 main.py
```

- [ ] **Step 9.2: Open the dashboard in Chrome**

URL: `http://localhost:5001/dashboard`. Sign in if needed.

- [ ] **Step 9.3: First-time state**

If your account has no employees, verify:
- Split hero is at the **top** of the dashboard
- Left column is "Build by voice" with the wizard call control inside
- Right column is "Pick a template" with up to 4 template tiles + "Browse all 6 →"
- "Create Employee" and "Browse Templates" quick actions are gone
- The old "Getting Started" hero is gone

- [ ] **Step 9.4: After-first-employee state**

Use the wizard or templates path to create an employee. Then verify:
- Split hero is now at the **bottom** of the dashboard (after stats and recent activity)
- Stats and recent activity are unchanged

- [ ] **Step 9.5: Other dashboard pages**

Navigate to `/dashboard/employees`, `/dashboard/call-logs`, `/dashboard/settings`, `/dashboard/resources`, `/dashboard/templates`. Verify the wizard banner is **gone** from all of them.

- [ ] **Step 9.6: Active wizard call**

From the homepage, click "Call Wizard" inside the left card. Verify:
- Mic permission prompt fires
- Connection states render inside the card (Connecting → Live)
- The `WizardCreationCanvas` opens as before (it's still mounted globally in the layout)
- Ending the call returns the card to its idle state

---

## Self-Review

- [ ] **Spec coverage:**
  - Remove WizardBanner from every page ✓ (Task 7)
  - Split hero with two equal-weight cards ✓ (Tasks 3, 4, 5)
  - Always shown on dashboard, repositioned by employee count ✓ (Task 6)
  - Wizard inline (no popup), real-time canvas updates ✓ (Tasks 4, 7 — `WizardCreationCanvas` stays mounted)
  - Templates page unchanged ✓ (Task 1 only refactors data location)
  - Other dashboard pages keep their behavior except for banner removal ✓ (Task 7)

- [ ] **Placeholder scan:** No `TBD`/`TODO`/`fill in details`. Every code block is complete code. Every test has an assertion.

- [ ] **Type/name consistency:** Component names (`DashboardSplitHero`, `WizardCallCard`, `TemplateCarouselCard`), prop names (`templates`, `variant`), and file paths are stable across all tasks.
