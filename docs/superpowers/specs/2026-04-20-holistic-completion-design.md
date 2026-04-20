# Sally Sales Holistic Completion — Design Spec

**Date:** 2026-04-20
**Type:** Demo/workshop application — all remaining work
**Builds on:** `2026-04-20-sally-sales-completion-design.md` (original spec)

---

## Context

The original 5-phase plan (stabilize → pipeline → wizard → tests → polish) is ~70% complete. Core features work but the wizard UX needs redesign (inline banner, not popup), RAG has bugs, and demo polish is incomplete.

---

## Phase A: Wizard UX Redesign (Demo-Critical)

### Goal
Replace the popup call widget with an inline banner in the dashboard layout. The wizard video stays small and accessible while the dashboard remains fully visible — users watch agents appear in real-time.

### Design

**Idle state:** Slim CTA bar at top of main content area in `dashboard/layout.jsx`:
```
🧙 Setup Wizard — Build agents with your voice              [Call Now]
```

**Active state:** Bar expands into a banner with three sections:
- **Left (120px):** Small video element from SignalWire JS SDK, mic indicator
- **Center:** Question/preview area (reuses wizard event handling — questions with clickable options, preview cards, creation confirmation)
- **Right:** End call / close button

**Technical approach:**
- New hook `useWizardCall` — wraps `@signalwire/js` SDK directly. Creates client, dials `/public/wizard-agent`, mounts audio/video into a ref'd div. No popup widget.
- New component `WizardBanner` — contains both idle CTA and active banner states. Handles wizard events inline.
- Mounted in `dashboard/layout.jsx` so it persists across all pages (employees, call logs, settings, etc.)
- Remove old wizard button from `dashboard/page.jsx` and popup-based `useCallWidget` wizard integration.
- `agent_created` event triggers employee list refresh on whatever page is active.

### Files
- Create: `web/src/app/hooks/useWizardCall.js`
- Create: `web/src/components/dashboard/WizardBanner.jsx`
- Modify: `web/src/app/dashboard/layout.jsx` — add WizardBanner
- Modify: `web/src/app/dashboard/page.jsx` — remove old wizard button/panel
- Modify: `web/src/components/dashboard/WizardPanel.jsx` — may be absorbed into WizardBanner or kept as sub-component

---

## Phase B: RAG & Agent Quality (Demo-Critical)

### Goal
Fix bugs that would cause demo failures and improve knowledge base quality.

### Items

1. **Fix tool-name collision** — `agent/main.py` `_configure_functions()` calls `add_skill("datasphere_serverless", {...})` per document without unique `tool_name`. Set `tool_name: f"search_{doc_id[:8]}"` per doc.

2. **Fix distance threshold** — Change default from `5.0` to `3.0`. Make configurable per-document in employee config. Add `distance` field to KB document config in frontend.

3. **Fix silent credential failure** — When DataSphere credentials are missing, surface `knowledge_status: "misconfigured"` on the employee object. Frontend shows warning badge on KB tab.

4. **Add KB voice fillers** — Pass `swaig_fields.fillers` with "Searching our knowledge base..." and similar when adding datasphere_serverless skill.

5. **Per-document description/routing** — Store name/description per doc. Inject prompt section listing which KB to search for what topics when multiple docs exist.

6. **Validate document_id at create-time** — Hit DataSphere search API with a no-op query when adding a doc. Surface error in UI if doc ID is invalid.

### Files
- Modify: `agent/main.py` — `_configure_functions()` method, datasphere skill setup
- Modify: `web/src/app/dashboard/employees/page.jsx` — KB tab warning badge
- Modify: `web/src/components/dashboard/KnowledgeBaseTab.jsx` — distance config, validation

---

## Phase C: Demo Polish (Visual Quality)

### Goal
Loading states, animations, and error recovery that make the demo feel polished on stage.

### Items

1. **Skeleton loaders** — Dashboard stats cards show skeleton placeholder during fetch, not blank space.
2. **Agent creation animation** — When wizard creates an agent, the employee card shimmers in with a slide animation.
3. **Celebration moment** — Brief glow/sparkle effect when `agent_created` fires in the WizardBanner.
4. **"Call your new agent now" CTA** — Prominent button in the WizardBanner after agent is created, calls the new agent directly.
5. **Error recovery UI** — Banner at top when Python backend health check fails: "Agent backend offline — Retry". Call failure: clear error + "Try Again".
6. **Call connection states** — Visual indicator in WizardBanner: connecting → ringing → connected.

### Files
- Modify: `web/src/app/dashboard/page.jsx` — skeleton loaders, error banner
- Modify: `web/src/components/dashboard/WizardBanner.jsx` — celebration, CTA, connection states
- Modify: `web/src/app/dashboard/employees/page.jsx` — agent creation animation
- Modify: `web/src/app/dashboard/layout.jsx` — backend health check + error banner

---

## Phase D: Test Coverage & Documentation

### Goal
Tests protecting demo-critical paths, plus a demo walkthrough script.

### Items

1. **Agent CRUD tests** — `/api/agents` create, list, get, update, delete with mocked fetch/DB
2. **Post-prompt webhook tests** — Receives call data, stores in SQLite correctly
3. **Widget token tests** — Subscriber reuse, token generation flow
4. **Wizard flow integration test** — Simulates event sequence: question → preview → created → ready, verifies WizardBanner state transitions
5. **Demo walkthrough script** — Step-by-step instructions for running the full demo

### Files
- Create: `web/src/app/api/agents/__tests__/route.test.js`
- Create: `web/src/app/api/__tests__/post-prompt.test.js`
- Create: `web/src/app/api/signalwire/__tests__/widget-token.test.js`
- Create: `web/src/components/dashboard/__tests__/WizardBanner.test.jsx`
- Create: `docs/DEMO_SCRIPT.md`

---

## Excluded (Not Worth It for Demo App)

- Native vector search alternative backend
- Tiered retrieval / fallback chain
- Query logging for RAG tuning
- Advanced RAG params UI (tags, language, pos_to_expand, max_synonyms)
- Click bridge text injection into call
- Settings page tests
- Full browser compatibility testing
