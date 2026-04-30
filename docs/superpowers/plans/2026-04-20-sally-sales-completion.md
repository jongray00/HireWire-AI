# Sally Sales Completion — Implementation Plan

**Status:** ✅ Implementation complete — `agentSchema.js`, `/api/agents` endpoint, the wizard agent, and dashboard pages all shipped. Step checkboxes were not back-filled; treat them as historical. The follow-up [`2026-04-20-holistic-completion.md`](./2026-04-20-holistic-completion.md) plan addressed remaining demo polish.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Sally Sales into a full demo application with a flagship voice-driven wizard agent that builds other AI agents through conversation with live dashboard previews.

**Architecture:** 5 phases building bottom-up from stabilization through a unified agent lifecycle API, the wizard agent, test coverage, and demo polish. The wizard agent is the centerpiece — it exercises the entire stack and drives the architecture of the unified API.

**Tech Stack:** React Router v7 + Hono, Vite, Tailwind, Chakra UI, better-sqlite3, jose JWT, Vitest + Testing Library, Python FastAPI + signalwire-agents SDK

**Spec:** `docs/superpowers/specs/2026-04-20-sally-sales-completion-design.md`

---

## Phase 1: Checkpoint & Stabilize

### Task 1: Commit In-Flight Work

**Files:**
- All 30+ modified and 20+ untracked files currently shown in `git status`

- [ ] **Step 1: Add the test script to package.json**

In `web/package.json`, add a `test` script:

```json
"scripts": {
  "dev": "react-router dev",
  "typecheck": "react-router typegen && tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 2: Run existing tests to confirm they pass**

Run: `cd web && npm test`
Expected: 2 test suites pass (helpers.test.js, components.test.jsx)

- [ ] **Step 3: Commit all in-flight work as a checkpoint**

```bash
cd Sally-Sales
git add -A
git commit -m "checkpoint: commit in-flight session migration, webhook reconciliation, and new features

JWT session auth, API-backed dashboard data, call widget improvements,
call logs UI, settings page, employee sync API, phone number management,
webhook reconciliation, and test infrastructure."
```

---

### Task 2: Verify Application Starts

**Files:**
- `agent/main.py` (read-only verification)
- `web/package.json` (read-only verification)

- [ ] **Step 1: Start the Python agent backend**

Run: `cd agent && python main.py`
Expected: Server starts on 0.0.0.0:8000, logs "Starting Virtual Employees Backend"

- [ ] **Step 2: Start the web frontend**

Run: `cd web && npm run dev`
Expected: Vite dev server starts on port 5000

- [ ] **Step 3: Verify health endpoints**

Run: `curl http://localhost:8000/health`
Expected: `{"status":"healthy","employees":0,...}`

Run: `curl http://localhost:5000`
Expected: HTML response (the app renders)

- [ ] **Step 4: Document any startup issues found**

If either service fails to start, note the error and fix it before proceeding. Common issues:
- Missing `web/data/` directory for SQLite: `mkdir -p web/data`
- Missing node_modules: `cd web && npm install`
- Missing Python deps: `cd agent && pip install -r requirements.txt`

---

### Task 3: Fix Credential Path Inconsistencies

**Files:**
- Audit all files under `web/src/app/api/signalwire/` for credential handling
- Modify: any route still reading credentials from request body without session fallback

The session migration moved credentials server-side into JWT cookies + SQLite. Some routes may still require credentials in the request body. Each route should:
1. Try `requireAuth(request)` first (reads JWT cookie → fetches from DB)
2. Fall back to body credentials only if no session

- [ ] **Step 1: Audit all SignalWire API routes for credential handling**

Check each route in `web/src/app/api/signalwire/` for this pattern:

```javascript
// CORRECT PATTERN — session-first with body fallback
import { requireAuth } from '@/app/api/middleware/auth';

const auth = await requireAuth(request);
let creds;
if (!auth.error) {
  creds = { spaceUrl: auth.spaceUrl, projectId: auth.projectId, apiToken: auth.apiToken };
} else {
  // Fall back to body credentials
  const body = await request.json();
  creds = body.credentials;
  if (!creds?.spaceUrl || !creds?.projectId || !creds?.apiToken) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 });
  }
}
```

Routes to check:
- `connect/route.js` — already uses session (creates the cookie)
- `widget-token/route.js` — already has dual pattern
- `create-resource/route.js` — check
- `update-resource/route.js` — check
- `list-resources/route.js` — check
- `generate-agent/route.js` — check
- `webrtc-token/route.js` — check
- `test-call/route.js` — check
- `fix-sally-webhook/route.js` — check
- `fix-employee-webhook/route.js` — check
- `reconcile-webhooks/route.js` — check
- `phone-numbers/route.js` — check
- `assign-phone-number/route.js` — check
- `test-sms/route.js` — check
- `check-domain/route.js` — check
- `agent/[subscriberId]/route.js` — check

- [ ] **Step 2: Fix any routes that lack the session-first pattern**

For each route missing session auth, add the `requireAuth` import and dual-credential pattern shown above. Do NOT change routes that already work correctly.

- [ ] **Step 3: Verify login → dashboard flow works end-to-end**

1. Open `http://localhost:5000/login`
2. Enter SignalWire credentials
3. Click Connect
4. Verify redirect to dashboard
5. Check browser DevTools → Application → Cookies for `sally_session` cookie
6. Refresh the page — should stay logged in (session persists)

- [ ] **Step 4: Commit credential fixes**

```bash
git add web/src/app/api/
git commit -m "fix: ensure all API routes use session-first auth with body fallback"
```

---

## Phase 2: Agent Pipeline Formalization

### Task 4: Agent Configuration Schema

**Files:**
- Create: `web/src/lib/agentSchema.js`

Define the shared agent configuration schema used by the unified API, the wizard, and the employee form.

- [ ] **Step 1: Create the schema file**

Create `web/src/lib/agentSchema.js`:

```javascript
/**
 * Agent Configuration Schema
 *
 * Shared contract between the wizard agent, employee form UI,
 * unified /api/agents endpoints, and the Python backend.
 */

/** All available SWAIG functions an agent can use */
export const AVAILABLE_FUNCTIONS = [
  { id: 'transfer_to_human', label: 'Transfer to Human', description: 'Transfer the call to a live agent' },
  { id: 'send_summary_sms', label: 'Send SMS Summary', description: 'Text the caller a summary after the call' },
  { id: 'schedule_callback', label: 'Schedule Callback', description: 'Schedule a callback for the caller' },
  { id: 'check_business_hours', label: 'Check Business Hours', description: 'Check if the business is currently open' },
  { id: 'collect_customer_info', label: 'Collect Customer Info', description: 'Gather contact details from the caller' },
  { id: 'send_email', label: 'Send Email', description: 'Send a follow-up email via SendGrid' },
  { id: 'end_call', label: 'End Call', description: 'Politely end the conversation' },
];

/** Default agent configuration */
export const DEFAULT_AGENT_CONFIG = {
  name: '',
  role: 'Assistant',
  greeting: 'Hello, how can I help you today?',
  prompt: '',
  voice: 'openai.nova',
  language: 'en-US',
  temperature: 0.7,
  functions: ['transfer_to_human', 'send_summary_sms', 'end_call'],
  transferNumber: '',
  smsFromNumber: '',
  businessHours: { start: 9, end: 18, days: [0, 1, 2, 3, 4] },
  knowledgeDocs: [],
  emailConfig: { sendgridKey: '', fromAddress: '', fromName: '' },
};

/**
 * Validate an agent config object. Returns { valid: true } or { valid: false, errors: string[] }.
 */
export function validateAgentConfig(config) {
  const errors = [];
  if (!config.name || typeof config.name !== 'string' || config.name.trim().length === 0) {
    errors.push('name is required');
  }
  if (!config.prompt || typeof config.prompt !== 'string' || config.prompt.trim().length === 0) {
    errors.push('prompt is required');
  }
  if (config.temperature !== undefined && (config.temperature < 0 || config.temperature > 1)) {
    errors.push('temperature must be between 0 and 1');
  }
  if (config.functions && !Array.isArray(config.functions)) {
    errors.push('functions must be an array');
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * Convert a frontend agent config to the Python backend's expected format.
 */
export function configToBackendPayload(config, extra = {}) {
  return {
    id: extra.id || undefined,
    name: config.name,
    role: config.role || 'Assistant',
    greeting: config.greeting || 'Hello, how can I help you today?',
    prompt: config.prompt,
    voice: config.voice || 'openai.nova',
    language: config.language || 'en-US',
    temperature: config.temperature ?? 0.7,
    enabled_functions: config.functions || ['transfer_to_human', 'send_summary_sms', 'end_call'],
    transfer_number: config.transferNumber || '',
    sms_from_number: config.smsFromNumber || '',
    business_hours_start: config.businessHours?.start ?? 9,
    business_hours_end: config.businessHours?.end ?? 18,
    business_days: config.businessHours?.days ?? [0, 1, 2, 3, 4],
    documents: config.knowledgeDocs || [],
    sendgrid_api_key: config.emailConfig?.sendgridKey || '',
    email_from_address: config.emailConfig?.fromAddress || '',
    email_from_name: config.emailConfig?.fromName || '',
    space_name: extra.spaceName || '',
    project_id: extra.projectId || '',
    token: extra.token || '',
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/agentSchema.js
git commit -m "feat: add shared agent configuration schema with validation"
```

---

### Task 5: Unified Agent Lifecycle API — Create & List

**Files:**
- Create: `web/src/app/api/agents/route.js`

This orchestration endpoint replaces the scattered create flow. It: validates config → creates employee in Python backend → creates SignalWire SWML resource → stores in SQLite → returns complete agent.

- [ ] **Step 1: Create the unified agents route**

Create `web/src/app/api/agents/route.js`:

```javascript
/**
 * Unified Agent Lifecycle API — List & Create
 *
 * GET  /api/agents     → list all agents (from SQLite, enriched with Python backend status)
 * POST /api/agents     → create agent (validate → Python → SignalWire → SQLite)
 */

import { requireAuth } from '@/app/api/middleware/auth';
import { getEmployeesByProject, upsertEmployee, employeeRowToJson } from '@/lib/db';
import { getBaseUrl, getSwmlWebhookUrl } from '@/app/api/utils/getBaseUrl';
import { validateAgentConfig, configToBackendPayload } from '@/lib/agentSchema';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const employees = getEmployeesByProject(auth.projectId);
  return Response.json({
    success: true,
    agents: employees.map(employeeRowToJson),
    count: employees.length,
  });
}

export async function POST(request) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const config = await request.json();

  // Validate
  const validation = validateAgentConfig(config);
  if (!validation.valid) {
    return Response.json({ error: 'Invalid config', details: validation.errors }, { status: 400 });
  }

  const employeeId = config.id || crypto.randomUUID().slice(0, 8);

  // 1. Create employee in Python backend
  const agentCredentials = getAgentCredentials();
  const backendUrl = agentCredentials?.app_domain || 'http://localhost:8000';
  const backendPayload = configToBackendPayload(config, {
    id: employeeId,
    projectId: auth.projectId,
    spaceName: auth.spaceUrl,
    token: auth.apiToken,
  });

  let pythonEmployee;
  try {
    const res = await fetch(`${backendUrl}/api/create-employee`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backendPayload),
    });
    if (!res.ok) {
      const err = await res.text();
      return Response.json({ error: 'Python backend failed', details: err }, { status: 502 });
    }
    pythonEmployee = await res.json();
  } catch (err) {
    return Response.json({ error: 'Python backend unreachable', details: err.message }, { status: 502 });
  }

  // 2. Create SignalWire SWML resource
  const swmlRoute = `/swml/${employeeId}/`;
  const webhookUrl = getSwmlWebhookUrl(request, swmlRoute);
  const resourceName = `employee-${config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${employeeId}`;

  const normalizedSpaceUrl = auth.spaceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const baseUrl = `https://${normalizedSpaceUrl}`;
  const basicAuth = Buffer.from(`${auth.projectId}:${auth.apiToken}`).toString('base64');

  let resource = null;
  let callFabricAddress = null;
  try {
    const resCreate = await fetch(`${baseUrl}/api/fabric/resources`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: resourceName,
        display_name: config.name,
        type: 'swml_webhook',
        swml_webhook: { url: webhookUrl },
      }),
    });
    if (resCreate.ok) {
      resource = await resCreate.json();
      callFabricAddress = `/public/${resourceName}`;
    } else {
      console.warn('[agents/create] SignalWire resource creation failed, agent still usable via direct SWML URL');
    }
  } catch (err) {
    console.warn('[agents/create] SignalWire resource creation error:', err.message);
  }

  // 3. Store in SQLite
  upsertEmployee({
    id: employeeId,
    projectId: auth.projectId,
    name: config.name,
    role: config.role,
    greeting: config.greeting,
    prompt: config.prompt,
    voice: config.voice,
    language: config.language,
    temperature: config.temperature,
    enabledFunctions: config.functions,
    transferNumber: config.transferNumber,
    smsFromNumber: config.smsFromNumber,
    businessHoursStart: config.businessHours?.start,
    businessHoursEnd: config.businessHours?.end,
    businessDays: config.businessHours?.days,
    documents: config.knowledgeDocs,
    sendgridApiKey: config.emailConfig?.sendgridKey,
    emailFromAddress: config.emailConfig?.fromAddress,
    emailFromName: config.emailConfig?.fromName,
    resourceId: resource?.id || null,
    resourceName: resourceName,
    callFabricAddress: callFabricAddress,
    webhookUrl: webhookUrl,
    status: 'active',
  });

  return Response.json({
    success: true,
    agent: {
      id: employeeId,
      ...config,
      resourceId: resource?.id || null,
      resourceName,
      callFabricAddress,
      webhookUrl,
      swmlRoute: pythonEmployee.swml_route,
    },
  }, { status: 201 });
}

function getAgentCredentials() {
  try {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    return JSON.parse(readFileSync(join(process.cwd(), 'agent-credentials.json'), 'utf-8'));
  } catch { return null; }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/app/api/agents/route.js
git commit -m "feat: add unified /api/agents endpoint for create and list"
```

---

### Task 6: Unified Agent Lifecycle API — Get, Update, Delete

**Files:**
- Create: `web/src/app/api/agents/[id]/route.js`

- [ ] **Step 1: Create the single-agent route**

Create `web/src/app/api/agents/[id]/route.js`:

```javascript
/**
 * Unified Agent Lifecycle API — Single Agent Operations
 *
 * GET    /api/agents/:id  → get agent details
 * PATCH  /api/agents/:id  → update agent
 * DELETE /api/agents/:id  → delete agent
 */

import { requireAuth } from '@/app/api/middleware/auth';
import { getEmployeeById, upsertEmployee, deleteEmployee, employeeRowToJson } from '@/lib/db';
import { getSwmlWebhookUrl } from '@/app/api/utils/getBaseUrl';
import { validateAgentConfig, configToBackendPayload } from '@/lib/agentSchema';

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const { id } = await params;
  const employee = getEmployeeById(id);
  if (!employee || employee.status === 'deleted') {
    return Response.json({ error: 'Agent not found' }, { status: 404 });
  }

  return Response.json({ success: true, agent: employeeRowToJson(employee) });
}

export async function PATCH(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const { id } = await params;
  const existing = getEmployeeById(id);
  if (!existing || existing.status === 'deleted') {
    return Response.json({ error: 'Agent not found' }, { status: 404 });
  }

  const updates = await request.json();

  // Merge with existing config
  const merged = {
    name: updates.name ?? existing.name,
    role: updates.role ?? existing.role,
    greeting: updates.greeting ?? existing.greeting,
    prompt: updates.prompt ?? existing.prompt,
    voice: updates.voice ?? existing.voice,
    language: updates.language ?? existing.language,
    temperature: updates.temperature ?? existing.temperature,
    functions: updates.functions ?? JSON.parse(existing.enabled_functions || '[]'),
    transferNumber: updates.transferNumber ?? existing.transfer_number,
    smsFromNumber: updates.smsFromNumber ?? existing.sms_from_number,
  };

  // Update Python backend
  const agentCredentials = getAgentCredentials();
  const backendUrl = agentCredentials?.app_domain || 'http://localhost:8000';
  const backendPayload = configToBackendPayload(merged, {
    id,
    projectId: auth.projectId,
    spaceName: auth.spaceUrl,
    token: auth.apiToken,
  });

  try {
    const res = await fetch(`${backendUrl}/api/employee/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backendPayload),
    });
    if (!res.ok) {
      console.warn('[agents/update] Python backend update failed');
    }
  } catch (err) {
    console.warn('[agents/update] Python backend unreachable:', err.message);
  }

  // Update SQLite
  upsertEmployee({
    id,
    projectId: auth.projectId,
    name: merged.name,
    role: merged.role,
    greeting: merged.greeting,
    prompt: merged.prompt,
    voice: merged.voice,
    language: merged.language,
    temperature: merged.temperature,
    enabledFunctions: merged.functions,
    transferNumber: merged.transferNumber,
    smsFromNumber: merged.smsFromNumber,
  });

  const updated = getEmployeeById(id);
  return Response.json({ success: true, agent: employeeRowToJson(updated) });
}

export async function DELETE(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const { id } = await params;
  const existing = getEmployeeById(id);
  if (!existing || existing.status === 'deleted') {
    return Response.json({ error: 'Agent not found' }, { status: 404 });
  }

  // Delete from Python backend
  const agentCredentials = getAgentCredentials();
  const backendUrl = agentCredentials?.app_domain || 'http://localhost:8000';
  try {
    await fetch(`${backendUrl}/api/employee/${id}`, { method: 'DELETE' });
  } catch (err) {
    console.warn('[agents/delete] Python backend unreachable:', err.message);
  }

  // Soft-delete in SQLite
  deleteEmployee(id);

  return Response.json({ success: true, message: 'Agent deleted' });
}

function getAgentCredentials() {
  try {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    return JSON.parse(readFileSync(join(process.cwd(), 'agent-credentials.json'), 'utf-8'));
  } catch { return null; }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/app/api/agents/[id]/route.js
git commit -m "feat: add /api/agents/:id for get, update, delete"
```

---

### Task 7: Real-Time Event Protocol Constants

**Files:**
- Create: `web/src/lib/wizardEvents.js`

Define the event types and helper for parsing wizard events from the `userInput` channel.

- [ ] **Step 1: Create the event protocol file**

Create `web/src/lib/wizardEvents.js`:

```javascript
/**
 * Wizard Agent Real-Time Event Protocol
 *
 * These event types are sent by the Python wizard agent via swml_user_event()
 * and received in the browser on the client.on('userInput', ...) channel.
 */

export const WIZARD_EVENTS = {
  AGENT_PREVIEW: 'agent_preview',
  AGENT_CREATED: 'agent_created',
  AGENT_UPDATED: 'agent_updated',
  AGENT_CONFIG_QUESTION: 'agent_config_question',
  AGENT_READY: 'agent_ready',
};

/**
 * Parse a userInput event and extract wizard event data if present.
 * @param {object} event - The raw userInput event from SignalWire
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

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/wizardEvents.js
git commit -m "feat: add wizard real-time event protocol constants"
```

---

## Phase 3: Wizard Agent

### Task 8: WizardAgent Python Class

**Files:**
- Modify: `agent/main.py`

Add the `WizardAgent` class alongside `VirtualEmployeeAgent`. The wizard has its own SWAIG functions for previewing, asking questions, and creating agents.

- [ ] **Step 1: Add the WizardAgent class to agent/main.py**

Add after the `VirtualEmployeeAgent` class (after line ~623, before the FastAPI app setup):

```python
class WizardAgent(AgentBase):
    """AI Setup Wizard that helps users create other AI agents through voice conversation."""

    def __init__(self):
        super().__init__(
            name="Setup Wizard",
            route="/swml/wizard"
        )

        # Configure voice — friendly, clear
        self.add_language(
            name="English",
            code="en-US",
            voice="openai.shimmer",
            speech_fillers=[
                "Let me think about that...",
                "Great choice! Setting that up...",
                "Working on your agent now..."
            ],
            function_fillers=[
                "Building that for you...",
                "Configuring your new agent..."
            ]
        )

        self._update_wizard_personality()

    def _update_wizard_personality(self):
        """Set the wizard's personality and instructions."""
        available_functions_desc = "\n".join([
            f"  - {name}: {desc}" for name, desc in [
                ("transfer_to_human", "Transfer calls to a live person"),
                ("send_summary_sms", "Text the caller a summary after the call"),
                ("schedule_callback", "Schedule a callback for later"),
                ("check_business_hours", "Tell callers if the business is open"),
                ("collect_customer_info", "Gather contact details from callers"),
                ("send_email", "Send follow-up emails via SendGrid"),
                ("end_call", "Politely end the conversation"),
            ]
        ])

        available_voices = "openai.nova, openai.alloy, openai.echo, openai.fable, openai.onyx, openai.shimmer, elevenlabs.rachel, elevenlabs.drew, elevenlabs.sarah"

        self.add_pom_section(
            "Identity",
            body=(
                "You are the Setup Wizard for Sally Sales — an AI agent platform. "
                "You help users create AI voice agents through natural conversation. "
                "You are friendly, efficient, and knowledgeable about what makes a great AI voice agent."
            )
        )

        self.add_pom_section(
            "Instructions",
            body=(
                "Guide the user through creating an AI agent step by step:\n\n"
                "1. ASK what kind of agent they want (support, sales, receptionist, etc.)\n"
                "2. ASK what the agent should be able to do — use ask_config_question to show options on screen\n"
                "3. Once you have enough info, call preview_agent to show a preview on their dashboard\n"
                "4. ASK if they want to customize the voice, add email, SMS, or other capabilities\n"
                "5. Update the preview with update_agent_preview as they make changes\n"
                "6. When they approve, call create_agent to build it, then finalize_agent\n\n"
                "IMPORTANT RULES:\n"
                "- Always show a preview BEFORE creating the agent\n"
                "- Ask for explicit approval before calling create_agent\n"
                "- Use ask_config_question to show visual options on screen when presenting choices\n"
                "- Keep the conversation natural and brief — this is a voice call, not a form\n"
                "- If the user says something like 'build me a support agent', you have enough to show an initial preview — don't over-ask\n"
                "- After creating one agent, ask if they want to build another\n\n"
                f"AVAILABLE FUNCTIONS the agent can use:\n{available_functions_desc}\n\n"
                f"AVAILABLE VOICES:\n  {available_voices}\n\n"
                "Default to 'openai.nova' voice unless the user requests something different."
            )
        )

    @AgentBase.tool(
        name="ask_config_question",
        description="Display a question with multiple-choice options on the user's screen. Use this when presenting choices like which capabilities to enable, which voice to use, etc.",
        parameters={
            "question": {"type": "string", "description": "The question to display"},
            "options": {"type": "array", "items": {"type": "string"}, "description": "List of option labels to show"},
            "field": {"type": "string", "description": "Which config field this question is about (e.g., 'functions', 'voice', 'role')"},
        }
    )
    def ask_config_question(self, args, raw_data):
        question = args.get("question", "")
        options = args.get("options", [])
        field = args.get("field", "")

        result = SwaigFunctionResult(f"I've displayed the question on screen: {question}")
        result.swml_user_event({
            "type": "agent_config_question",
            "question": question,
            "options": options,
            "field": field,
        })
        return result

    @AgentBase.tool(
        name="preview_agent",
        description="Show a preview card of the agent being designed on the user's dashboard. Call this once you have enough info (name, role, and basic capabilities).",
        parameters={
            "name": {"type": "string", "description": "Agent name"},
            "role": {"type": "string", "description": "Agent role (e.g., 'Customer Support Representative')"},
            "prompt_summary": {"type": "string", "description": "Short summary of what the agent does (1-2 sentences)"},
            "voice": {"type": "string", "description": "Voice ID (e.g., 'openai.nova')"},
            "functions": {"type": "array", "items": {"type": "string"}, "description": "List of enabled function IDs"},
            "greeting": {"type": "string", "description": "The agent's greeting message"},
            "prompt": {"type": "string", "description": "Full agent personality prompt"},
        }
    )
    def preview_agent(self, args, raw_data):
        result = SwaigFunctionResult(
            f"I've put a preview of {args.get('name', 'your agent')} on your screen. Take a look and let me know if you want to change anything."
        )
        result.swml_user_event({
            "type": "agent_preview",
            **args,
        })
        return result

    @AgentBase.tool(
        name="update_agent_preview",
        description="Update the preview card with changes the user requested. Only include the fields that changed.",
        parameters={
            "name": {"type": "string", "description": "Updated name (if changed)"},
            "role": {"type": "string", "description": "Updated role (if changed)"},
            "voice": {"type": "string", "description": "Updated voice (if changed)"},
            "functions": {"type": "array", "items": {"type": "string"}, "description": "Updated function list (if changed)"},
            "prompt": {"type": "string", "description": "Updated prompt (if changed)"},
            "greeting": {"type": "string", "description": "Updated greeting (if changed)"},
        }
    )
    def update_agent_preview(self, args, raw_data):
        result = SwaigFunctionResult("I've updated the preview on your screen.")
        result.swml_user_event({
            "type": "agent_preview",
            **args,
        })
        return result

    @AgentBase.tool(
        name="create_agent",
        description="Actually create the agent. Only call this AFTER showing a preview and getting the user's approval.",
        parameters={
            "name": {"type": "string", "description": "Agent name"},
            "role": {"type": "string", "description": "Agent role"},
            "greeting": {"type": "string", "description": "Agent greeting"},
            "prompt": {"type": "string", "description": "Full personality prompt for the agent"},
            "voice": {"type": "string", "description": "Voice ID"},
            "language": {"type": "string", "description": "Language code (default: en-US)"},
            "temperature": {"type": "number", "description": "Temperature 0-1 (default: 0.7)"},
            "functions": {"type": "array", "items": {"type": "string"}, "description": "Enabled function IDs"},
        }
    )
    def create_agent(self, args, raw_data):
        """Create the agent via the Python backend's own create-employee endpoint."""
        employee_id = str(uuid.uuid4())[:8]

        employee_config = {
            "id": employee_id,
            "name": args.get("name", "New Agent"),
            "role": args.get("role", "Assistant"),
            "greeting": args.get("greeting", "Hello, how can I help you?"),
            "prompt": args.get("prompt", ""),
            "voice": args.get("voice", "openai.nova"),
            "language": args.get("language", "en-US"),
            "temperature": args.get("temperature", 0.7),
            "speech_hints": [],
            "enabled_functions": args.get("functions", ["transfer_to_human", "send_summary_sms", "end_call"]),
            "transfer_number": "",
            "transfer_from": "",
            "sms_from_number": "",
            "video_idle_url": "",
            "video_talking_url": "",
            "business_hours_start": 9,
            "business_hours_end": 18,
            "business_days": [0, 1, 2, 3, 4],
            "documents": [],
            "sendgrid_api_key": "",
            "email_from_address": "",
            "email_from_name": "",
            "space_name": "",
            "project_id": "",
            "token": "",
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "status": "active",
        }

        # Store and mount the new employee
        employees[employee_id] = employee_config
        agent = VirtualEmployeeAgent(employee_config)
        agent_instances[employee_id] = agent
        _remount_employee_router(employee_id, agent)

        logger.info(f"🧙 Wizard created agent: {employee_config['name']} ({employee_id})")

        result = SwaigFunctionResult(
            f"I've created {args.get('name', 'your agent')}! It's now live and ready to take calls."
        )
        result.swml_user_event({
            "type": "agent_created",
            "employee": employee_config,
        })
        return result

    @AgentBase.tool(
        name="finalize_agent",
        description="Signal that the agent is ready to receive calls. Call this after create_agent succeeds.",
        parameters={
            "employee_id": {"type": "string", "description": "The ID of the created employee"},
            "message": {"type": "string", "description": "Completion message to show the user"},
        }
    )
    def finalize_agent(self, args, raw_data):
        employee_id = args.get("employee_id", "")
        swml_route = f"/swml/{employee_id}" if employee_id else ""

        result = SwaigFunctionResult(
            args.get("message", "Your agent is ready! You can call it from the dashboard.")
        )
        result.swml_user_event({
            "type": "agent_ready",
            "employee_id": employee_id,
            "swml_route": swml_route,
        })
        return result

    @AgentBase.tool(
        name="list_available_functions",
        description="Get the list of capabilities that can be enabled for an agent. Call this if the user asks what an agent can do.",
        parameters={}
    )
    def list_available_functions(self, args, raw_data):
        functions_list = [
            "transfer_to_human - Transfer calls to a live person",
            "send_summary_sms - Text the caller a summary",
            "schedule_callback - Schedule a callback",
            "check_business_hours - Check if business is open",
            "collect_customer_info - Gather contact details",
            "send_email - Send follow-up emails",
            "end_call - Politely end the conversation",
        ]
        return SwaigFunctionResult(
            "Here are the available capabilities:\n" + "\n".join(functions_list)
        )
```

- [ ] **Step 2: Mount the wizard agent at startup**

Add to the main entry block in `agent/main.py` (after the logging setup around line 1004, before `uvicorn.run`):

```python
    # Mount the Wizard agent
    wizard = WizardAgent()
    _remount_employee_router("wizard", wizard)
    agent_instances["wizard"] = wizard
    logger.info("🧙 Wizard agent mounted at /swml/wizard")
```

Note: Store the wizard in `agent_instances` with key `"wizard"` so it persists, but it does NOT go in the `employees` dict (it's not a regular employee).

- [ ] **Step 3: Commit**

```bash
git add agent/main.py
git commit -m "feat: add WizardAgent with SWAIG functions for live agent building"
```

---

### Task 9: Wizard UI Panel Component

**Files:**
- Create: `web/src/components/dashboard/WizardPanel.jsx`

- [ ] **Step 1: Create the WizardPanel component**

Create `web/src/components/dashboard/WizardPanel.jsx`:

```jsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { Wand2, Phone, PhoneOff, Check, Sparkles, MessageCircle } from "lucide-react";
import { WIZARD_EVENTS, parseWizardEvent } from "@/lib/wizardEvents";

/**
 * WizardPanel — Displays during wizard calls.
 * Listens for wizard events and shows:
 * - Agent preview cards
 * - Config questions with clickable options
 * - Creation confirmation with "Call Now" CTA
 */
export default function WizardPanel({ wizardActive, onAgentCreated }) {
  const [preview, setPreview] = useState(null);
  const [question, setQuestion] = useState(null);
  const [createdAgent, setCreatedAgent] = useState(null);
  const [readyAgent, setReadyAgent] = useState(null);

  const handleWizardEvent = useCallback((event) => {
    const parsed = parseWizardEvent(event);
    if (!parsed) return;

    switch (parsed.type) {
      case WIZARD_EVENTS.AGENT_PREVIEW:
        setPreview((prev) => ({ ...prev, ...parsed.data }));
        setQuestion(null); // Clear question when preview shown
        break;
      case WIZARD_EVENTS.AGENT_CONFIG_QUESTION:
        setQuestion(parsed.data);
        break;
      case WIZARD_EVENTS.AGENT_CREATED:
        setCreatedAgent(parsed.data.employee);
        setPreview(null);
        setQuestion(null);
        if (onAgentCreated) onAgentCreated(parsed.data.employee);
        break;
      case WIZARD_EVENTS.AGENT_READY:
        setReadyAgent(parsed.data);
        break;
    }
  }, [onAgentCreated]);

  // Expose the event handler so the parent can wire it to userInput events
  useEffect(() => {
    window.__wizardEventHandler = handleWizardEvent;
    return () => { delete window.__wizardEventHandler; };
  }, [handleWizardEvent]);

  // Reset state when wizard deactivates
  useEffect(() => {
    if (!wizardActive) {
      setPreview(null);
      setQuestion(null);
      setCreatedAgent(null);
      setReadyAgent(null);
    }
  }, [wizardActive]);

  if (!wizardActive && !createdAgent && !readyAgent) return null;

  return (
    <div className="bg-gradient-to-br from-purple-900/20 to-indigo-900/20 border border-purple-500/30 rounded-xl p-6 space-y-4">
      <div className="flex items-center gap-2 text-purple-300">
        <Wand2 className="w-5 h-5" />
        <h3 className="font-semibold text-lg">Setup Wizard</h3>
        {wizardActive && (
          <span className="ml-auto flex items-center gap-1 text-sm text-green-400">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            Listening...
          </span>
        )}
      </div>

      {/* Question Overlay */}
      {question && (
        <div className="bg-gray-800/60 rounded-lg p-4 border border-purple-500/20">
          <p className="text-white font-medium mb-3">
            <MessageCircle className="w-4 h-4 inline mr-2 text-purple-400" />
            {question.question}
          </p>
          <div className="flex flex-wrap gap-2">
            {question.options?.map((option, i) => (
              <button
                key={i}
                className="px-3 py-1.5 bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/40 rounded-lg text-sm text-purple-200 transition-colors"
              >
                {option}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-2">Answer by voice — these are visual aids</p>
        </div>
      )}

      {/* Agent Preview Card */}
      {preview && (
        <div className="bg-gray-800/60 rounded-lg p-4 border border-indigo-500/20 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h4 className="text-white font-semibold text-lg">{preview.name || "New Agent"}</h4>
              <p className="text-gray-400 text-sm">{preview.role || "Assistant"}</p>
            </div>
            <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-300 text-xs rounded-full border border-yellow-500/30">
              Preview
            </span>
          </div>
          {preview.prompt_summary && (
            <p className="text-gray-300 text-sm mb-3">{preview.prompt_summary}</p>
          )}
          {preview.voice && (
            <p className="text-gray-500 text-xs mb-2">Voice: {preview.voice}</p>
          )}
          {preview.functions?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {preview.functions.map((fn) => (
                <span key={fn} className="px-2 py-0.5 bg-blue-500/20 text-blue-300 text-xs rounded-full border border-blue-500/30">
                  {fn.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Agent Created Confirmation */}
      {createdAgent && (
        <div className="bg-green-900/20 rounded-lg p-4 border border-green-500/30 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-5 h-5 text-green-400" />
            <h4 className="text-green-300 font-semibold">Agent Created!</h4>
          </div>
          <p className="text-white font-medium">{createdAgent.name}</p>
          <p className="text-gray-400 text-sm">{createdAgent.role}</p>
        </div>
      )}

      {/* Ready to Call CTA */}
      {readyAgent && (
        <div className="flex items-center gap-3 bg-green-900/30 rounded-lg p-3 border border-green-500/30">
          <Check className="w-5 h-5 text-green-400" />
          <span className="text-green-300 text-sm font-medium">Ready to take calls</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/dashboard/WizardPanel.jsx
git commit -m "feat: add WizardPanel component with preview cards and question overlay"
```

---

### Task 10: Wire Wizard into Dashboard

**Files:**
- Modify: `web/src/app/dashboard/page.jsx`

Add the wizard call button and WizardPanel, wire up userInput events.

- [ ] **Step 1: Import WizardPanel and useCallWidget in the dashboard page**

Add to the imports at the top of `web/src/app/dashboard/page.jsx`:

```javascript
import WizardPanel from "@/components/dashboard/WizardPanel";
import { useCallWidget } from "@/app/hooks/useCallWidget";
```

- [ ] **Step 2: Add wizard state and call handler**

Inside the DashboardPage component, add:

```javascript
const { initiateCall, calling: wizardCalling } = useCallWidget();
const [wizardActive, setWizardActive] = useState(false);

const handleCallWizard = async () => {
  setWizardActive(true);
  // The wizard agent is mounted at /swml/wizard on the Python backend
  // We need to create a SignalWire resource or use direct addressing
  const success = await initiateCall("/public/wizard-agent");
  if (!success) {
    setWizardActive(false);
  }
};

const handleAgentCreated = (employee) => {
  // Refresh dashboard data when wizard creates an agent
  loadDashboardData();
};
```

- [ ] **Step 3: Add wizard call button and panel to the JSX**

Add the wizard call button in the quick actions section and the WizardPanel component:

```jsx
{/* Wizard Call Button */}
<button
  onClick={handleCallWizard}
  disabled={wizardCalling}
  className="flex items-center gap-3 w-full p-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 rounded-xl text-white transition-all disabled:opacity-50"
>
  <Wand2 className="w-6 h-6" />
  <div className="text-left">
    <p className="font-semibold">{wizardCalling ? "Wizard Active..." : "Call Setup Wizard"}</p>
    <p className="text-sm text-purple-200">Build agents with your voice</p>
  </div>
</button>

{/* Wizard Panel */}
<WizardPanel
  wizardActive={wizardActive}
  onAgentCreated={handleAgentCreated}
/>
```

- [ ] **Step 4: Wire up the userInput event listener for wizard events**

Add a useEffect in the dashboard page that listens for userInput events and routes them to the WizardPanel:

```javascript
useEffect(() => {
  // Listen for wizard events on the global event bus
  const handleUserInput = (event) => {
    if (window.__wizardEventHandler) {
      window.__wizardEventHandler(event.detail || event);
    }
  };

  window.addEventListener("wizard-event", handleUserInput);
  return () => window.removeEventListener("wizard-event", handleUserInput);
}, []);
```

- [ ] **Step 5: Commit**

```bash
git add web/src/app/dashboard/page.jsx
git commit -m "feat: wire wizard call button and panel into dashboard"
```

---

### Task 11: Create Wizard SignalWire Resource on Login

**Files:**
- Modify: `web/src/app/api/signalwire/connect/route.js`

When a user logs in, ensure a `wizard-agent` SWML resource exists in their SignalWire space pointing to the Python backend's `/swml/wizard` endpoint.

- [ ] **Step 1: Add wizard resource creation to the connect route**

After the subscriber creation section in `connect/route.js` (after line ~161 where the user is upserted), add:

```javascript
    // Ensure wizard-agent resource exists in SignalWire
    try {
      const { getSwmlWebhookUrl } = await import('@/app/api/utils/getBaseUrl');
      const wizardWebhookUrl = getSwmlWebhookUrl(request, '/swml/wizard/');

      // Check if resource already exists
      const listRes = await fetch(`${baseUrl}/api/fabric/resources?name=wizard-agent`, {
        method: 'GET',
        headers: { 'Authorization': `Basic ${basicAuth}`, 'Content-Type': 'application/json' },
      });

      let wizardExists = false;
      if (listRes.ok) {
        const listData = await listRes.json();
        wizardExists = listData.data?.some(r => r.name === 'wizard-agent');
      }

      if (!wizardExists) {
        await fetch(`${baseUrl}/api/fabric/resources`, {
          method: 'POST',
          headers: { 'Authorization': `Basic ${basicAuth}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'wizard-agent',
            display_name: 'Setup Wizard',
            type: 'swml_webhook',
            swml_webhook: { url: wizardWebhookUrl },
          }),
        });
        console.log('[Connect] Created wizard-agent resource');
      }
    } catch (err) {
      console.warn('[Connect] Could not create wizard resource:', err.message);
    }
```

- [ ] **Step 2: Commit**

```bash
git add web/src/app/api/signalwire/connect/route.js
git commit -m "feat: auto-create wizard-agent SignalWire resource on login"
```

---

## Phase 4: Test Coverage

### Task 12: Test Infrastructure Setup

**Files:**
- Modify: `web/package.json` (already has test script from Task 1)
- Create: `web/test/mocks/db.js`
- Create: `web/test/mocks/session.js`
- Create: `web/test/mocks/fetch.js`

- [ ] **Step 1: Create database mock**

Create `web/test/mocks/db.js`:

```javascript
/**
 * Mock for @/lib/db — used in API route tests
 */
import { vi } from 'vitest';

export const mockDb = {
  upsertUser: vi.fn(),
  getUserByProjectId: vi.fn(),
  getEmployeesByProject: vi.fn(() => []),
  getAllEmployees: vi.fn(() => []),
  getEmployeeById: vi.fn(),
  upsertEmployee: vi.fn(),
  deleteEmployee: vi.fn(),
  insertCallLog: vi.fn(),
  getCallLogs: vi.fn(() => []),
  employeeRowToJson: vi.fn((row) => row),
};

vi.mock('@/lib/db', () => mockDb);
```

- [ ] **Step 2: Create session mock**

Create `web/test/mocks/session.js`:

```javascript
/**
 * Mock for @/lib/session — used in API route tests
 */
import { vi } from 'vitest';

export const mockSession = {
  createSessionToken: vi.fn(() => 'mock-jwt-token'),
  verifySessionToken: vi.fn(() => ({ projectId: 'test-project', spaceUrl: 'test.signalwire.com' })),
  buildSessionCookie: vi.fn(() => 'sally_session=mock-jwt-token; Path=/; HttpOnly'),
  buildClearSessionCookie: vi.fn(() => 'sally_session=; Path=/; HttpOnly; Max-Age=0'),
  getSessionFromRequest: vi.fn(() => ({ projectId: 'test-project', spaceUrl: 'test.signalwire.com' })),
};

vi.mock('@/lib/session', () => mockSession);
```

- [ ] **Step 3: Create fetch mock helper**

Create `web/test/mocks/fetch.js`:

```javascript
/**
 * Fetch mock helper for API route tests
 */
import { vi } from 'vitest';

/**
 * Create a mock fetch that responds based on URL patterns.
 * @param {Object<string, { ok: boolean, status?: number, json?: any, text?: string }>} routes
 */
export function mockFetch(routes) {
  return vi.fn(async (url, options) => {
    for (const [pattern, response] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        return {
          ok: response.ok ?? true,
          status: response.status ?? 200,
          json: async () => response.json ?? {},
          text: async () => response.text ?? '',
        };
      }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => 'Not found' };
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add web/test/mocks/
git commit -m "test: add mock helpers for db, session, and fetch"
```

---

### Task 13: Agent Schema Tests

**Files:**
- Create: `web/src/lib/__tests__/agentSchema.test.js`

- [ ] **Step 1: Write agent schema tests**

Create `web/src/lib/__tests__/agentSchema.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { validateAgentConfig, configToBackendPayload, DEFAULT_AGENT_CONFIG, AVAILABLE_FUNCTIONS } from '../agentSchema';

describe('validateAgentConfig', () => {
  it('rejects empty config', () => {
    const result = validateAgentConfig({});
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('name is required');
    expect(result.errors).toContain('prompt is required');
  });

  it('accepts valid config', () => {
    const result = validateAgentConfig({
      name: 'Support Agent',
      prompt: 'You are a helpful support agent.',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects temperature out of range', () => {
    const result = validateAgentConfig({
      name: 'Agent',
      prompt: 'Test',
      temperature: 1.5,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('temperature must be between 0 and 1');
  });

  it('rejects non-array functions', () => {
    const result = validateAgentConfig({
      name: 'Agent',
      prompt: 'Test',
      functions: 'not-an-array',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('functions must be an array');
  });
});

describe('configToBackendPayload', () => {
  it('converts frontend config to Python backend format', () => {
    const config = {
      name: 'Sales Bot',
      role: 'Sales',
      prompt: 'Sell things',
      voice: 'openai.alloy',
      functions: ['transfer_to_human', 'end_call'],
      businessHours: { start: 10, end: 17, days: [1, 2, 3] },
      emailConfig: { sendgridKey: 'sg-key', fromAddress: 'a@b.com', fromName: 'Bot' },
    };

    const payload = configToBackendPayload(config, { id: 'abc', projectId: 'proj-1' });

    expect(payload.name).toBe('Sales Bot');
    expect(payload.enabled_functions).toEqual(['transfer_to_human', 'end_call']);
    expect(payload.business_hours_start).toBe(10);
    expect(payload.business_hours_end).toBe(17);
    expect(payload.business_days).toEqual([1, 2, 3]);
    expect(payload.sendgrid_api_key).toBe('sg-key');
    expect(payload.id).toBe('abc');
    expect(payload.project_id).toBe('proj-1');
  });

  it('uses defaults for missing fields', () => {
    const payload = configToBackendPayload({ name: 'X', prompt: 'Y' });
    expect(payload.voice).toBe('openai.nova');
    expect(payload.temperature).toBe(0.7);
    expect(payload.enabled_functions).toEqual(['transfer_to_human', 'send_summary_sms', 'end_call']);
  });
});

describe('AVAILABLE_FUNCTIONS', () => {
  it('has 7 functions', () => {
    expect(AVAILABLE_FUNCTIONS).toHaveLength(7);
  });

  it('each function has id, label, description', () => {
    for (const fn of AVAILABLE_FUNCTIONS) {
      expect(fn.id).toBeDefined();
      expect(fn.label).toBeDefined();
      expect(fn.description).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd web && npx vitest run src/lib/__tests__/agentSchema.test.js`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/__tests__/agentSchema.test.js
git commit -m "test: add agent schema validation and conversion tests"
```

---

### Task 14: Session & Auth Middleware Tests

**Files:**
- Create: `web/src/lib/__tests__/session.test.js`
- Create: `web/src/app/api/middleware/__tests__/auth.test.js`

- [ ] **Step 1: Write session tests**

Create `web/src/lib/__tests__/session.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { createSessionToken, verifySessionToken, buildSessionCookie, buildClearSessionCookie, getSessionFromRequest } from '../session';

describe('JWT session', () => {
  it('creates and verifies a token', async () => {
    const token = await createSessionToken({ projectId: 'proj-1', spaceUrl: 'test.signalwire.com' });
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT has 3 parts

    const payload = await verifySessionToken(token);
    expect(payload).toEqual({ projectId: 'proj-1', spaceUrl: 'test.signalwire.com' });
  });

  it('returns null for invalid token', async () => {
    const payload = await verifySessionToken('invalid.token.here');
    expect(payload).toBeNull();
  });

  it('returns null for empty token', async () => {
    const payload = await verifySessionToken('');
    expect(payload).toBeNull();
  });

  it('builds a session cookie with correct attributes', () => {
    const cookie = buildSessionCookie('test-token');
    expect(cookie).toContain('sally_session=test-token');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=');
  });

  it('builds a clear cookie with Max-Age=0', () => {
    const cookie = buildClearSessionCookie();
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('sally_session=');
  });

  it('extracts session from request cookie', async () => {
    const token = await createSessionToken({ projectId: 'proj-2', spaceUrl: 'demo.signalwire.com' });
    const request = new Request('http://localhost', {
      headers: { Cookie: `sally_session=${token}` },
    });
    const session = await getSessionFromRequest(request);
    expect(session).toEqual({ projectId: 'proj-2', spaceUrl: 'demo.signalwire.com' });
  });

  it('returns null when no cookie present', async () => {
    const request = new Request('http://localhost');
    const session = await getSessionFromRequest(request);
    expect(session).toBeNull();
  });
});
```

- [ ] **Step 2: Run session tests**

Run: `cd web && npx vitest run src/lib/__tests__/session.test.js`
Expected: All tests pass

- [ ] **Step 3: Write auth middleware tests**

Create `web/src/app/api/middleware/__tests__/auth.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSessionToken } from '@/lib/session';

// Mock the db module
vi.mock('@/lib/db', () => ({
  getUserByProjectId: vi.fn(),
}));

import { getUserByProjectId } from '@/lib/db';
import { requireAuth, optionalAuth } from '../auth';

function makeRequest(cookie) {
  const headers = cookie ? { Cookie: cookie } : {};
  return new Request('http://localhost/api/test', { headers });
}

describe('requireAuth', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 401 when no cookie', async () => {
    const result = await requireAuth(makeRequest());
    expect(result.error).toBeDefined();
    const body = await result.error.json();
    expect(body.error).toBe('Not authenticated');
  });

  it('returns 401 when user not in database', async () => {
    const token = await createSessionToken({ projectId: 'missing', spaceUrl: 'test.sw.com' });
    getUserByProjectId.mockReturnValue(null);

    const result = await requireAuth(makeRequest(`sally_session=${token}`));
    expect(result.error).toBeDefined();
  });

  it('returns user data when session is valid', async () => {
    const token = await createSessionToken({ projectId: 'proj-1', spaceUrl: 'test.sw.com' });
    getUserByProjectId.mockReturnValue({
      project_id: 'proj-1',
      space_url: 'test.sw.com',
      api_token: 'tok-123',
      subscriber_id: 'sub-1',
      subscriber_data: null,
    });

    const result = await requireAuth(makeRequest(`sally_session=${token}`));
    expect(result.error).toBeUndefined();
    expect(result.projectId).toBe('proj-1');
    expect(result.apiToken).toBe('tok-123');
  });
});

describe('optionalAuth', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns null when no cookie (no error)', async () => {
    const result = await optionalAuth(makeRequest());
    expect(result).toBeNull();
  });

  it('returns user data when session is valid', async () => {
    const token = await createSessionToken({ projectId: 'proj-1', spaceUrl: 'test.sw.com' });
    getUserByProjectId.mockReturnValue({
      project_id: 'proj-1',
      space_url: 'test.sw.com',
      api_token: 'tok-123',
      subscriber_id: null,
      subscriber_data: null,
    });

    const result = await optionalAuth(makeRequest(`sally_session=${token}`));
    expect(result.projectId).toBe('proj-1');
  });
});
```

- [ ] **Step 4: Run auth tests**

Run: `cd web && npx vitest run src/app/api/middleware/__tests__/auth.test.js`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/__tests__/session.test.js web/src/app/api/middleware/__tests__/auth.test.js
git commit -m "test: add session JWT and auth middleware tests"
```

---

### Task 15: Wizard Event Protocol Tests

**Files:**
- Create: `web/src/lib/__tests__/wizardEvents.test.js`

- [ ] **Step 1: Write wizard event tests**

Create `web/src/lib/__tests__/wizardEvents.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { WIZARD_EVENTS, parseWizardEvent } from '../wizardEvents';

describe('WIZARD_EVENTS', () => {
  it('has all expected event types', () => {
    expect(WIZARD_EVENTS.AGENT_PREVIEW).toBe('agent_preview');
    expect(WIZARD_EVENTS.AGENT_CREATED).toBe('agent_created');
    expect(WIZARD_EVENTS.AGENT_UPDATED).toBe('agent_updated');
    expect(WIZARD_EVENTS.AGENT_CONFIG_QUESTION).toBe('agent_config_question');
    expect(WIZARD_EVENTS.AGENT_READY).toBe('agent_ready');
  });
});

describe('parseWizardEvent', () => {
  it('parses agent_preview event from detail', () => {
    const event = {
      detail: { type: 'agent_preview', name: 'Support Bot', role: 'Support' },
    };
    const parsed = parseWizardEvent(event);
    expect(parsed.type).toBe('agent_preview');
    expect(parsed.data.name).toBe('Support Bot');
  });

  it('parses agent_config_question event', () => {
    const event = {
      detail: { type: 'agent_config_question', question: 'Pick a voice', options: ['Nova', 'Alloy'] },
    };
    const parsed = parseWizardEvent(event);
    expect(parsed.type).toBe('agent_config_question');
    expect(parsed.data.options).toEqual(['Nova', 'Alloy']);
  });

  it('returns null for unknown event types', () => {
    const event = { detail: { type: 'unknown_event' } };
    expect(parseWizardEvent(event)).toBeNull();
  });

  it('returns null for events without type', () => {
    expect(parseWizardEvent({})).toBeNull();
    expect(parseWizardEvent(null)).toBeNull();
    expect(parseWizardEvent({ detail: {} })).toBeNull();
  });

  it('handles flat event objects (no detail wrapper)', () => {
    const event = { type: 'agent_ready', employee_id: 'abc123' };
    const parsed = parseWizardEvent(event);
    expect(parsed.type).toBe('agent_ready');
    expect(parsed.data.employee_id).toBe('abc123');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd web && npx vitest run src/lib/__tests__/wizardEvents.test.js`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/__tests__/wizardEvents.test.js
git commit -m "test: add wizard event protocol parsing tests"
```

---

### Task 16: WizardPanel Component Tests

**Files:**
- Create: `web/src/components/dashboard/__tests__/WizardPanel.test.jsx`

- [ ] **Step 1: Write WizardPanel component tests**

Create `web/src/components/dashboard/__tests__/WizardPanel.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import WizardPanel from '../WizardPanel';

describe('WizardPanel', () => {
  it('renders nothing when inactive and no created agent', () => {
    const { container } = render(<WizardPanel wizardActive={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows listening indicator when active', () => {
    render(<WizardPanel wizardActive={true} />);
    expect(screen.getByText('Listening...')).toBeDefined();
    expect(screen.getByText('Setup Wizard')).toBeDefined();
  });

  it('shows preview card on agent_preview event', () => {
    render(<WizardPanel wizardActive={true} />);

    act(() => {
      window.__wizardEventHandler({
        detail: {
          type: 'agent_preview',
          name: 'Support Bot',
          role: 'Customer Support',
          voice: 'openai.nova',
          functions: ['transfer_to_human', 'end_call'],
        },
      });
    });

    expect(screen.getByText('Support Bot')).toBeDefined();
    expect(screen.getByText('Customer Support')).toBeDefined();
    expect(screen.getByText('Preview')).toBeDefined();
    expect(screen.getByText('transfer to human')).toBeDefined();
  });

  it('shows question overlay on agent_config_question event', () => {
    render(<WizardPanel wizardActive={true} />);

    act(() => {
      window.__wizardEventHandler({
        detail: {
          type: 'agent_config_question',
          question: 'What should the agent handle?',
          options: ['Billing', 'Support', 'Sales'],
          field: 'role',
        },
      });
    });

    expect(screen.getByText('What should the agent handle?')).toBeDefined();
    expect(screen.getByText('Billing')).toBeDefined();
    expect(screen.getByText('Support')).toBeDefined();
    expect(screen.getByText('Sales')).toBeDefined();
  });

  it('shows created confirmation on agent_created event', () => {
    const onCreated = vi.fn();
    render(<WizardPanel wizardActive={true} onAgentCreated={onCreated} />);

    act(() => {
      window.__wizardEventHandler({
        detail: {
          type: 'agent_created',
          employee: { name: 'Sales Bot', role: 'Sales Rep', id: 'abc' },
        },
      });
    });

    expect(screen.getByText('Agent Created!')).toBeDefined();
    expect(screen.getByText('Sales Bot')).toBeDefined();
    expect(onCreated).toHaveBeenCalledWith({ name: 'Sales Bot', role: 'Sales Rep', id: 'abc' });
  });

  it('resets state when wizardActive goes from true to false', () => {
    const { rerender, container } = render(<WizardPanel wizardActive={true} />);

    act(() => {
      window.__wizardEventHandler({
        detail: { type: 'agent_preview', name: 'Test', role: 'Test' },
      });
    });

    expect(screen.getByText('Test')).toBeDefined();

    rerender(<WizardPanel wizardActive={false} />);
    expect(container.innerHTML).toBe('');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd web && npx vitest run src/components/dashboard/__tests__/WizardPanel.test.jsx`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add web/src/components/dashboard/__tests__/WizardPanel.test.jsx
git commit -m "test: add WizardPanel component tests for events and rendering"
```

---

### Task 17: Run Full Test Suite

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `cd web && npm test`
Expected: All test suites pass:
- `call-logs/__tests__/helpers.test.js`
- `call-logs/__tests__/components.test.jsx`
- `lib/__tests__/agentSchema.test.js`
- `lib/__tests__/session.test.js`
- `lib/__tests__/wizardEvents.test.js`
- `api/middleware/__tests__/auth.test.js`
- `components/dashboard/__tests__/WizardPanel.test.jsx`

- [ ] **Step 2: Fix any failing tests**

If any test fails, fix it. Common issues:
- Import path mismatches (use `@/` alias)
- Missing mocks in setupTests.ts
- jsdom limitations

- [ ] **Step 3: Commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve test failures from full suite run"
```

---

## Phase 5: Demo Polish

### Task 18: Demo Reset & Seed Data

**Files:**
- Create: `web/src/app/api/demo/reset/route.js`
- Create: `web/src/app/api/demo/seed/route.js`

- [ ] **Step 1: Create the demo reset endpoint**

Create `web/src/app/api/demo/reset/route.js`:

```javascript
/**
 * Demo Reset — Clears all data for a fresh demo
 * POST /api/demo/reset
 */

import { getDb } from '@/lib/db';
import { requireAuth } from '@/app/api/middleware/auth';

export async function POST(request) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const db = getDb();

  // Delete all data for this project
  db.prepare('DELETE FROM call_actions WHERE employee_id IN (SELECT id FROM employees WHERE project_id = ?)').run(auth.projectId);
  db.prepare('DELETE FROM sms_logs WHERE employee_id IN (SELECT id FROM employees WHERE project_id = ?)').run(auth.projectId);
  db.prepare('DELETE FROM call_logs WHERE project_id = ?').run(auth.projectId);
  db.prepare('DELETE FROM employees WHERE project_id = ?').run(auth.projectId);

  // Also clear Python backend employees
  try {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const creds = JSON.parse(readFileSync(join(process.cwd(), 'agent-credentials.json'), 'utf-8'));
    const backendUrl = creds?.app_domain || 'http://localhost:8000';
    const listRes = await fetch(`${backendUrl}/api/list-employees`);
    if (listRes.ok) {
      const { employees } = await listRes.json();
      for (const emp of employees) {
        if (emp.id !== 'wizard') {
          await fetch(`${backendUrl}/api/employee/${emp.id}`, { method: 'DELETE' });
        }
      }
    }
  } catch (err) {
    console.warn('[demo/reset] Could not clear Python backend:', err.message);
  }

  return Response.json({ success: true, message: 'Demo data cleared' });
}
```

- [ ] **Step 2: Create the demo seed endpoint**

Create `web/src/app/api/demo/seed/route.js`:

```javascript
/**
 * Demo Seed — Populate with example agents and call logs
 * POST /api/demo/seed
 */

import { upsertEmployee, insertCallLog } from '@/lib/db';
import { requireAuth } from '@/app/api/middleware/auth';
import { randomUUID } from 'crypto';

const SEED_EMPLOYEES = [
  {
    name: 'Sally Sales',
    role: 'Sales Representative',
    greeting: 'Hi there! Welcome to our company. How can I help you today?',
    prompt: 'You are Sally, a friendly and knowledgeable sales representative. Help customers find the right products, answer pricing questions, and guide them through the purchasing process.',
    voice: 'openai.nova',
    functions: ['transfer_to_human', 'send_summary_sms', 'collect_customer_info', 'end_call'],
  },
  {
    name: 'Tech Support Tom',
    role: 'Technical Support Agent',
    greeting: 'Hello! You\'ve reached tech support. What issue can I help you with?',
    prompt: 'You are Tom, a patient and thorough technical support agent. Help customers troubleshoot issues, walk them through solutions step-by-step, and escalate when needed.',
    voice: 'openai.onyx',
    functions: ['transfer_to_human', 'send_summary_sms', 'schedule_callback', 'check_business_hours', 'end_call'],
  },
];

const SEED_CALL_LOGS = [
  { summary: 'Customer inquired about enterprise pricing. Provided quote for 50 seats.', outcome: 'resolved', sentiment: 'positive', durationSec: 180 },
  { summary: 'Caller had login issues. Walked through password reset successfully.', outcome: 'resolved', sentiment: 'positive', durationSec: 240 },
  { summary: 'Customer wanted to cancel subscription. Transferred to retention team.', outcome: 'transferred', sentiment: 'negative', durationSec: 120 },
];

export async function POST(request) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  // Create seed employees
  const createdEmployees = [];
  for (const emp of SEED_EMPLOYEES) {
    const id = randomUUID().slice(0, 8);
    upsertEmployee({
      id,
      projectId: auth.projectId,
      name: emp.name,
      role: emp.role,
      greeting: emp.greeting,
      prompt: emp.prompt,
      voice: emp.voice,
      enabledFunctions: emp.functions,
    });
    createdEmployees.push({ id, name: emp.name });

    // Also create in Python backend
    try {
      const { readFileSync } = require('fs');
      const { join } = require('path');
      const creds = JSON.parse(readFileSync(join(process.cwd(), 'agent-credentials.json'), 'utf-8'));
      const backendUrl = creds?.app_domain || 'http://localhost:8000';
      await fetch(`${backendUrl}/api/create-employee`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name: emp.name,
          role: emp.role,
          greeting: emp.greeting,
          prompt: emp.prompt,
          voice: emp.voice,
          enabled_functions: emp.functions,
        }),
      });
    } catch { /* best effort */ }
  }

  // Create seed call logs
  for (let i = 0; i < SEED_CALL_LOGS.length; i++) {
    const log = SEED_CALL_LOGS[i];
    const empIdx = i % createdEmployees.length;
    const hoursAgo = (SEED_CALL_LOGS.length - i) * 2;
    const timestamp = new Date(Date.now() - hoursAgo * 3600000).toISOString();

    insertCallLog({
      id: randomUUID(),
      projectId: auth.projectId,
      employeeId: createdEmployees[empIdx].id,
      employeeName: createdEmployees[empIdx].name,
      timestamp,
      durationSec: log.durationSec,
      summary: log.summary,
      outcome: log.outcome,
      sentiment: log.sentiment,
      topics: ['demo'],
      userMessages: Math.floor(Math.random() * 10) + 3,
      assistantMessages: Math.floor(Math.random() * 10) + 3,
      totalMessages: Math.floor(Math.random() * 20) + 6,
    });
  }

  return Response.json({
    success: true,
    employees: createdEmployees,
    callLogs: SEED_CALL_LOGS.length,
    message: 'Demo data seeded',
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/demo/
git commit -m "feat: add demo reset and seed data endpoints"
```

---

### Task 19: Demo Tools UI in Dashboard

**Files:**
- Modify: `web/src/app/dashboard/page.jsx`

- [ ] **Step 1: Add demo tools section to the dashboard**

Add a collapsible "Demo Tools" section at the bottom of the dashboard page:

```jsx
{/* Demo Tools — hidden behind a disclosure */}
<details className="mt-8">
  <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-300">
    Demo Tools
  </summary>
  <div className="mt-2 flex gap-3">
    <button
      onClick={async () => {
        if (!confirm('Clear all agents and call logs?')) return;
        await fetch('/api/demo/reset', { method: 'POST' });
        loadDashboardData();
      }}
      className="px-4 py-2 bg-red-900/30 text-red-300 border border-red-500/30 rounded-lg text-sm hover:bg-red-900/50"
    >
      Reset Demo Data
    </button>
    <button
      onClick={async () => {
        await fetch('/api/demo/seed', { method: 'POST' });
        loadDashboardData();
      }}
      className="px-4 py-2 bg-blue-900/30 text-blue-300 border border-blue-500/30 rounded-lg text-sm hover:bg-blue-900/50"
    >
      Seed Example Data
    </button>
  </div>
</details>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/app/dashboard/page.jsx
git commit -m "feat: add demo tools (reset & seed) to dashboard"
```

---

### Task 20: Final Verification & Cleanup

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd web && npm test`
Expected: All suites pass

- [ ] **Step 2: Start both services and verify manually**

1. Start Python agent: `cd agent && python main.py`
2. Start web frontend: `cd web && npm run dev`
3. Open `http://localhost:5000/login` → log in
4. Verify dashboard loads with wizard button
5. Click "Seed Example Data" → verify agents and call logs appear
6. Click "Call Setup Wizard" → verify call initiates
7. Check `http://localhost:8000/health` → verify wizard is mounted

- [ ] **Step 3: Clean up any leftover files**

Check for and remove:
- `agent/main 2.py` (already deleted in git)
- `web/src/components/demo-ivr/AdvancedCallControls 2.jsx` (already deleted in git)
- Any `.DS_Store` files
- Any `=6.10.0` file in agent/ (from a pip install typo)

```bash
rm -f "agent/=6.10.0"
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: cleanup and final verification pass"
```

---

## Summary

| Phase | Tasks | Key Deliverable |
|-------|-------|-----------------|
| 1: Stabilize | Tasks 1-3 | Clean git state, working app, credential consistency |
| 2: Pipeline | Tasks 4-7 | Unified `/api/agents/*`, config schema, event protocol |
| 3: Wizard | Tasks 8-11 | Voice wizard agent, dashboard panel, SignalWire resource |
| 4: Tests | Tasks 12-17 | 7 test suites covering schema, auth, events, components |
| 5: Polish | Tasks 18-20 | Demo reset/seed, demo tools UI, cleanup |

**Total: 20 tasks, ~60 steps**
