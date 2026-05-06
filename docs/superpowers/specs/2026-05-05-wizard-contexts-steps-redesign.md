# Wizard Agent Redesign — Contexts/Steps State Machine

**Date:** 2026-05-05
**Status:** Approved (brainstorm)
**Owner:** Jon Gray

## Problem

The wizard agent in `agent/main.py` (`WizardAgent`, lines 760-1311) is built on a single-prompt-with-soft-rules architecture. Its system prompt asks the LLM to mark four checkpoints (identity → voice → capabilities → review) and then call `create_agent`, but the only enforcement is a "HARD RULE" string in the prompt body.

The captured failure session at `/Users/jonny/Downloads/call-wizard-1778011454393-2lyz8d.json` shows the failure mode in production:

- The model marked `voice`, `capabilities`, and `review` checkpoints, skipped `identity` entirely, and never called `create_agent`.
- The wizard issued exactly one `wizard_said` user_event (the post-preview question) over a 119-second call. Everything between SWAIG calls is invisible to post-prompt diagnostics.
- The captured `agent_preview` had `prompt: ""` — only `prompt_summary` was set. Even if the model *had* called `create_agent`, the agent it created would have shipped with no system prompt.
- Final state: `builtAgentId: null`, `error: null` — silent failure.

The root cause is structural: **the LLM has free choice over which SWAIG functions to call and in what order**, and prompt-driven instructions can't reliably constrain that.

## Goals

1. Replace the prompt-driven wizard with a server-enforced state machine using the SignalWire Agents SDK Contexts/Steps system.
2. Make `create_agent` physically unreachable until the user has provided the required information through prior steps. The SDK gates the model's tool list per step.
3. Capture the full conversation transcript in every SWAIG handler via `swaig_post_conversation: True`, so post-mortem diagnostics have content.
4. Allow in-place edits during review (the user can correct any field without leaving the review step) so corrections don't trigger a state-machine reset.
5. Preserve the existing frontend integration: same `/swml/wizard` route, same `wizard_checkpoint`, `agent_preview`, `agent_created`, `agent_ready`, `wizard_said` user_event names. The dashboard canvas does not change.

## Non-Goals

- Changes to `web/src/app/api/signalwire/create-virtual-employee/route.js` or any frontend route.
- Changes to `WizardBanner.jsx`, `WizardCreationCanvas.jsx`, `useWizardCall.js`, or any frontend component.
- Changes to authentication or credential lookup (`_wizard_lookup_user_credentials` keeps its current shape).
- Changes to the post-prompt JSON schema.
- Adding Python unit tests for the agent backend (no existing scaffolding; out of scope here).

## Decisions Locked During Brainstorm

| # | Question | Decision |
|---|---|---|
| Q1 | Architecture | **B** — Contexts/Steps full refactor |
| Q2 | Back-stepping behavior | **C** — in-place edits inside review (`update_agent_preview` available throughout review; no formal back-step transitions) |

## Design

### Step machine

Five steps, each with its own POM prompt section and a tight allowed-SWAIG set:

| # | Step | Job | Allowed SWAIG | Valid next steps |
|---|---|---|---|---|
| 1 | `identity` | Collect agent name, role, prompt summary | `set_identity` | `voice` |
| 2 | `voice` | Pick a voice from the menu | `set_voice`, `list_voices` | `capabilities` |
| 3 | `capabilities` | Select enabled functions + greeting | `set_capabilities` | `review` |
| 4 | `review` | Recap, in-place edits, commit | `update_agent_preview`, `create_agent` | `complete` |
| 5 | `complete` | Confirm success, offer "call your new agent" | `finalize_agent` | (terminal) |

Forward-only with one exception: the `review` step accepts unbounded `update_agent_preview` calls without transitioning. This honors Q2 = C.

The model literally cannot call `create_agent` from any step other than `review` because the SDK's tool-list construction excludes it.

### SWAIG inventory

All seven SWAIGs are defined on the new `WizardAgent` class, each with a function-level guard that re-validates state and returns a spoken-text error if violated.

| Function | Step(s) | Params | Effect |
|---|---|---|---|
| `set_identity` | `identity` | `name`, `role`, `prompt_summary` | Merges into `global_data.agent_draft`, fires `agent_preview` user_event, transitions to `voice`, fires `wizard_checkpoint(stage="identity")` |
| `list_voices` | `voice` | — | Fires `wizard_voices` user_event, returns voice menu as spoken text. Does not transition. |
| `set_voice` | `voice` | `voice` | Merges, fires `agent_preview`, transitions to `capabilities`, fires `wizard_checkpoint(stage="voice")` |
| `set_capabilities` | `capabilities` | `functions: string[]`, `greeting: string` | Merges, fires `agent_preview`, transitions to `review`, fires `wizard_checkpoint(stage="capabilities")` |
| `update_agent_preview` | `review` | partial draft | Merges into `agent_draft`, fires `agent_preview`. **Does not transition.** |
| `create_agent` | `review` | — | Reads complete `agent_draft` from `global_data`. If `prompt` is empty, falls back to `prompt_summary`. Validates `name`, `role`, non-empty effective `prompt`, `voice`, `greeting` are all present. Looks up credentials. POSTs to frontend. On success: writes `created_agent` to `global_data`, fires `agent_created`, transitions to `complete`, fires `wizard_checkpoint(stage="review")`. On failure: returns spoken error, stays in `review`. |
| `finalize_agent` | `complete` | — | Fires `agent_ready` user_event, returns call-fabric address as spoken text. Terminal. |

The existing SWAIGs `mark_checkpoint`, `ask_config_question`, `preview_agent`, and `list_available_functions` are deleted. Step transitions emit `wizard_checkpoint` user_events with the same shape the frontend already consumes (`{type: "wizard_checkpoint", stage: "identity"|"voice"|"capabilities"|"review"}`), so `WizardCreationCanvas.jsx` continues to work unchanged.

### State shape (`global_data`)

```json
{
  "agent_draft": {
    "name": "",
    "role": "",
    "prompt_summary": "",
    "prompt": "",
    "voice": "",
    "language": "en-US",
    "greeting": "",
    "functions": []
  },
  "created_agent": null,
  "current_step": "identity"
}
```

`current_step` mirrors the SDK's own step state for diagnostics and as a defense-in-depth guard inside SWAIG handlers. The SDK's step routing is the primary gate; this field is the audit trail.

`created_agent` is populated only after `create_agent` succeeds: `{id, name, callFabricAddress}`.

### Step transitions

Transitions happen via `SwaigFunctionResult` actions returned from the function handler. The Contexts/Steps system advances the call via the result; there is no separate "transition" SWAIG. Each transitioning function returns:

```python
return (
    SwaigFunctionResult(spoken_text)
        .update_global_data({"agent_draft": merged_draft, "current_step": next_step})
        .swml_user_event({"type": "wizard_checkpoint", "stage": current_step})
        # plus the step-advance action
)
```

The exact step-advance action API must be verified against `docs/signalwire-agents/docs/contexts_guide.md` during implementation (the contexts guide documents `set_valid_steps()` and `set_functions(["none"])` as configuration, but the runtime advance action — likely `result.next_step()` or returned via the step's `criteria` — needs concrete validation against the SDK source). This is the single highest-risk area of the implementation; the implementer must not skip the doc check.

Server-side guards inside each SWAIG handler re-check `raw_data["global_data"]["current_step"]` before doing anything; this catches the edge case where SDK gating is bypassed (e.g., test harnesses, malformed SWML). Guard violations return a spoken error and do not mutate state.

### Per-step prompts (POM sections)

Each step has a short, focused prompt set via `context.set_prompt(...)` or equivalent. Approximate length:

- **`identity`** (4 lines): "Greet the caller. Ask what kind of agent they want and what to call it. When you have a name, role, and one-sentence description, call `set_identity` and the wizard will move to the next step."
- **`voice`** (3 lines): "Offer a short voice menu (you can call `list_voices` to recite the options). Once they pick, call `set_voice`."
- **`capabilities`** (4 lines): "Confirm the greeting line and which capabilities they want from this short list: transfer-to-human, send-summary-sms, schedule-callback, check-business-hours, collect-customer-info, send-email. When confirmed, call `set_capabilities`."
- **`review`** (6 lines): "Recap the full agent. Accept edits via `update_agent_preview`. When the user explicitly confirms 'create it' or 'looks good, build it', call `create_agent`. If `create_agent` fails, tell them what went wrong and offer to retry."
- **`complete`** (3 lines): "Confirm the agent was created. Offer to call it. When they're ready, call `finalize_agent` and the wizard will hand off."

### Transcript / observability

- `self.set_params({"swaig_post_conversation": True})` is set once in `__init__`. Every SWAIG handler now receives `raw_data["call_log"]` (since last context reset) and `raw_data["raw_call_log"]` (full call history).
- Each SWAIG handler logs (INFO level, one line) `[wizard:{call_id}:{step}] {function_name} entered (call_log_n={n})` so the agent-side log shows the conversation length captured at each transition.
- `wizard_said` user_events continue to fire from SWAIG handlers so the dashboard transcript keeps populating.
- For post-mortem: post-prompt logging is unchanged; for live debugging the agent log now has full transcript context per SWAIG call.

### Failure handling

- **`create_agent` HTTP failure** (frontend unreachable, backend rejects, etc.): return `SwaigFunctionResult("The build didn't go through — {error}. Want me to retry, or change something first?")`. Do not transition. The user remains in `review` and can either ask for retry (model re-calls `create_agent`) or call `update_agent_preview` to change something.
- **Credential lookup returns None**: `create_agent` returns "I couldn't find your SignalWire credentials — make sure you're logged in on the dashboard, then try again." Stay in `review`.
- **Dedup guard hit** (`_wizard_create_inflight` already has the key): return "I'm already creating that one — give me a few seconds." Same key shape (`{call_id}:{name}`) as today.
- **State-machine guard violation** (handler called from wrong step): return "I shouldn't be doing that yet — let me try again." Log a warning. Do not mutate state. This is defense-in-depth; the SDK's step gating should make this unreachable in normal flow.
- **Call drops mid-flow**: SDK manages teardown. `created_agent` stays null. Post-prompt diagnostics see the partial draft and the final step reached.

### Migration strategy

**In-place replacement** of `WizardAgent` in `agent/main.py`. Same `/swml/wizard` route, same env vars, same factory mount in `__main__`. The frontend is unaffected.

The class body changes substantially. Everything outside the class — `_wizard_lookup_user_credentials`, `_wizard_create_employee_via_frontend`, `_wizard_create_inflight`, the `WEB_DB_PATH` and `FRONTEND_URL` env vars, the `on_swml_request` post-prompt URL setup — keeps its current shape. Only the agent definition (lines ~760-1311 today) is rewritten.

This contains the blast radius. If the new wizard misbehaves, the surface to investigate is the new class only; the I/O boundary (frontend POST, credential lookup, dedup) is unchanged.

## Out-of-scope follow-ups

- Frontend canvas redesign (the canvas continues to work via the preserved user_event shapes; visual polish is separate).
- Python unit tests for `WizardAgent` SWAIG handlers and step gating. Worth doing later but the agent backend has no existing pytest scaffolding.
- Per-step backstepping with formal transitions (Q2 alternative B). Punted; revisit if `update_agent_preview` in-place edits prove insufficient in user testing.
- Auto-finalize after review (alternative path where the server triggers `create_agent` from `mark_checkpoint("review")` without an explicit second SWAIG). Punted; the current design's two-call pattern (`update_agent_preview` to settle, `create_agent` to commit) is closer to user mental model.

## Testing

- **Vitest** must stay green at 162 passed / 3 pre-existing WizardBanner failures (no Python changes affect frontend tests).
- **Smoke**: `python3 agent/main.py` starts without traceback; log line `Wizard agent mounted at /swml/wizard` appears; `curl /swml/wizard` returns 307 (redirect to authed SWML).
- **Manual call**: place a wizard call from the dashboard. Walk through identity → voice → capabilities → review → create → complete. Verify the new agent appears on `/dashboard/employees`. Verify `finalize_agent` exposes the call-fabric address.
- **Failure injection** (manual): toggle `FRONTEND_URL` to a bad value, place a call, get to review, attempt create. Confirm the spoken error surfaces and the call stays in review. Restore env, ask for retry, confirm success.
