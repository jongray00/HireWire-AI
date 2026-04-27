# Sally Sales

A SignalWire AI voice-agent demo. Build virtual employees by talking to a voice-driven setup wizard, then call those employees from the browser via WebRTC.

## What it does

- **Setup Wizard** — A persistent banner on every dashboard page lets you call a wizard agent that builds new agents through conversation. Watch each new employee appear on the dashboard in real time.
- **Virtual Employees** — Each employee is its own SWML agent with a configurable prompt, voice, business hours, knowledge base (DataSphere RAG), email follow-ups, and customer-info capture.
- **Call Logs** — Post-prompt webhooks persist transcripts, AI summaries, sentiment, and latency metrics. The detail view renders per-action sections (KB hits, emails sent, info collected).
- **Browser Calling** — `@signalwire/js` over WebRTC. One persistent subscriber per session; reuses tokens across calls.

## Architecture

```
Browser (React Router 7 + @signalwire/js)
  ├─ /login          — credential entry
  └─ /dashboard      — employees, call-logs, resources, settings, templates
                        ↑ WizardBanner (inline call, SDK-direct, no popup widget)
       │
       │  WebRTC + Fabric API
       ▼
SignalWire Cloud
  ├─ Fabric subscribers/tokens
  └─ SWML fetch + SWAIG callbacks
       │  HTTPS (via ngrok in dev)
       ▼
Python Agent (FastAPI + signalwire-agents SDK)
  ├─ /swml/{employee_id}            — per-employee SWML
  ├─ /swaig/{employee_id}/{fn}      — function calls
  ├─ /api/post-prompt/{employee_id} — call logging
  └─ SQLite (better-sqlite3 in web; agent reads via API)
```

## Quick Start

**Backend:**
```bash
cd agent
pip install -r requirements.txt
python main.py            # listens on :8000
ngrok http 8000           # the agent auto-detects the public URL
```

**Frontend:**
```bash
cd web
npm install
npm run dev               # http://localhost:5000
```

Then open the frontend, log in, and click **Call Now** on the wizard banner. Full demo walkthrough is in `docs/DEMO_SCRIPT.md`.

## Layout

```
agent/                     Python FastAPI backend
  main.py                  Multi-employee SWML server, SWAIG functions, post-prompt
web/
  src/app/
    dashboard/             Employees, call-logs, resources, settings, templates pages
    api/                   React Router server routes (agents CRUD, signalwire proxies, post-prompt, demo tools)
    hooks/
      useWizardCall.js     Direct SignalWire SDK integration for the inline wizard banner
      useCallWidget.js     Popup call-widget hook for non-wizard calls
  src/components/dashboard/
    WizardBanner.jsx       Idle CTA + active inline call banner
    KnowledgeBaseTab.jsx   DataSphere document upload + per-doc config
    CallLogDetail.jsx      Expanded log with conditional action sections
docs/
  DEMO_SCRIPT.md           Step-by-step demo walkthrough
  superpowers/plans/       Implementation plans (the latest is holistic-completion)
  archive/                 Historical implementation summaries
```

## Tests

```bash
cd web && npm test
```

Vitest runs the frontend suite (component, schema, API route, and wizard-flow integration tests).

## Tech

React Router 7 · Vite · Tailwind · `@signalwire/js` · better-sqlite3 · jose JWT · Python FastAPI · `signalwire-agents` SDK · SignalWire DataSphere · SendGrid · Vitest

## License

MIT
