# HireWire ⇄ HireWire-AI Unification via "Wizard Mode" Toggle

**Date:** 2026-05-08
**Author:** jongray00 (with Claude)
**Status:** Draft, pending user review

## Problem

Two repos exist:

- `jongray00/HireWire-AI` — actively developed; ~50 commits ahead of HireWire; includes the wizard plus a large amount of unrelated work (dashboard split-hero, employees rewrite, call-logs detail rewrite, settings page, templates, new API routes, tests).
- `jongray00/HireWire` — essentially the initial "Sally Sales / HireWire AI voice agent" commit plus a few chore commits.

The original framing — "make HireWire identical to HireWire-AI minus the wizard" — implies an ongoing port pipeline. The cheapest durable answer is to collapse the two into one codebase and turn the wizard into a runtime user setting.

## Goals

1. One codebase (`HireWire-AI`) is the single source of truth.
2. The wizard becomes a user-toggleable setting on the existing Settings page ("Wizard Mode").
3. Default state for a fresh install is **OFF**, so a clean install matches the "HireWire" experience without configuration.
4. The toggle gates **client UI only on the Dashboard page**. Server-side wizard infrastructure stays mounted unconditionally.
5. The standalone `jongray00/HireWire` repo is archived on GitHub.

## Non-Goals

- No rebranding (logo, name, colors) when wizard is off — branding is identical in both states.
- No build-time / env-var gating — runtime only, because the toggle must be user-controllable from the UI.
- No migration of HireWire's branches, code, or issues to HireWire-AI. HireWire is the older, less-developed copy; nothing in it needs to come back.
- No per-user accounts/scopes for the toggle — uses the existing global `app_settings` table (the codebase is not multi-tenant today).

## Architecture

### Data layer

A new row in the existing `app_settings` SQLite table:

```
key = "wizard_mode_enabled"
value = "false"  -- default for fresh installs; absent row also treated as false
```

No schema migration required (`app_settings` is already `(key, value, updated_at)`).

### API layer

New endpoint pair:

- `GET /api/settings/wizard-mode` → `{ enabled: boolean }`. Returns `false` if row missing.
- `PUT /api/settings/wizard-mode` body `{ enabled: boolean }` → upserts row, returns `{ enabled }`.

Implemented as `web/src/app/api/settings/wizard-mode/route.js` following the existing `api/settings/domain/` pattern.

### Client layer

- `web/src/app/hooks/useWizardMode.js` — exposes `{ enabled, loading, setEnabled }`. Fetches once on mount; `setEnabled` does optimistic update + PUT, reverts on failure.
- `web/src/app/dashboard/settings/page.jsx` — adds a "Wizard Mode" card with toggle and one-paragraph description.
- `web/src/app/dashboard/page.jsx` — calls `useWizardMode()` and passes `enabled` to `DashboardSplitHero` as a prop.
- `web/src/components/dashboard/DashboardSplitHero.jsx` — accepts `wizardEnabled` prop. When `true`, renders the existing two-column layout (`WizardCallCard` left, `TemplateCarouselCard` right). When `false` (or while loading), renders only `TemplateCarouselCard` full-width.

### Server-side wizard code stays untouched

All of the following remain in the codebase, unmodified:

- `web/src/components/dashboard/WizardBanner.jsx`, `WizardCallCard.jsx`, `WizardCreationCanvas.jsx`
- `web/src/app/hooks/useWizardCall.js`
- `web/src/lib/wizardEvents.js`
- `web/src/app/api/signalwire/wizard-session-log/route.js`
- `agent/main.py` wizard router
- Wizard-related fields in `agentSchema.js` and `db.ts`

Rationale: the toggle is a render gate, not a feature deletion. Keeping server endpoints mounted means flipping the toggle has no risk of half-broken state, and the wizard JS code being shipped (un-tree-shaken) is a negligible cost relative to the avoided complexity.

## Data Flow

```
Settings page mount
  └─→ GET /api/settings/wizard-mode  →  reads app_settings row
       └─→ returns { enabled: bool }  (false if row missing)

Toggle clicked
  └─→ optimistic UI flip
  └─→ PUT /api/settings/wizard-mode { enabled }
       └─→ upserts row
       └─→ on error: revert UI, show toast

Dashboard mount
  └─→ useWizardMode()  →  GET /api/settings/wizard-mode
       └─→ while loading: render single-column hero (no wizard flash)
       └─→ enabled=true:  render split hero with wizard
       └─→ enabled=false: render single-column full-width hero
```

**Loading-state choice:** show single-column during initial fetch. The default is OFF for fresh installs and is expected to remain OFF for most users, so this avoids a wizard-flash in the common case. Opted-in users see the wizard appear after the first fetch resolves — acceptable, matches existing dashboard data-loading behavior.

**Cross-page reactivity:** when the user toggles the setting on the Settings page and navigates to the Dashboard, the dashboard's `useWizardMode` re-fetches on mount and reflects the new state. No global state bus required for v1. If TanStack Query is already in the app, the PUT can invalidate the relevant query key for instant cross-page sync.

## Error Handling

| Scenario | Behavior |
|---|---|
| `GET /api/settings/wizard-mode` fails | Assume `enabled=false`. Log console warning. Wizard stays hidden. User can retry from Settings. |
| `PUT /api/settings/wizard-mode` fails | Revert optimistic toggle. Show toast: "Couldn't save Wizard Mode. Try again." |
| DB row missing | Treated as `enabled=false`. Row is created on first successful PUT. |
| Invalid PUT body (non-boolean) | 400 with `{ error: "enabled must be boolean" }`. |

## Testing

**Unit:**

- `useWizardMode` hook: loading state, enabled true/false from server, server error → false, optimistic update + revert on PUT failure.
- `GET /api/settings/wizard-mode` route: row missing → `{ enabled: false }`; row present → reads value.
- `PUT /api/settings/wizard-mode` route: upserts row; rejects non-boolean body.

**Component:**

- `DashboardSplitHero` with `wizardEnabled={false}` renders only `TemplateCarouselCard` (asserted by absence of `WizardCallCard`).
- `DashboardSplitHero` with `wizardEnabled={true}` renders the two-column layout (asserted by presence of both `WizardCallCard` and `TemplateCarouselCard`).

**Integration (Vitest + RTL):**

- Dashboard page test that mocks `GET /api/settings/wizard-mode` returning `false` and asserts wizard absent.
- Same test with mock returning `true` and asserts wizard present.
- Settings page test that toggles, asserts PUT payload, and on success the local state matches.

**Manual smoke:**

- Fresh install (delete local SQLite DB) → dashboard shows single-column. Confirms default OFF.
- Settings → toggle ON → navigate to Dashboard → wizard visible.
- Settings → toggle OFF → navigate to Dashboard → wizard gone.
- Toggle while offline → optimistic flip, then revert with toast on PUT failure.

## Repo Archival

After the toggle ships and is verified:

1. Add one-line note to top of `jongray00/HireWire`'s `README.md`:
   > **Archived.** This project has been merged into [HireWire-AI](https://github.com/jongray00/HireWire-AI). Toggle "Wizard Mode" off in Settings for the original HireWire experience.
2. Commit and push to `jongray00/HireWire`.
3. Archive the repo via GitHub UI (Settings → Archive). Read-only, history preserved, URL still resolves.

No code migration required — HireWire's content is already a strict subset of HireWire-AI.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Wizard JS still ships in the bundle when disabled, increasing page weight. | Acceptable v1 cost. If/when bundle size becomes a concern, switch to `React.lazy` dynamic imports gated on the flag. |
| Server-side wizard endpoints respond even when disabled, allowing direct API hits to log wizard sessions. | Acceptable — the endpoints are not externally exposed harmful surface. If a stricter posture is wanted later, add a `wizard_mode_enabled` check at route entry. |
| User toggles the flag on Settings, navigates to Dashboard, sees stale state. | First version: dashboard re-fetches on mount, so navigation is sufficient. If "no remount" sync is needed, use TanStack Query invalidation or a `wizard-mode-changed` window event. |
| Confusion about the now-archived HireWire repo from external links. | README header redirects future readers; archived repos still serve their content. |

## Out-of-Scope / Follow-ups

- Per-user account scoping (would require multi-tenant auth work; not yet present).
- Build-time tree-shaking of wizard code when disabled (page-weight optimization, not blocking).
- Settings-page UI polish beyond a basic toggle card.
- Migrating any of HireWire's git history into HireWire-AI (not useful — HireWire is older).

## Implementation Plan

To be written next via the `superpowers:writing-plans` skill, against `docs/superpowers/plans/2026-05-08-hirewire-wizard-mode-toggle.md`.
