# Dashboard Split Hero — Design Spec

**Date:** 2026-05-04
**Status:** Approved (brainstorm)
**Owner:** Jon Gray

## Problem

The dashboard has two creation paths (template browser, voice wizard) and they're presented unequally:

- The "Setup Wizard" banner is mounted globally in `app/dashboard/layout.jsx` and shows on every dashboard page (employees, call-logs, templates, settings, resources). It's noisy on pages where creating an agent isn't the user's intent.
- The dashboard home has a "Create Employee" quick action that opens an empty form modal. Users expect it to lead somewhere they can pick a starting point — most reasonably the templates page.
- The two paths (wizard vs templates) are scattered: wizard in the global banner, templates as a separate quick action. The choice isn't obvious on entry.

## Goals

1. Present "wizard" and "template" as two equal-weight, clearly distinct creation doors on the dashboard home.
2. Remove wizard UI from non-home dashboard pages so only the home is responsible for the "create" entry point.
3. Keep the wizard call experience inline (no popup) so the dashboard updates in real time during the call — a constraint already encoded in `WizardCreationCanvas`.
4. Adapt placement so the hero is prominent for new accounts and unobtrusive for accounts that already have employees.

## Non-Goals

- Redesigning the wizard call itself (mic preflight, SDK lifecycle, SWAIG, transcript, etc.) — only the trigger moves.
- Redesigning the templates page itself.
- Mobile-first refactor of the dashboard (responsive stacking is included; ground-up mobile redesign is not).

## Architecture

### Component map

```
app/dashboard/
├── layout.jsx                    EDIT  remove <WizardBanner /> mount
│                                       keep <WizardCreationCanvas /> mount
├── page.jsx                      EDIT  insert <DashboardSplitHero />,
│                                       remove getting-started hero,
│                                       remove "Create Employee" + "Browse Templates"
│                                       quick actions
└── components/
    └── DashboardSplitHero.jsx    NEW   the two-column hero
        ├── WizardCallCard.jsx    NEW   left column — owns wizard call trigger
        └── TemplateCarouselCard.jsx NEW right column — template strip + "Browse all"

components/dashboard/
├── WizardBanner.jsx              KEEP  no longer mounted globally; logic
│                                       extracted/reused by WizardCallCard
└── WizardCreationCanvas.jsx      UNCHANGED  stays globally mounted in layout
```

### Wizard call wiring

The current `WizardBanner` owns the call lifecycle (mic preflight, SignalWire SDK setup, session-log POSTs, broadcasting `WIZARD_*` events to `WizardCreationCanvas` via `window`). The split hero must preserve that behavior exactly.

Implementation choice: extract the call-lifecycle logic from `WizardBanner.jsx` into a hook (e.g., `useWizardSession`) that both `WizardCallCard.jsx` and the legacy `WizardBanner` can consume. `WizardBanner` itself stays in the codebase but is no longer mounted; if no consumers remain, it can be removed in a follow-up.

If extraction is non-trivial (the banner state is deeply local), an acceptable interim is to render `<WizardBanner />` *inside* `WizardCallCard.jsx` as a child — the banner becomes a sub-component of the new card. This keeps the spec simple but produces nested visual chrome that the implementer should clean up. Prefer extraction.

### Layout contract

`DashboardSplitHero` is a self-contained component that:

- Renders a 50/50 grid on `lg:` and stacks vertically below `lg:`.
- Has no awareness of position (top vs bottom) — the parent (`page.jsx`) decides where to render it based on `stats.totalEmployees`.
- Exposes no props in v1 except `templates` (array passed from the dashboard data load) so it can render the carousel without re-fetching.

### Position rule (in `page.jsx`)

```
const isFirstTime = !loading && stats.totalEmployees === 0;

return (
  <div className="max-w-7xl mx-auto space-y-8">
    {isFirstTime && <DashboardSplitHero templates={templates} />}
    <StatsGrid />
    <RecentActivity />
    {!isFirstTime && <DashboardSplitHero templates={templates} />}
  </div>
);
```

The hero is always on the dashboard home — only its position changes.

## Visual Design

Split hero, equal columns, total height roughly matches the current "Getting Started" hero so vertical rhythm is preserved.

### Left column — `WizardCallCard`

- Subtle blue gradient background (`linear-gradient(180deg, #0A0A0A, #091333)`) to mark it as the "voice" path
- Mono label: `PATH A` in `#5478F8`
- Title: **Build by voice**
- Body: "Call the wizard. It interviews you and creates an employee in about a minute."
- Large circular mic affordance (`#2553F4`, ~64px)
- Primary CTA: `CALL WIZARD` (mono, uppercase, blue)
- During an active call, the card shows the same status states the current banner does (mic-preflight, dialing, in-call, ended). Visual chrome is updated to fit the card; underlying state machine is unchanged.

### Right column — `TemplateCarouselCard`

- Standard card background (`#0A0A0A` over `#1F1F1F` border)
- Mono label: `PATH B`
- Title: **Pick a template**
- Body: "Start from a pre-built agent and customize."
- Horizontal scrollable strip of up to 4 template tiles (each tile shows a small preview/title/role)
- Trailing tile: `BROWSE ALL N →` ghost button linking to `/dashboard/templates`
- The right column is the only path to templates from the homepage; the existing "Browse Templates" quick action is removed

### Mobile / narrow

- Below `lg:`, columns stack vertically. Wizard on top, templates below.
- The mic affordance shrinks; the carousel keeps horizontal scroll.

## Data Flow

1. `page.jsx` loads dashboard data (employees, calls, templates) — same as today.
2. `DashboardSplitHero` receives `templates` as a prop; no separate fetch.
3. Clicking `Call Wizard` triggers the same `WIZARD_*` event flow that exists today — `WizardCreationCanvas` (still globally mounted in layout) reacts and renders the in-call canvas as it does now.
4. After the wizard creates an employee, the existing post-call refresh path causes `stats.totalEmployees` to change; the hero will then render at the bottom on next render.

## Routes That Change

| Route                          | Change |
|--------------------------------|--------|
| `/dashboard` (home)            | New split hero, removed "Getting Started" + "Welcome back" + "Create Employee" + "Browse Templates" quick actions |
| `/dashboard/employees`         | No more `<WizardBanner />` — page is unchanged otherwise |
| `/dashboard/call-logs`         | No more `<WizardBanner />` |
| `/dashboard/templates`         | Unchanged |
| `/dashboard/settings`          | No more `<WizardBanner />` |
| `/dashboard/resources`         | No more `<WizardBanner />` |

## Error Handling

- If the templates fetch fails: `TemplateCarouselCard` renders the title/body and a single "Browse all →" link (no thumbnails). It does NOT block the wizard card.
- If the wizard call session fails to start: same behavior the current `WizardBanner` has — show error state inside the card, do not block templates.
- If `stats` is still loading: render the hero at the top (treat as `isFirstTime`) until data arrives. This avoids a layout shift from bottom→top once data loads on a new account.

## Testing

| Test | What it covers |
|------|---|
| Unit: `DashboardSplitHero.test.jsx` | Renders both columns; clicking wizard CTA fires the wizard-call event; clicking "Browse all" navigates to `/dashboard/templates` |
| Unit: `WizardCallCard.test.jsx` | Mic preflight states; CTA disabled while in-call; error state rendered |
| Unit: `TemplateCarouselCard.test.jsx` | Renders ≤4 templates, fallback when 0, "Browse all N" pluralization |
| Integration (existing): `wizard-flow.test.jsx` | Updated to mount the hero instead of `<WizardBanner />` standalone — confirms full flow still works |
| Integration: `dashboard-positioning.test.jsx` | Hero appears at top when employees=0; at bottom when >0 |

## Migration / Rollout

Single PR:
1. Extract wizard call lifecycle into `useWizardSession` hook
2. Add `DashboardSplitHero`, `WizardCallCard`, `TemplateCarouselCard`
3. Edit `dashboard/layout.jsx` — remove `<WizardBanner />` mount
4. Edit `dashboard/page.jsx` — wire hero, remove old hero blocks and quick actions
5. Update `wizard-flow.test.jsx` and add the new tests
6. If `WizardBanner` ends up with no consumers, delete it in a follow-up commit (keep the diff small in the main PR)

No backwards-compat shims, no feature flag — this is a UI rearrangement, not a behavior change.

## Open Questions

None at design time.
