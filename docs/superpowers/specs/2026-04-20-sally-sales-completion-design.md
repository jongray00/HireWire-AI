# Sally Sales Completion Plan — Design Spec

**Date:** 2026-04-20
**Type:** Demo/workshop application for showcasing SignalWire AI voice capabilities
**Approach:** Wizard-Driven Architecture (Top-Down)

---

## Context

Sally Sales is a full-stack AI voice agent management application. Users create virtual AI employees, call them via WebRTC, and see call analytics. The app demonstrates SignalWire's Fabric API, SWML, SWAIG functions, and real-time events.

**Current state:** ~102 source files, 37 API routes, 32 React components, Python agent backend, SQLite persistence, JWT session system. 30+ modified files and 20+ new untracked files from an in-flight session migration. The app is working as of today.

**Stack:**
- Frontend: React Router v7 + Hono server, Vite, Tailwind, Chakra UI, Zustand, React Query
- Backend: Python, FastAPI, signalwire-agents SDK
- Database: SQLite (better-sqlite3) via `src/lib/db.ts`
- Auth: JWT session cookies via `src/lib/session.ts`
- Testing: Vitest + Testing Library (only call-logs tested so far)

---

## Goal

Complete the application across 5 phases, culminating in a flagship feature: a **voice-driven AI wizard** that builds other AI agents through conversation while updating the dashboard in real-time. Each phase delivers a working demo milestone.

---

## Phase Overview

| Phase | Name | Delivers | Demo Milestone |
|-------|------|----------|----------------|
| 1 | Checkpoint & Stabilize | Commit in-flight work, verify all features | "Everything works, now committed" |
| 2 | Agent Pipeline Formalization | Clean lifecycle API, event protocol, config schema | "Agents managed through a solid pipeline" |
| 3 | Wizard Agent | Voice-driven agent builder with live UI | "Call an AI, watch it build agents on screen" |
| 4 | Test Coverage | Unit + API + integration tests | "Nothing breaks between demos" |
| 5 | Demo Polish | Animations, error recovery, demo tooling | "Smooth, impressive, no rough edges" |

---

## Phase 1: Checkpoint & Stabilize

### Goal
Commit the 50+ modified/untracked files as a clean checkpoint. Verify every feature works end-to-end.

### Steps

1. **Commit the in-flight session migration** — JWT session work, webhook reconciliation, call widget improvements, dashboard API-backed data, all new routes. Single checkpoint commit.

2. **Verify all 11 features:**
   - Create an employee agent with custom prompt
   - Make a WebRTC call to the agent
   - Check call logs populate with post-prompt data
   - Upload a knowledge base document
   - Assign a phone number to an agent
   - Test SMS function during call
   - Test email function during call
   - Verify live transcription during call
   - Check multi-employee dashboard stats
   - Test settings/domain page
   - Test resource management (create/update SignalWire resources)

3. **Fix broken credential paths** — the session migration touched ~20 API routes. Ensure no route still reads from localStorage when it should use the JWT session (or vice versa).

4. **Add `test` script to package.json** — wire up `vitest run` so `npm test` works.

### Exit Criteria
- Clean git state (all work committed)
- App starts (both Python agent and web frontend)
- All 11 features work manually
- `npm test` runs existing call-logs tests and passes

---

## Phase 2: Agent Pipeline Formalization

### Goal
Create a unified, well-defined pipeline for creating/updating/previewing agents. Currently the creation logic is scattered across multiple endpoints, localStorage, SQLite, and the Python backend. This phase consolidates it into a server-side orchestration layer that both the UI and the wizard can use.

### 2A: Unified Agent Lifecycle API

```
POST   /api/agents          → create agent (validate → Python backend → SignalWire resource → SQLite)
GET    /api/agents           → list all agents (SQLite, enriched with Python backend status)
GET    /api/agents/:id       → get single agent with full details
PATCH  /api/agents/:id       → update agent (sync Python + SignalWire + SQLite)
DELETE /api/agents/:id       → tear down agent (Python + SignalWire + SQLite)
GET    /api/agents/:id/preview → preview what agent would look like without creating
```

Replaces the current pattern where the dashboard manually calls `/api/signalwire/create-resource` + `/api/create-employee` + localStorage sync in sequence.

### 2B: Real-Time Event Protocol

Formalized `swml_user_event` types for wizard and general use:

| Event Type | Payload | UI Effect |
|------------|---------|-----------|
| `agent_preview` | `{ name, role, prompt_summary, voice, functions[] }` | Shows preview card on dashboard |
| `agent_created` | `{ employee: {...} }` | Animates new agent into the list |
| `agent_updated` | `{ employee: {...}, changes[] }` | Highlights changes on agent card |
| `agent_config_question` | `{ question, options[], field }` | Shows wizard question + choices on screen |
| `agent_ready` | `{ employee_id, call_address }` | Shows "ready to call" with call button |

Browser listens on existing `client.on('userInput', ...)` channel.

### 2C: Agent Configuration Schema

Shared contract between wizard, UI forms, and Python backend:

```javascript
{
  name: string,
  role: string,
  greeting: string,
  prompt: string,
  voice: string,           // "openai.nova", "openai.alloy", etc.
  language: string,         // "en-US", "es-419", etc.
  temperature: number,      // 0.0 - 1.0
  functions: string[],      // ["transfer_to_human", "send_summary_sms", ...]
  transfer_number?: string,
  sms_from_number?: string,
  business_hours?: { start: number, end: number, days: number[] },
  knowledge_docs?: string[],
  email_config?: { sendgrid_key: string, from_address: string, from_name: string }
}
```

Used for validation in the API, wizard SWAIG functions, and employee form UI.

### Exit Criteria
- Unified `/api/agents/*` endpoints work end-to-end
- Event protocol defined and tested with a manual user_event
- Existing employee page uses the new endpoints
- Python backend employee CRUD unchanged (the orchestration layer calls it)

---

## Phase 3: Wizard Agent

### Goal
A voice-callable AI agent that collaboratively builds other agents through conversation, with live UI previews appearing on the dashboard.

### 3A: Wizard Agent (Python Backend)

New `WizardAgent` class alongside `VirtualEmployeeAgent`, mounted at `/swml/wizard`.

**Personality:** Setup wizard that asks focused questions, synthesizes agent configs, shows previews, and asks for approval before creating. (Prompt details to be refined when this phase begins.)

**SWAIG Functions:**

| Function | Purpose | Triggers Event |
|----------|---------|---------------|
| `preview_agent` | Shows preview card on dashboard | `agent_preview` |
| `ask_config_question` | Displays question with options on UI | `agent_config_question` |
| `create_agent` | Creates agent via Phase 2 pipeline | `agent_created` |
| `update_agent_preview` | Modifies preview based on user feedback | `agent_preview` (updated) |
| `finalize_agent` | Confirms creation, shows "ready to call" | `agent_ready` |
| `list_available_functions` | Returns available SWAIG capabilities | (internal, no event) |

**Example conversation flow:**
```
Wizard: "Hey! I'm your setup wizard. Tell me about the agent you want to build."
User:   "I need a support agent for a software company"
        → ask_config_question({ question: "What should it handle?",
            options: ["Bug reports", "Billing", "Account access", "General questions"] })
        → UI shows question with clickable options
User:   "Bug reports and billing"
        → preview_agent({ name: "Support Agent", role: "Technical Support",
            functions: ["collect_customer_info", "check_business_hours", "transfer_to_human"] })
        → UI shows preview card animating in
Wizard: "Here's what I've got — you can see it on your screen. Want email follow-ups?"
User:   "Add email, make the voice more professional"
        → update_agent_preview({ voice: "openai.alloy", add_functions: ["send_email"] })
        → UI preview card updates live
Wizard: "Looking good! Ready to create it?"
User:   "Yeah, do it"
        → create_agent({...full config...})
        → finalize_agent({ employee_id: "xxx" })
        → UI replaces preview with real agent card + "Call Now" button
```

### 3B: Wizard UI Panel

A panel/overlay on the dashboard that activates during wizard calls:

- **Call button** — "Call Setup Wizard" prominently on dashboard, uses `useCallWidget` hook
- **Preview area** — preview cards appear on `agent_preview` events showing name, role, voice, functions as badges, prompt summary
- **Question overlay** — `agent_config_question` shows question with clickable option buttons as visual aid (user still answers by voice)
- **Transition** — `agent_created` transforms preview into real agent card with celebration animation
- **Call new agent** — `agent_ready` shows "Call Now" button

### 3C: Click Bridge (Stretch Goal)

Optional: clicking an option in the question overlay sends text injection into the call so users can answer by clicking. Useful in noisy demo environments. Not required for v1.

### Exit Criteria
- Call the wizard, converse about what agent to build
- See previews appear on dashboard in real-time
- Approve creation, agent appears in employee list
- Immediately call the new agent from the dashboard
- Full loop works in a single demo session

---

## Phase 4: Test Coverage

### Goal
Tests protecting the demo-critical happy paths. Not exhaustive — focused on what would break a live demo.

### 4A: API Route Tests

Test route handlers directly with mock Request objects. Mock SignalWire Fabric API and Python backend calls.

| Suite | Coverage |
|-------|----------|
| `agents.test.js` | Create, read, update, delete via `/api/agents/*` — full orchestration |
| `session.test.js` | JWT creation, verification, expiry, cookie handling |
| `auth-middleware.test.js` | `requireAuth()` blocks, `optionalAuth()` passes |
| `post-prompt.test.js` | Webhook receives call data, stores in SQLite |
| `widget-token.test.js` | Token generation, subscriber reuse |
| `webhook-reconciliation.test.js` | Stale webhook detection, domain correction |

### 4B: Component Tests

Extend existing call-logs tests to other features:

| Suite | Coverage |
|-------|----------|
| `employee-form.test.jsx` | Form fill, submit, validation |
| `dashboard-stats.test.jsx` | Stats cards render with mock data |
| `wizard-panel.test.jsx` | Preview card on events, question overlay, creation transition |
| `call-widget.test.jsx` | Hook lifecycle, cleanup states, stale webhook detection |
| `settings-page.test.jsx` | Domain configuration, credential display |

### 4C: Integration / Smoke Tests

| Suite | Coverage |
|-------|----------|
| `wizard-flow.test.js` | Full event sequence: question → preview → created → ready |
| `agent-lifecycle.test.js` | Create → list → update → delete |
| `call-log-ingestion.test.js` | Post-prompt webhook → appears in dashboard query |

### Not Testing (Intentional)
- Every possible SignalWire API failure mode
- Auth edge cases (token refresh, concurrent sessions)
- Browser compatibility
- Load/stress testing
- Python agent unit tests (SDK handles most of that)

### Exit Criteria
- `npm test` runs all suites and passes
- Broken wizard, agent creation, or call flow would be caught

---

## Phase 5: Demo Polish

### Goal
Make every interaction smooth and impressive on stage. No hanging spinners, confusing states, or "let me refresh" moments.

### 5A: Loading & Transition States
- Agent creation: skeleton card with shimmer → slides into real card
- Wizard preview: cards fade/slide in, updates crossfade
- Call connection: "connecting..." → "ringing..." → "connected" visual states
- Dashboard data: skeleton loaders on stats cards, not blank space

### 5B: Error Recovery (Demo-Critical Only)
- Python agent down: banner "Agent backend offline" + retry button
- Call fails: clear error + "Try Again" button
- Webhook mismatch: auto-reconcile + toast notification

### 5C: Wizard Demo Flow
- Prominent wizard call button on dashboard
- Dashboard dims during wizard call, preview area highlighted
- Celebration animation when agent created
- "Call your new agent now" CTA after creation
- Wizard supports creating multiple agents in one call

### 5D: Demo Script & Reset
- **Reset button** — clears employees, call logs, settings to clean state. Hidden in "Demo Tools" menu.
- **Seed data** — pre-populate with 2-3 example agents and call log data so dashboard looks alive before wizard demo.

### Exit Criteria
- Full demo loop runs smoothly: login → dashboard with seed data → call wizard → build agent → call new agent → show call logs
- No awkward pauses, blank screens, or unhandled error states

---

## Architecture Decisions

1. **Wizard is a separate Python agent class** — not a mode of VirtualEmployeeAgent. Clean separation, own prompt, own SWAIG functions.
2. **Unified `/api/agents/*` replaces scattered endpoints** — single orchestration layer, server-side. Both UI and wizard use the same pipeline.
3. **Real-time events over existing `userInput` channel** — no new transport needed. Formalized event types with typed payloads.
4. **Tests focus on demo paths** — not production coverage. If it would break a live demo, it has a test.
5. **No new auth hardening** — JWT sessions are sufficient for a demo app. No refresh tokens, rate limiting, or multi-tenant isolation.

---

## File Impact Summary

### New Files (Estimated)
- `web/src/app/api/agents/route.js` — unified CRUD endpoint
- `web/src/app/api/agents/[id]/route.js` — single agent operations
- `web/src/app/api/agents/[id]/preview/route.js` — preview endpoint
- `agent/wizard.py` — WizardAgent class (or added to main.py)
- `web/src/components/dashboard/WizardPanel.jsx` — wizard UI panel
- `web/src/components/dashboard/AgentPreviewCard.jsx` — preview card component
- `web/src/components/dashboard/QuestionOverlay.jsx` — wizard question display
- ~12 test files across phases 4A/4B/4C

### Modified Files (Estimated)
- `agent/main.py` — mount WizardAgent, add wizard SWAIG functions
- `web/src/app/dashboard/employees/page.jsx` — use `/api/agents/*` endpoints
- `web/src/app/dashboard/page.jsx` — wizard call button, event listeners
- `web/src/app/hooks/useCallWidget.js` — possibly extend for wizard events
- `web/package.json` — add test script
