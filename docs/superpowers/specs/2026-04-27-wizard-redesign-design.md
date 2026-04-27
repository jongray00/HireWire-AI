# Wizard Redesign — Design Spec

**Date:** 2026-04-27
**Type:** UX redesign + prompt rewrite + post-prompt fix
**Builds on:** `2026-04-20-holistic-completion-design.md` (the inline wizard banner ships in that work; this spec adds a creation canvas alongside it and rewrites the wizard's behavior)

---

## Context

The current wizard has two visible problems:

1. **The agent preview never feels like a moment.** When the user says *"I want to create a new agent"*, the wizard's `preview_agent` event fires but renders into a small card embedded in the inline banner — easy to miss, no sense of progression. There's no focal "this is happening *right now*" surface.
2. **The wizard's post-prompt webhook fails.** It's wired to `${APP_DOMAIN}/api/post-prompt/wizard`, but the route's `insertCallLog` enforces a foreign key to `employees`, and `wizard` is not an employee — so even when SignalWire reaches the route, it returns a 500. There's no durable record of wizard calls, which makes debugging the conversation flow nearly impossible.

This spec redesigns the experience around a **creation canvas** that opens when the wizard starts working, rewrites the wizard's prompt using the POM (Prompt Object Model) into six well-bounded sections, adds a single new SWAIG tool for progress tracking, and makes wizard calls first-class entries in the call logs.

The inline banner from the holistic-completion plan stays as-is. Users keep watching the dashboard during the call. The canvas is an *additional* surface that appears on demand.

---

## Goals

- **Make agent creation a focal, watchable moment.** When the wizard starts gathering info, a two-column canvas (transcript + structured config) opens over the dashboard with a 4-step progress indicator.
- **Rewrite the wizard's prompt with POM** so the conversation is consistent across user archetypes (vague / specific / template-seeking / iterating / browsing).
- **Persist every wizard call** to the existing call_logs table with full transcript, summary, and a link to the built agent — searchable from `/dashboard/call-logs`.
- **No regressions** to the inline banner, existing employees, or the rest of the dashboard.

## Non-goals

- Edit-in-place in the canvas (voice-only redesign; clickable option chips remain visual confirmation only).
- Auto-starting ngrok or any environment automation.
- A separate wizard-sessions table or dedicated wizard-sessions UI page (we use call_logs).
- Branching "Quick / Custom / Template" mode picker (the wizard adapts implicitly via §2 Discovery).

---

## Architecture

```
                          Dashboard layout (root.tsx → /dashboard/*)
                                          │
                ┌─────────────────────────┼─────────────────────────┐
                │                                                   │
        WizardBanner (existing)                       WizardCreationCanvas (NEW)
        - Idle CTA / Active call mini bar            - Hidden until first wizard event
        - Mic, connection state, end call            - Two-column overlay panel
        - Owns useWizardCall hook                    - Subscribes to wizard-event broadcast
                │                                                   │
                └────────── window.dispatchEvent("wizard-event") ───┘
                                          │
                                  useWizardCall (hook)
                                  - Holds SignalWire client + session
                                  - Forwards SDK user_event → onEvent
                                  - NEW: forwards transcript partials → onTranscript
                                          │
                                          ▼
                                  SignalWire SDK
                                          │
                                  SWAIG → wizard agent
                                          │
                                Python: WizardAgent
                                - 6-section POM prompt
                                - Tools: ask_config_question, preview_agent,
                                  update_agent_preview, mark_checkpoint (NEW),
                                  create_agent, finalize_agent
                                - Each tool emits swml_user_event,
                                  including a wizard_said echo
                                          │
                                          ▼
                                Post-prompt: POST /api/post-prompt/wizard
                                - employees seeded with a hidden 'wizard' row
                                - Route stores wizard sessions in call_logs
                                  (employee_id='wizard'); FK satisfied
                                - built_agent_id field links the row to
                                  the employee that was created (if any)
```

Three responsibilities, three boundaries:

1. **Banner** owns the *call*. Mic permission, connection state, end-call button. Doesn't render the agent being built.
2. **Canvas** owns the *creation experience*. Transcript on the left, config + checkpoints on the right. Pure consumer of broadcast events.
3. **Wizard agent** owns the *conversation*. POM prompt drives behavior; tools emit events that hydrate the canvas; `mark_checkpoint` is the only new tool.

Banner ↔ Canvas don't import each other. They communicate only via the existing `window.dispatchEvent("wizard-event", {detail})` channel plus a new transcript channel from `useWizardCall`. Either component can break without taking the other down.

---

## Components

### `web/src/components/dashboard/WizardCreationCanvas.jsx` (NEW)

Visibility lifecycle:

- Hidden by default. Tracks a `hasReceivedFirstEvent` flag.
- Opens with a slide-up + fade-in (~250ms) on the first `agent_config_question` or `agent_preview` event during an active call.
- Stays open through the rest of the call.
- After the call ends *and* `agent_created` has fired: shows a "✨ Created" celebratory state for ~3s, then a "Close" / "Call your new agent" CTA. User-dismissed.
- If the call ends without `agent_created`: shows "Session ended — nothing was created" with a "Try again" button.

Layout — overlay panel (~85vw × 80vh, centered) over a `bg-black/50 backdrop-blur-sm` backdrop. Dashboard remains visible behind, dimmed.

```
┌─────────────────────────────────────────────────────────────────────┐
│  🧙 Setup Wizard            ●━━━━━━○━━━○━━━○   ●Live  10:23   [✕]  │
│                             Identity Voice  Caps  Review            │
├─────────────────────────────────┬───────────────────────────────────┤
│ 📜 Conversation                  │ 🤖 Building agent                │
│                                  │                                   │
│ Wizard: "Hi! What kind of agent  │   Name: Sarah                    │
│ would you like to build?"        │   Role: Billing Support          │
│                                  │   Voice: openai.shimmer          │
│ You: "A customer support bot"    │   Greeting: "Hi, this is …"      │
│                                  │   Capabilities: ─                │
│ Wizard: "Got it — what's it      │   Knowledge: ─                   │
│ called?"                         │   Hours: ─                       │
│                                  │                                   │
│ You: "Sarah"                     │ ─── Prompt preview ───            │
│                                  │   (assembled live as wizard      │
│ [partial: "she should handl…"]   │    fills sections)               │
└─────────────────────────────────┴───────────────────────────────────┘
```

Component state:

- `transcript: Array<{role: 'wizard'|'user', text: string, t: number, isPartial?: boolean}>` — appended on each transcript event.
- `config: { name, role, voice, greeting, prompt, functions[], knowledgeDocs[], businessHours, ... }` — merged from `agent_preview` / `update_agent_preview`.
- `currentQuestion: { question, options[], field } | null` — set on `agent_config_question`, cleared on the next `agent_preview` or `update_agent_preview`.
- `checkpoints: { identity: bool, voice: bool, capabilities: bool, review: bool }` — flipped by `wizard_checkpoint` events. Out-of-order events don't regress (only set true).
- `createdAgent: { id, name, role } | null` — set on `agent_created`.

Visual states for the checkpoint stepper:

- Empty circle = not reached.
- Filled circle with pulse = current (the most-recent reached checkpoint).
- Solid checkmark = passed.

Question overlay: when `currentQuestion` is set, the right column blurs slightly (`backdrop-blur-sm` on a child container) and a centered question card appears with the wizard's question + clickable option chips. Selecting an option does nothing locally; the user *speaks* the answer. Voice drives the call — the chips are visual confirmation.

Backdrop click does **not** dismiss the canvas. Only the explicit `[✕]` (after call ends) or the call-end + dismiss flow can close it.

### `web/src/components/dashboard/WizardBanner.jsx` (existing — minor change)

The banner stays as-is in idle and active states. One change: it no longer needs to render preview cards, the question overlay, or the created-agent confirmation in its center column — those move to the canvas. The banner's center column becomes either: connection state text, a brief "Speak to the wizard…" hint, or empty during active conversation.

The banner's debug panel from the diagnostic-instrumentation commit (`2978e3f`) stays — useful for mic / RTC diagnostics regardless of canvas state.

### `web/src/app/dashboard/layout.jsx` (existing — minor change)

Mount `WizardCreationCanvas` as a sibling to `WizardBanner`:

```jsx
<WizardBanner />
<WizardCreationCanvas />
```

Both components persist across all dashboard pages.

### `web/src/app/hooks/useWizardCall.js` (existing — extended)

Adds an `onTranscript` callback option:

```javascript
const { startCall, endCall, ... } = useWizardCall({
  onEvent: (e) => { /* SWAIG events as today */ },
  onTranscript: (line) => { /* {role, text, isPartial, t} */ },
});
```

Banner doesn't pass `onTranscript`. Canvas does. The hook subscribes to the SignalWire JS SDK's partial-recognition events for the user side; the exact event names need confirmation against the `@signalwire/js` version pinned in `web/package.json`. Likely candidates: a `prompt` event with partial text, or `call.updated` with `detail.partial_recognition`.

Wizard side of the transcript comes from new `wizard_said` events the wizard agent fires (see Events below). The hook merges both streams chronologically when forwarding to `onTranscript`.

Fallback: if the SDK doesn't expose partial recognition in the installed version, the hook only forwards `wizard_said` events to `onTranscript`, and the canvas reconstructs the user side from the post-prompt's `call_log` array after the call ends. Lower-quality demo, but still works.

### `web/src/app/dashboard/call-logs/page.jsx` (existing — extended)

- Existing rows render unchanged.
- New visual:
  - If `employeeId === 'wizard'` → render a 🧙 **Wizard Session** pill in wizard-purple instead of the employee name.
  - If `built_agent_id` is set → render a "→ Built: {employeeName}" link that opens that employee's detail page.
- One new filter chip set: `[All] [Employees] [Wizard]` — defaults to All. Lets you isolate wizard sessions when debugging.

`CallLogDetail.jsx` needs no changes — it already renders `call_log[]` from the raw payload, which is the canonical wizard transcript debug view.

---

## Events / Protocol

| Type | Source | Payload | Effect on canvas |
|---|---|---|---|
| `agent_config_question` | existing tool | `{question, options[], field}` | Shows question card; right column blurs |
| `agent_preview` | existing tool | `{name, role, voice, functions[], greeting, prompt, ...}` | Merges into `config`; clears any open question |
| `update_agent_preview` | existing tool | partial config fields | Merges into `config`; clears question |
| `wizard_checkpoint` ✨ NEW | new `mark_checkpoint` tool | `{stage: "identity"\|"voice"\|"capabilities"\|"review"}` | Advances stepper |
| `agent_created` | existing tool | `{employee: {id, name, role}}` | Switches canvas to "Created" celebratory state |
| `agent_ready` | existing tool | `{employee_id, swml_route}` | Adds "Call your new agent" CTA |
| `wizard_said` ✨ NEW | every SWAIG tool result | `{text}` | Appends wizard line to transcript |

### New SWAIG tool — `mark_checkpoint`

```python
@AgentBase.tool(
    name="mark_checkpoint",
    description=(
        "Mark a build-progress checkpoint reached. Call exactly once per stage, "
        "in order: identity, voice, capabilities, review."
    ),
    parameters={
        "type": "object",
        "properties": {
            "stage": {"type": "string", "enum": ["identity", "voice", "capabilities", "review"]}
        },
        "required": ["stage"]
    }
)
def mark_checkpoint(self, args, raw_data):
    stage = args.get("stage")
    result = SwaigFunctionResult("")  # silent — no spoken response
    result.swml_user_event({"type": "wizard_checkpoint", "stage": stage})
    return result
```

### `wizard_said` echo

Every existing SWAIG tool result already produces a spoken line ("I've displayed the options on your screen…", "I've shown a preview of {name}…"). We add a second `swml_user_event` per tool, type `wizard_said`, payload `{text: <same string>}`. Cheap, perfectly synced with TTS, and gives the canvas the wizard side of the transcript without touching SDK internals.

### No breaking changes

Banner and existing tests keep working unchanged. Existing event consumers (`WizardBanner`, the employees page highlight animation) continue to receive their events.

---

## POM Prompt for `WizardAgent`

The wizard's `__init__()` builds the prompt via `prompt_add_section()` calls. Six sections, mirroring the conversation arc:

### §1 Identity

> You are the **Agent Wizard** for Sally Sales — a warm, knowledgeable setup assistant who builds custom AI voice agents for the user through a short phone conversation. You make the experience feel collaborative and exciting, like working with a coworker who really knows the product. You speak in short, friendly sentences (a phone call, not a lecture). You do not pretend to be human, and you do not over-apologize. The user is on the dashboard with a creation canvas open in front of them — *let the screen do the heavy lifting for visual choices, and use your voice for guidance and rapport.*

### §2 Discovery — read the user's intent first

- Open with a 1-line greeting and a single open question: *"What kind of agent would you like to build today?"*
- Listen to the answer and silently classify:
  - **Specific** — user describes a concrete use case ("a support agent for my SaaS", "a scheduler for my dental office"). Skip ahead — name, role, and prompt are mostly inferable from what they said.
  - **Vague** — user says something like "just build me something" or "I'm not sure". Offer 3–4 starting points via `ask_config_question` (Sales / Support / Scheduling / Knowledge concierge).
  - **Template-seeking** — user says "I want to start from a template" or names a known type. Confirm and proceed with that template's defaults.
  - **Iterating** — user references an existing agent ("like Sarah but with email"). Acknowledge, copy what they referenced, and only collect the diffs.
  - **Curious / browsing** — user asks "what can you build?" Briefly enumerate the four archetypes above, then re-ask.
- After classification, call `mark_checkpoint("identity")` once you have a working name + role + a 1-sentence purpose.

### §3 Building — fill in the rest

- Always emit `preview_agent` immediately after identity is captured, even with partial info. The user wants to *see* progress in the canvas.
- For each remaining field, choose between voice-only and `ask_config_question`:
  - **Voice-only** for free-form fields (name, greeting wording, custom prompt phrasing, what to say when transferring).
  - **`ask_config_question`** for anything from a small fixed set (voice — `openai.shimmer` / `openai.nova` / `openai.alloy`; pace — friendly / professional / direct; capabilities — multi-select).
- After voice + greeting are confirmed, call `mark_checkpoint("voice")`.
- For capabilities, present them as multi-select via `ask_config_question` with options drawn from `list_available_functions`. After the user picks, call `update_agent_preview` with the function list, then walk through any per-capability config (transfer phone, hours, KB doc upload reminder, etc.). When all selected capabilities are configured, call `mark_checkpoint("capabilities")`.
- Use `update_agent_preview` aggressively — every time a field changes, fire it. The user is watching the canvas update in real time; silence on the canvas during a long stretch of conversation feels broken.
- Keep your spoken responses *short* — at most 2 sentences while the canvas is doing the visual work. Long explanations belong in the canvas, not in your voice.

### §4 Confirmation

- Before creating, recap in one breath: *"Okay — {name}, a {role} with {voice}'s voice, who can {top 2-3 capabilities}. Sound right?"*
- Wait for an explicit yes. If the user hesitates or asks for changes, treat it as another `update_agent_preview` cycle — don't push.
- On explicit confirmation, call `mark_checkpoint("review")`. Only then proceed to creation.
- If the user says "actually, scrap it" or "let's start over", clear the preview by calling `update_agent_preview` with empty fields and return to §2.

### §5 Creation

- Say something brief and confident — *"Building {name} now…"* — then call `create_agent` with the full config. While the call is in flight, silence is okay (the canvas will show progress).
- When `create_agent` returns successfully, call `finalize_agent` immediately.
- After finalize, say: *"{name} is live. You can call them right from the canvas, or end this call and I'll get out of your way."* The canvas's "Call your new agent" CTA does the rest.
- If `create_agent` fails, surface the error briefly (*"Hmm, the build didn't go through — {short reason}. Want to try again?"*) and offer to retry.

### §6 Conversation Style — cross-cutting

- 1–2 sentences per turn. Phone-call cadence, not chatbot.
- Don't read out long lists — defer to `ask_config_question` so the user sees options on screen instead.
- Don't say "I'm calling the function now" or narrate tool use. Just call the tool and let the screen update.
- Use the user's words back at them when summarizing ("a support agent for billing questions" → use "billing support agent" not "customer service representative").
- Never invent capabilities the system doesn't have. If the user asks for something unsupported (video call, payment processing, integration with their CRM), say so plainly and offer the closest supported behavior.
- When in doubt, ask. One question, then listen.

### Other prompt-level config

- `temperature: 0.7` (down from 0.8 — more consistent tool-calling).
- Keep the existing `add_language(...)` block; expand `function_fillers` to cover `mark_checkpoint` (silent — no filler) and the silent-during-create case (e.g., add a "Building it now…" filler for `create_agent`).
- `set_post_prompt(...)` is rewritten to also emit `agent_built_id` as a top-level JSON field (see Post-prompt section).

---

## Post-prompt + wizard call logging

### Schema changes (`web/src/lib/db.ts`)

`employees` table — two new columns:

- `kind TEXT NOT NULL DEFAULT 'employee'` (values: `'employee'` | `'wizard'`)
- `is_hidden INTEGER NOT NULL DEFAULT 0`

`call_logs` table — keep FK to `employees`. Add one nullable column:

- `built_agent_id TEXT REFERENCES employees(id)` — set when the wizard's post-prompt JSON includes `agent_built_id`.

Migration runs idempotently at startup using SQLite's `PRAGMA table_info(...)` + try-add idiom (since SQLite has no `ADD COLUMN IF NOT EXISTS`). Fired by both the agent process and the web process at boot — whichever boots first wins; the second is a no-op.

### Seed step

On startup of either process, insert-or-ignore one row:

```sql
INSERT OR IGNORE INTO employees (id, name, role, kind, is_hidden)
VALUES ('wizard', 'Setup Wizard', 'Agent Builder', 'wizard', 1);
```

Satisfies the FK with no further code branching. `is_hidden=1` keeps it out of the employees list.

### Existing-query filter changes

- `getEmployeesByProject(...)` adds `WHERE is_hidden = 0 AND kind = 'employee'`.
- All call-log queries unchanged.

### Post-prompt route (`web/src/app/api/post-prompt/[[...path]]/route.js`)

- Path-segment dispatch unchanged.
- The route already calls `getEmployeeById(employeeId)`. With the seed in place, `'wizard'` returns the pseudo-employee row — no FK error.
- Parse `post_prompt_data.agent_built_id` (the new top-level field the wizard's `set_post_prompt` produces) and pass it to `insertCallLog` as `built_agent_id`.

### Wizard's post-prompt JSON

The wizard's `set_post_prompt(...)` text is rewritten to produce:

```json
{
  "summary": "User built a billing-support agent named Sarah with email follow-ups.",
  "caller_intent": "Build a customer support agent for billing questions",
  "outcome": "resolved" | "abandoned" | "follow_up_needed",
  "sentiment": "positive" | "neutral" | "negative",
  "topics": ["support", "billing", "voice-config"],
  "follow_up": null,
  "agent_built_id": "emp_a1b2c3"
}
```

`agent_built_id` is null when no agent was created (e.g., the user hung up mid-conversation).

### Net result

Every wizard call produces a row in `call_logs` you can open and walk through line-by-line, with summary metadata, identical to how an employee call is debugged today. The transcript view (`CallLogDetail.jsx`) renders the full `call_log[]` chronologically — wizard turns and user turns interleaved — which is the canonical debugging surface for wizard progression.

---

## Testing strategy

Frontend (Vitest + Testing Library) — extends the existing 9-test-file suite:

1. **`WizardCreationCanvas.test.jsx`** *(new)*
   - Hidden by default
   - Opens on first `agent_config_question` or `agent_preview` event
   - Stays hidden if call ends without any wizard event
   - Checkpoint stepper advances on `wizard_checkpoint` events in correct order
   - Out-of-order checkpoint events don't regress the stepper
   - `agent_created` flips to celebratory state; `agent_ready` shows the "Call your new agent" CTA
   - `[✕]` only enabled when call has ended
   - Question card renders options as chips
2. **`useWizardCall.test.js`** *(new)*
   - `onTranscript` callback fires on simulated SDK partial events
   - Falls back gracefully when SDK doesn't expose partials (no errors, just no transcript)
   - `onEvent` still fires unchanged for SWAIG events (regression)
3. **Wizard flow integration** *(extend existing `wizard-flow.test.jsx`)*
   - Full new sequence: question → checkpoint(identity) → preview → update_preview → checkpoint(voice) → checkpoint(capabilities) → review → checkpoint(review) → created → ready
   - Assert canvas state at each step (transcript line count, config field values, stepper position)
4. **Post-prompt route** *(extend `web/src/app/api/__tests__/post-prompt.test.js`)*
   - `POST /api/post-prompt/wizard` with `agent_built_id` → returns 200, no FK error, `built_agent_id` stored
   - `POST /api/post-prompt/{nonexistent}` still 500s (regression)
   - Wizard pseudo-employee seeding is idempotent (call init twice → single row)
5. **Schema migration** *(new — `web/src/lib/__tests__/db.migration.test.js`)*
   - Fresh DB → has `kind`, `is_hidden`, `built_agent_id` columns
   - Existing DB without those columns → migration adds them without data loss
   - `getEmployeesByProject` filters out wizard rows
6. **Call Logs filter chip** *(extend existing call-logs `components.test.jsx`)*
   - `[Wizard]` chip shows only wizard rows
   - `[Employees]` chip shows only employee rows
   - `built_agent_id` renders the "→ Built: {name}" link

Backend (Python — lightweight):

7. **Wizard agent boot smoke** — `python -c "from agent.main import app; print('ok')"` confirms the new tool, prompt sections, and `wizard_said` echo all parse and FastAPI boots without import errors. (No formal pytest harness exists in `agent/`; adding one is out of scope.)
8. **Manual demo verification** — run the full demo from `docs/DEMO_SCRIPT.md` (which gets updated). End-to-end with ngrok up; confirm canvas opens on first event, checkpoints advance, `agent_created` celebratory state appears, post-prompt fires, the call appears in `/dashboard/call-logs` with a 🧙 pill and a built-agent link.

No tests assert the POM prompt text — LLM behavior isn't deterministic enough. The integration test asserts the *event protocol* holds regardless of phrasing.

### Acceptance gate before merge

- All Vitest suites pass (existing 111 + ~15 new = ~126 total).
- Manual demo run-through completes both end-to-end paths: wizard call with agent created; wizard call abandoned (no agent created).
