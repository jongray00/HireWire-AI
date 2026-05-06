# Wizard Agent Contexts/Steps Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the prompt-driven `WizardAgent` in `agent/main.py` with a SignalWire Agents SDK Contexts/Steps state machine that physically gates `create_agent` until the user has progressed through identity → voice → capabilities → review steps.

**Architecture:** Five steps in one Context: `identity`, `voice`, `capabilities`, `review`, `complete`. Each step has its own POM prompt and allowed-SWAIG set. State lives in SDK-managed `global_data` (`agent_draft`, `created_agent`, `current_step`). `swaig_post_conversation: True` enables full transcript visibility. The frontend, credential lookup, and the `_wizard_create_employee_via_frontend` POST helper are unchanged.

**Tech Stack:** Python 3.12, signalwire-agents SDK (Contexts/Steps system), FastAPI, better-sqlite3 (frontend side), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-05-wizard-contexts-steps-redesign.md`

**Working directory:** `/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI`. All relative paths in this plan are relative to that root.

**Standing user rule:** **DO NOT run `git add` or `git commit`** at any point. Each task ends with the file changes left uncommitted in the working tree. The user gates commits explicitly.

**Pre-flight check (run once before Task 0):**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/agent" && python3 -c "import signalwire_agents; print('sdk ok'); import main; print('main ok')" 2>&1 | tail -5
```

Expected: `sdk ok` and `main ok`. If either fails, fix the import error before starting Task 0.

---

## File Structure

**Modified files:**

| File | Change |
|---|---|
| `agent/main.py` | Replace `WizardAgent` class (lines ~760-1311) with new contexts-based class. Everything outside the class stays. |
| `docs/superpowers/plans/2026-05-05-wizard-contexts-steps-redesign.md` | This plan; Task 0 appends an SDK API reference section to it. |

**No new files.** No frontend changes.

---

## Task 0 — SDK Contexts/Steps API verification (pre-flight research)

**Files:**
- Read: `/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/docs/signalwire-agents/docs/contexts_guide.md`
- Read: `/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/docs/signalwire-agents/examples/contexts_demo.py`
- Read: `/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/docs/signalwire_agents/core/function_result.py` (for SwaigFunctionResult action chain)
- Append findings to: `docs/superpowers/plans/2026-05-05-wizard-contexts-steps-redesign.md` (this file) under a new `## SDK API Reference (Task 0 output)` section at the bottom.

**Context:** The spec flags this as the highest-risk area. We know `set_valid_steps()` and `set_functions([...])` exist as configuration. We do NOT yet know the exact runtime API for advancing the call from one step to the next from inside a SWAIG handler. Subsequent tasks depend on getting this right.

- [ ] **Step 1: Read contexts_guide.md end-to-end**

```bash
wc -l "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/docs/signalwire-agents/docs/contexts_guide.md"
```

Then read the entire file. Capture: how to define a Context, how to add Steps, how to set per-step prompts, how to set `set_valid_steps`, how to set `set_functions`, and crucially **how a step is advanced at runtime** (return value from a SWAIG, a `SwaigFunctionResult.next_step()` action, an `add_action("next_step", ...)`, or some other mechanism).

- [ ] **Step 2: Read contexts_demo.py**

```bash
wc -l "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/docs/signalwire-agents/examples/contexts_demo.py"
```

Then read the file. This is the canonical multi-step example per our SDK study. Look at how each SWAIG handler returns its `SwaigFunctionResult` — specifically what action(s) it includes to advance the step.

- [ ] **Step 3: Skim function_result.py for step-related actions**

```bash
grep -nE "step|context|next_step|set_step|swml_user_event" "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/docs/signalwire_agents/core/function_result.py" | head -30
```

Capture the exact method names and signatures for any step-advance / context-switch helper. Also capture the method for emitting a `swml_user_event` (we need this for `wizard_checkpoint` events).

- [ ] **Step 4: Append findings to this plan file**

Append a new top-level section to `docs/superpowers/plans/2026-05-05-wizard-contexts-steps-redesign.md`:

```markdown
## SDK API Reference (Task 0 output)

### Defining a context with steps

```python
# concrete code from contexts_demo.py / contexts_guide.md, with citations
```

### Per-step configuration

```python
# set_valid_steps, set_functions, set_prompt — concrete examples
```

### Advancing a step from a SWAIG handler

```python
# the exact API call: e.g., result.next_step("voice") or whatever the SDK uses
```

### Emitting a swml_user_event from a SWAIG handler

```python
# the exact API for emitting custom events the frontend consumes
```

### Reading global_data inside a SWAIG handler

```python
draft = raw_data.get("global_data", {}).get("agent_draft", {})
```

### Updating global_data from a SWAIG handler

```python
return SwaigFunctionResult("...").update_global_data({"agent_draft": new_draft})
```
```

Each subsection must contain real code from the docs/source — no paraphrase, no "TBD". File:line citations.

- [ ] **Step 5: Sanity-check that subsequent tasks can use this API**

Read Task 1's `WizardAgent` skeleton stub below and confirm the API you documented can express it. Specifically:
- Can a SWAIG handler return a `SwaigFunctionResult` that BOTH updates `global_data` AND advances to a named step AND emits a `swml_user_event`? If not, document the workaround in your appended section.
- If the SDK uses a different idiom (e.g., contexts must be declared at agent-init time, not amended), update Task 1 inline with the corrected pattern.

- [ ] **Step 6: Stage but do not commit**

Leave the appended section in the plan file uncommitted. Report back with a paste of the appended section so the controller can confirm before dispatching Task 1.

---

## Task 1 — WizardAgent skeleton with all 5 steps stubbed

**Files:**
- Modify: `agent/main.py` (replace `WizardAgent` class)

**Context:** Delete the entire old `WizardAgent` class body and replace with a new class that defines the contexts/steps structure with empty SWAIG handlers. This task verifies the skeleton boots; behavior comes in Tasks 2-5.

The class must:
- Inherit `AgentBase`
- Be mounted at `/swml/wizard` (route is preserved)
- Set `swaig_post_conversation: True`
- Define one Context with five Steps: `identity`, `voice`, `capabilities`, `review`, `complete`
- Each Step has a placeholder prompt (one line: `"[Step: <name>] WIP"`)
- Each Step's allowed functions are wired but their handler bodies just return `SwaigFunctionResult("[stub]")`
- Initial step: `identity`
- Initial `global_data`: `{"agent_draft": {…}, "created_agent": null, "current_step": "identity"}` (per the spec's state-shape definition)
- Preserve `on_swml_request` (sets the post-prompt URL based on `APP_DOMAIN`/headers — copy the existing logic from the old class)

- [ ] **Step 1: Capture current line range of the old WizardAgent class**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && grep -nE "^class WizardAgent|^# ---*|^class [A-Z]" agent/main.py | head -10
```

Note the start line of `class WizardAgent` and the start line of the next top-level definition (or `if __name__ == "__main__":` block). The deletion range is `[wizard_start, next_thing - 1]` inclusive.

- [ ] **Step 2: Read the existing on_swml_request implementation**

```bash
grep -n "on_swml_request\|APP_DOMAIN\|set_post_prompt_url" agent/main.py | head -10
```

Read lines `(on_swml_request_start - 5)` to `(on_swml_request_start + 30)`. Copy the body so Task 1's new class preserves it identically — same env-var precedence, same fallback to headers, same final URL shape.

- [ ] **Step 3: Replace the WizardAgent class**

Delete the lines identified in Step 1. In their place, write the new class. The class structure:

```python
class WizardAgent(AgentBase):
    def __init__(self, **kwargs):
        super().__init__(
            name="Agent Wizard",
            route="/swml/wizard",
            host="0.0.0.0",
            port=3000,
            **kwargs,
        )

        # Voice / language
        self.set_params({
            "swaig_post_conversation": True,
        })
        self.add_language(name="English", code="en-US", voice="openai.shimmer")

        # Initial call-scoped state
        self.set_global_data({
            "agent_draft": {
                "name": "",
                "role": "",
                "prompt_summary": "",
                "prompt": "",
                "voice": "",
                "language": "en-US",
                "greeting": "",
                "functions": [],
            },
            "created_agent": None,
            "current_step": "identity",
        })

        # Build the wizard context with five steps.
        # NOTE: the exact API for context+step construction is per the
        # Task 0 SDK reference appended to the plan file. The block below
        # is the structural intent; the implementer must fit it to the
        # API confirmed in Task 0.
        self._build_wizard_context()

        # Post-prompt summarization
        self.set_post_prompt(
            'Summarize this wizard session as JSON with exactly these fields: '
            '"summary", "caller_intent", "outcome", "sentiment", "topics", '
            '"follow_up", "agent_built_id". Respond ONLY with the JSON object.'
        )

    def _build_wizard_context(self):
        """Assemble the wizard's single Context with its five Steps.

        Per Task 0 SDK reference, each step gets:
          - a per-step prompt (POM)
          - set_valid_steps([...]) for forward-progression gating
          - set_functions([...]) for tool-list gating
        """
        # Identity step ------------------------------------------------
        identity = self._add_step("identity")
        identity.set_prompt("[Step: identity] WIP")
        identity.set_valid_steps(["voice"])
        identity.set_functions(["set_identity"])

        # Voice step ---------------------------------------------------
        voice = self._add_step("voice")
        voice.set_prompt("[Step: voice] WIP")
        voice.set_valid_steps(["capabilities"])
        voice.set_functions(["set_voice", "list_voices"])

        # Capabilities step --------------------------------------------
        capabilities = self._add_step("capabilities")
        capabilities.set_prompt("[Step: capabilities] WIP")
        capabilities.set_valid_steps(["review"])
        capabilities.set_functions(["set_capabilities"])

        # Review step --------------------------------------------------
        # in-place edits via update_agent_preview (no transition);
        # commit via create_agent (transitions to complete on success).
        review = self._add_step("review")
        review.set_prompt("[Step: review] WIP")
        review.set_valid_steps(["complete"])
        review.set_functions(["update_agent_preview", "create_agent"])

        # Complete step ------------------------------------------------
        complete = self._add_step("complete")
        complete.set_prompt("[Step: complete] WIP")
        # terminal — no valid_steps
        complete.set_functions(["finalize_agent"])

    def on_swml_request(self, request_data=None, callback_path=None, request=None):
        # Identical body to the existing implementation. Copy verbatim from
        # the old class body captured in Step 2.
        # (Implementer: paste the body exactly as it was; do not refactor.)
        pass  # REPLACE this pass with the captured body

    # ---- SWAIG handlers (stubs for Task 1) ---------------------------

    @AgentBase.tool(
        name="set_identity",
        description="Record the new agent's name, role, and one-sentence summary. Advances to the voice step.",
        parameters={
            "name": {"type": "string", "description": "Agent's display name"},
            "role": {"type": "string", "description": "Agent's role label"},
            "prompt_summary": {"type": "string", "description": "One or two sentences describing what the agent does"},
        },
        required=["name", "role", "prompt_summary"],
    )
    def set_identity(self, args, raw_data):
        return SwaigFunctionResult("[stub] set_identity called")

    @AgentBase.tool(
        name="list_voices",
        description="Recite the available voice options. Does not transition steps.",
        parameters={},
        required=[],
    )
    def list_voices(self, args, raw_data):
        return SwaigFunctionResult("[stub] list_voices called")

    @AgentBase.tool(
        name="set_voice",
        description="Pick a voice for the new agent. Advances to capabilities.",
        parameters={
            "voice": {"type": "string", "description": "Voice ID (e.g. openai.nova)"},
        },
        required=["voice"],
    )
    def set_voice(self, args, raw_data):
        return SwaigFunctionResult("[stub] set_voice called")

    @AgentBase.tool(
        name="set_capabilities",
        description="Record the agent's enabled functions and greeting line. Advances to review.",
        parameters={
            "functions": {"type": "array", "items": {"type": "string"}, "description": "SWAIG function ids"},
            "greeting": {"type": "string", "description": "Opening line the new agent will say"},
        },
        required=["functions", "greeting"],
    )
    def set_capabilities(self, args, raw_data):
        return SwaigFunctionResult("[stub] set_capabilities called")

    @AgentBase.tool(
        name="update_agent_preview",
        description="Modify any field in the agent draft during review. Does not transition.",
        parameters={
            "name": {"type": "string"},
            "role": {"type": "string"},
            "prompt": {"type": "string"},
            "prompt_summary": {"type": "string"},
            "voice": {"type": "string"},
            "greeting": {"type": "string"},
            "functions": {"type": "array", "items": {"type": "string"}},
        },
        required=[],
    )
    def update_agent_preview(self, args, raw_data):
        return SwaigFunctionResult("[stub] update_agent_preview called")

    @AgentBase.tool(
        name="create_agent",
        description="Commit the reviewed agent. Reads the full draft from call state.",
        parameters={},
        required=[],
    )
    def create_agent(self, args, raw_data):
        return SwaigFunctionResult("[stub] create_agent called")

    @AgentBase.tool(
        name="finalize_agent",
        description="Hand off the new agent to the user (call-fabric address).",
        parameters={},
        required=[],
    )
    def finalize_agent(self, args, raw_data):
        return SwaigFunctionResult("[stub] finalize_agent called")
```

The implementer must:
1. Use the exact API patterns confirmed by Task 0 (e.g., if the SDK uses `add_context("wizard").add_step("identity")...` instead of `self._add_step("identity")`, adapt.)
2. Keep the on_swml_request body byte-for-byte identical to the old class.
3. Not introduce any helper file imports beyond what `signalwire_agents` already exposes.

- [ ] **Step 4: Smoke test the import + boot**

```bash
lsof -ti :8000 | xargs kill 2>/dev/null; sleep 1
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/agent" && python3 main.py > /tmp/wizard-task1.log 2>&1 &
echo $! > /tmp/wizard-task1.pid
sleep 5
grep -E "Application startup complete|Wizard agent mounted at|Traceback|SyntaxError|ImportError" /tmp/wizard-task1.log | head -10
kill $(cat /tmp/wizard-task1.pid) 2>/dev/null
```

Expected:
- `Application startup complete.`
- `🧙 Wizard agent mounted at /swml/wizard` (or equivalent log)
- No `Traceback` / `SyntaxError` / `ImportError`

If it fails, the most likely cause is the contexts/steps API differing from the stub above — re-read Task 0's findings and adjust before reporting back.

- [ ] **Step 5: Stage but do not commit**

Working tree shows `M agent/main.py`. Do not run `git add` or `git commit`.

---

## Task 2 — State-collection SWAIGs (set_identity, list_voices, set_voice, set_capabilities)

**Files:**
- Modify: `agent/main.py` (the four SWAIG handler bodies + add private helpers + replace placeholder per-step prompts on the four early steps)

**Context:** Implement the four "fill in a slot" SWAIGs that progress the call through identity → voice → capabilities → review. Each one merges its inputs into `agent_draft`, fires an `agent_preview` user_event so the dashboard updates, fires a `wizard_checkpoint` user_event so the canvas marks the stage complete, and advances to the next step. They share enough structure to extract a helper.

The existing canvas at `web/src/components/dashboard/WizardCreationCanvas.jsx` listens for these event shapes:
- `agent_preview` — `{type: "agent_preview", name, role, prompt_summary, voice, functions, greeting, prompt, ...}`
- `wizard_checkpoint` — `{type: "wizard_checkpoint", stage: "identity"|"voice"|"capabilities"|"review"}`

Preserve those shapes exactly.

- [ ] **Step 1: Add private helper methods to WizardAgent**

Insert these helpers after `_build_wizard_context` and before the SWAIG handlers:

```python
    # ---- Private helpers ---------------------------------------------

    def _merge_draft(self, raw_data, updates: dict) -> dict:
        """Merge updates into the current agent_draft from global_data.
        Returns the merged dict (caller passes to update_global_data)."""
        current = (raw_data or {}).get("global_data", {}).get("agent_draft", {}) or {}
        # shallow merge; keep keys that updates didn't set
        merged = {**current, **{k: v for k, v in updates.items() if v is not None}}
        return merged

    def _agent_preview_event(self, draft: dict) -> dict:
        """Shape an agent_preview user_event payload from a draft dict."""
        return {
            "type": "agent_preview",
            "name": draft.get("name", ""),
            "role": draft.get("role", ""),
            "prompt_summary": draft.get("prompt_summary", ""),
            "voice": draft.get("voice", ""),
            "functions": draft.get("functions", []),
            "greeting": draft.get("greeting", ""),
            "prompt": draft.get("prompt", ""),
        }

    def _checkpoint_event(self, stage: str) -> dict:
        """Shape a wizard_checkpoint user_event payload."""
        return {"type": "wizard_checkpoint", "stage": stage}

    def _wizard_said(self, text: str) -> dict:
        """Shape a wizard_said user_event for transcript mirroring."""
        return {"type": "wizard_said", "text": text}
```

- [ ] **Step 2: Replace the identity step's prompt**

Find the `identity = self._add_step("identity")` block in `_build_wizard_context`. Replace `identity.set_prompt("[Step: identity] WIP")` with:

```python
        identity.set_prompt(
            "You are starting a wizard call to build a new AI voice agent for the user. "
            "Greet them warmly. Ask one question: what kind of agent do they want to build, "
            "and what should it be called? When they answer, derive a name (Title Case, no spaces, "
            "e.g. \"SalesBot\" or \"Receptionist\"), a short role label (e.g. \"Sales Representative\"), "
            "and a one-or-two-sentence prompt summary. Then call set_identity. Don't ask multiple "
            "questions at once."
        )
```

- [ ] **Step 3: Implement set_identity**

Replace the stub body with:

```python
    @AgentBase.tool(
        name="set_identity",
        description="Record the new agent's name, role, and one-sentence summary. Advances to the voice step.",
        parameters={
            "name": {"type": "string", "description": "Agent's display name"},
            "role": {"type": "string", "description": "Agent's role label"},
            "prompt_summary": {"type": "string", "description": "One or two sentences describing what the agent does"},
        },
        required=["name", "role", "prompt_summary"],
    )
    def set_identity(self, args, raw_data):
        merged = self._merge_draft(raw_data, {
            "name": args.get("name"),
            "role": args.get("role"),
            "prompt_summary": args.get("prompt_summary"),
        })
        spoken = (
            f"Got it — building {merged['name']}, a {merged['role']}. "
            f"Now, let's pick a voice. I have several options — would you like a "
            f"warm female voice, a confident male voice, or something else?"
        )
        return (
            SwaigFunctionResult(spoken)
                .update_global_data({"agent_draft": merged, "current_step": "voice"})
                .swml_user_event(self._agent_preview_event(merged))
                .swml_user_event(self._checkpoint_event("identity"))
                .swml_user_event(self._wizard_said(spoken))
                # PER TASK 0 SDK REFERENCE: append the step-advance action
                # here. If the SDK uses, e.g., .next_step("voice"), include
                # it. If it uses an action dict, add it.
        )
```

The `swml_user_event` chain method must match what Task 0 confirmed. If the API differs (e.g., `.add_action({"swml_user_event": {...}})`), adapt all subsequent SWAIGs in this task to use the same idiom.

- [ ] **Step 4: Replace the voice step's prompt and implement list_voices + set_voice**

Replace the voice step's placeholder prompt:

```python
        voice.set_prompt(
            "Help the user pick a voice. If they ask what's available, call list_voices. "
            "If they describe what they want (e.g. \"warm female\"), pick the closest match "
            "from the menu and confirm it. When they're happy, call set_voice with the voice id. "
            "Don't quiz them on every option."
        )
```

Implement `list_voices`:

```python
    @AgentBase.tool(
        name="list_voices",
        description="Recite the available voice options. Does not transition steps.",
        parameters={},
        required=[],
    )
    def list_voices(self, args, raw_data):
        spoken = (
            "Here are some popular voices: openai.nova is a warm female voice, "
            "openai.shimmer is a softer female voice, openai.alloy is gender-neutral, "
            "openai.onyx is a deeper male voice, and openai.echo is a friendly male voice. "
            "ElevenLabs has rachel, charlie, and thomas. Which one would you like?"
        )
        return SwaigFunctionResult(spoken).swml_user_event(self._wizard_said(spoken))
```

Implement `set_voice`:

```python
    @AgentBase.tool(
        name="set_voice",
        description="Pick a voice for the new agent. Advances to capabilities.",
        parameters={
            "voice": {"type": "string", "description": "Voice ID (e.g. openai.nova)"},
        },
        required=["voice"],
    )
    def set_voice(self, args, raw_data):
        merged = self._merge_draft(raw_data, {"voice": args.get("voice")})
        spoken = (
            f"Great — using {merged['voice']}. "
            "Now let's set up what your agent can do. "
            "Common capabilities: transferring calls to a human, sending follow-up texts, "
            "scheduling callbacks, checking business hours, collecting customer info, sending emails. "
            "Which of these do you want? You can pick any combination."
        )
        return (
            SwaigFunctionResult(spoken)
                .update_global_data({"agent_draft": merged, "current_step": "capabilities"})
                .swml_user_event(self._agent_preview_event(merged))
                .swml_user_event(self._checkpoint_event("voice"))
                .swml_user_event(self._wizard_said(spoken))
                # step-advance action per Task 0
        )
```

- [ ] **Step 5: Replace the capabilities step's prompt and implement set_capabilities**

Replace placeholder prompt:

```python
        capabilities.set_prompt(
            "Help the user pick capabilities and a greeting line. The available functions are: "
            "transfer_to_human, send_summary_sms, schedule_callback, check_business_hours, "
            "collect_customer_info, send_email. Confirm which subset they want and ask for "
            "the opening greeting their agent should say. When you have both, call set_capabilities."
        )
```

Implement `set_capabilities`:

```python
    @AgentBase.tool(
        name="set_capabilities",
        description="Record the agent's enabled functions and greeting line. Advances to review.",
        parameters={
            "functions": {"type": "array", "items": {"type": "string"}, "description": "SWAIG function ids"},
            "greeting": {"type": "string", "description": "Opening line the new agent will say"},
        },
        required=["functions", "greeting"],
    )
    def set_capabilities(self, args, raw_data):
        merged = self._merge_draft(raw_data, {
            "functions": args.get("functions") or [],
            "greeting": args.get("greeting"),
        })
        fn_label = ", ".join(merged.get("functions") or []) or "no special functions"
        spoken = (
            f"Locked in — {fn_label}, with the greeting: \"{merged['greeting']}\". "
            f"Quick recap: {merged['name']}, a {merged['role']}, using voice {merged['voice']}. "
            "If everything looks right on your screen, just say 'create it' and I'll build the agent. "
            "If you want to change anything, tell me what."
        )
        return (
            SwaigFunctionResult(spoken)
                .update_global_data({"agent_draft": merged, "current_step": "review"})
                .swml_user_event(self._agent_preview_event(merged))
                .swml_user_event(self._checkpoint_event("capabilities"))
                .swml_user_event(self._wizard_said(spoken))
                # step-advance action per Task 0
        )
```

- [ ] **Step 6: Smoke-boot the agent**

```bash
lsof -ti :8000 | xargs kill 2>/dev/null; sleep 1
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/agent" && python3 main.py > /tmp/wizard-task2.log 2>&1 &
echo $! > /tmp/wizard-task2.pid
sleep 5
grep -E "Application startup complete|Traceback|SyntaxError|ImportError" /tmp/wizard-task2.log | head -10
kill $(cat /tmp/wizard-task2.pid) 2>/dev/null
```

Expected: `Application startup complete.` and no traceback.

- [ ] **Step 7: Stage but do not commit**

---

## Task 3 — Review-step SWAIGs (update_agent_preview + create_agent)

**Files:**
- Modify: `agent/main.py` (replace the two stub bodies + replace review-step prompt)

**Context:** This is the riskiest task. `create_agent` integrates with the existing `_wizard_create_employee_via_frontend` helper, which is unchanged. Validation happens here. Failure handling stays in the review step.

The existing helper `_wizard_create_employee_via_frontend(agent_data, credentials)` takes a fully-formed `agent_data` dict and `credentials` dict and POSTs to the frontend. It raises on transport/server errors. `_wizard_lookup_user_credentials(project_id)` returns `dict | None`. The dedup guard `_wizard_create_inflight` is keyed `{call_id}:{name}`. All three are preserved as-is.

- [ ] **Step 1: Replace the review step's prompt**

```python
        review.set_prompt(
            "The user is reviewing the agent on screen. They can either approve it or ask for "
            "changes. If they ask to change anything (name, role, voice, greeting, capabilities, "
            "or the system prompt), call update_agent_preview with just the changed fields. "
            "Do NOT call create_agent until they explicitly say something like 'yes', 'create it', "
            "'looks good build it', or equivalent. When they confirm, call create_agent (no arguments — "
            "it reads the draft from call state). If create_agent reports a failure, tell the user what "
            "went wrong and offer to retry."
        )
```

- [ ] **Step 2: Implement update_agent_preview**

```python
    @AgentBase.tool(
        name="update_agent_preview",
        description="Modify any field in the agent draft during review. Does not transition.",
        parameters={
            "name": {"type": "string"},
            "role": {"type": "string"},
            "prompt": {"type": "string"},
            "prompt_summary": {"type": "string"},
            "voice": {"type": "string"},
            "greeting": {"type": "string"},
            "functions": {"type": "array", "items": {"type": "string"}},
        },
        required=[],
    )
    def update_agent_preview(self, args, raw_data):
        # Defense-in-depth guard: only valid in review step.
        current_step = (raw_data or {}).get("global_data", {}).get("current_step")
        if current_step != "review":
            return SwaigFunctionResult(
                "Hold on — let me back up; I shouldn't be editing yet."
            )

        # Strip None values; merge the rest.
        updates = {k: v for k, v in args.items() if v is not None and v != ""}
        if not updates:
            return SwaigFunctionResult("Got it — nothing to change.")

        merged = self._merge_draft(raw_data, updates)
        changed_keys = ", ".join(updates.keys())
        spoken = f"Updated: {changed_keys}. The preview on your screen now reflects the change. Anything else, or should I create it?"
        return (
            SwaigFunctionResult(spoken)
                .update_global_data({"agent_draft": merged})
                .swml_user_event(self._agent_preview_event(merged))
                .swml_user_event(self._wizard_said(spoken))
        )
```

- [ ] **Step 3: Implement create_agent**

The implementation must:
1. Guard: only valid in review step.
2. Read full `agent_draft` from `global_data`.
3. If `prompt` is empty, derive from `prompt_summary`. If both are empty, refuse.
4. Validate required fields: `name`, `role`, non-empty effective `prompt`, `voice`, `greeting`. Refuse with a clear spoken error if any are missing.
5. Look up credentials via existing `_wizard_lookup_user_credentials` using `project_id` from `raw_data`.
6. Check the dedup guard.
7. Call `_wizard_create_employee_via_frontend(...)` inside a try/except.
8. On success: write `created_agent`, fire `agent_created` event with `{type:"agent_created", employee:{...}}`, transition to `complete`, fire `wizard_checkpoint(stage="review")`, fire `wizard_said`.
9. On failure: surface the error spoken-text, do NOT transition. Stay in review. Clear the dedup key so a retry is possible.

```python
    @AgentBase.tool(
        name="create_agent",
        description="Commit the reviewed agent. Reads the full draft from call state.",
        parameters={},
        required=[],
    )
    def create_agent(self, args, raw_data):
        # Step guard
        gd = (raw_data or {}).get("global_data", {})
        if gd.get("current_step") != "review":
            return SwaigFunctionResult("Hold on — we're not at the review stage yet.")

        draft = gd.get("agent_draft", {}) or {}
        # Effective prompt: explicit prompt wins, else fall back to prompt_summary.
        effective_prompt = (draft.get("prompt") or "").strip()
        if not effective_prompt:
            effective_prompt = (draft.get("prompt_summary") or "").strip()

        missing = []
        if not (draft.get("name") or "").strip():
            missing.append("name")
        if not (draft.get("role") or "").strip():
            missing.append("role")
        if not effective_prompt:
            missing.append("prompt")
        if not (draft.get("voice") or "").strip():
            missing.append("voice")
        if not (draft.get("greeting") or "").strip():
            missing.append("greeting")
        if missing:
            spoken = f"I'm missing {', '.join(missing)} — let's fill that in first."
            return (
                SwaigFunctionResult(spoken)
                    .swml_user_event(self._wizard_said(spoken))
            )

        # Credentials lookup.
        project_id = (raw_data or {}).get("project_id") or (raw_data or {}).get("global_data", {}).get("project_id")
        credentials = _wizard_lookup_user_credentials(project_id) if project_id else None
        if not credentials:
            spoken = (
                "I couldn't find your SignalWire credentials — make sure you're logged in "
                "on the dashboard, then try again."
            )
            return (
                SwaigFunctionResult(spoken)
                    .swml_user_event(self._wizard_said(spoken))
            )

        # Dedup guard.
        call_id = (raw_data or {}).get("call_id") or "unknown"
        dedup_key = f"{call_id}:{draft.get('name','')}"
        if dedup_key in _wizard_create_inflight:
            spoken = "I'm already creating that one — give me a few seconds."
            return (
                SwaigFunctionResult(spoken)
                    .swml_user_event(self._wizard_said(spoken))
            )
        _wizard_create_inflight.add(dedup_key)

        # Build the payload the existing helper expects.
        agent_data = {
            "name": draft["name"],
            "role": draft["role"],
            "greeting": draft["greeting"],
            "prompt": effective_prompt,
            "voice": draft["voice"],
            "language": draft.get("language", "en-US"),
            "temperature": draft.get("temperature", 0.7),
            "speech_hints": draft.get("speech_hints", []),
            "enabled_functions": draft.get("functions", []),
            "transfer_number": draft.get("transfer_number", ""),
            "transfer_from": draft.get("transfer_from", ""),
            "sms_from_number": draft.get("sms_from_number", ""),
            "documents": draft.get("documents", []),
        }

        try:
            result = _wizard_create_employee_via_frontend(agent_data, credentials)
        except Exception as e:
            _wizard_create_inflight.discard(dedup_key)
            spoken = f"The build didn't go through — {e}. Want me to retry, or change something first?"
            return (
                SwaigFunctionResult(spoken)
                    .swml_user_event(self._wizard_said(spoken))
            )

        # Success
        employee = result.get("employee") or {}
        created = {
            "id": employee.get("id"),
            "name": employee.get("name") or draft["name"],
            "callFabricAddress": employee.get("callFabricAddress"),
        }
        spoken = (
            f"Done — {created['name']} is built and ready. "
            "Want me to hand off the dial address so you can call them?"
        )
        return (
            SwaigFunctionResult(spoken)
                .update_global_data({"created_agent": created, "current_step": "complete"})
                .swml_user_event({"type": "agent_created", "employee": employee})
                .swml_user_event(self._checkpoint_event("review"))
                .swml_user_event(self._wizard_said(spoken))
                # step-advance action per Task 0
        )
```

- [ ] **Step 4: Smoke-boot the agent**

```bash
lsof -ti :8000 | xargs kill 2>/dev/null; sleep 1
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/agent" && python3 main.py > /tmp/wizard-task3.log 2>&1 &
echo $! > /tmp/wizard-task3.pid
sleep 5
grep -E "Application startup complete|Traceback|SyntaxError|ImportError|NameError" /tmp/wizard-task3.log | head -10
kill $(cat /tmp/wizard-task3.pid) 2>/dev/null
```

Expected: `Application startup complete.` and no traceback. `NameError` would mean a reference to a private helper that wasn't actually defined — catch it now.

- [ ] **Step 5: Stage but do not commit**

---

## Task 4 — finalize_agent + complete-step prompt

**Files:**
- Modify: `agent/main.py` (replace the finalize_agent stub + replace complete-step placeholder)

- [ ] **Step 1: Replace the complete step's prompt**

```python
        complete.set_prompt(
            "The agent has been built. Briefly congratulate the user and offer to hand off the "
            "dial address so they can place a test call. When they say yes (or you've offered once), "
            "call finalize_agent. The wizard call will end shortly after that."
        )
```

- [ ] **Step 2: Implement finalize_agent**

```python
    @AgentBase.tool(
        name="finalize_agent",
        description="Hand off the new agent to the user (call-fabric address).",
        parameters={},
        required=[],
    )
    def finalize_agent(self, args, raw_data):
        gd = (raw_data or {}).get("global_data", {})
        if gd.get("current_step") != "complete":
            return SwaigFunctionResult("Hold on — the agent isn't built yet.")

        created = gd.get("created_agent") or {}
        addr = created.get("callFabricAddress") or "(address unavailable)"
        spoken = (
            f"You can call your new agent at {addr}. "
            "I'll go quiet now — talk to you next time."
        )
        return (
            SwaigFunctionResult(spoken)
                .swml_user_event({"type": "agent_ready", **created})
                .swml_user_event(self._wizard_said(spoken))
        )
```

- [ ] **Step 3: Smoke-boot the agent**

```bash
lsof -ti :8000 | xargs kill 2>/dev/null; sleep 1
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/agent" && python3 main.py > /tmp/wizard-task4.log 2>&1 &
echo $! > /tmp/wizard-task4.pid
sleep 5
grep -E "Application startup complete|Traceback|SyntaxError|ImportError|NameError" /tmp/wizard-task4.log | head -10
kill $(cat /tmp/wizard-task4.pid) 2>/dev/null
```

Expected: `Application startup complete.` and no traceback.

- [ ] **Step 4: Stage but do not commit**

---

## Task 5 — Smoke verification + manual-test handoff

**Files:** none (verification only)

- [ ] **Step 1: Verify boot and route**

```bash
lsof -ti :8000 | xargs kill 2>/dev/null; sleep 1
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/agent" && python3 main.py > /tmp/wizard-final.log 2>&1 &
echo $! > /tmp/wizard-final.pid
sleep 6
echo "=== boot log ==="
grep -E "Application startup complete|Wizard agent mounted|Traceback|ERROR" /tmp/wizard-final.log | head -5
echo ""
echo "=== /swml/wizard route status ==="
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/swml/wizard
echo ""
echo "=== /docs status ==="
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/docs
kill $(cat /tmp/wizard-final.pid) 2>/dev/null
```

Expected:
- Boot log shows `Application startup complete.` and `Wizard agent mounted at /swml/wizard`
- `/swml/wizard` returns 307 (basic-auth redirect — same as before the redesign)
- `/docs` returns 200

- [ ] **Step 2: Verify all 7 SWAIG names are registered**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/agent" && python3 -c "
import main
agent = main.WizardAgent()
tools = agent.list_tools() if hasattr(agent, 'list_tools') else None
if tools is None:
    # fallback: introspect _tools or similar internal attribute
    for attr in ('_tools', 'tools', '_swaig_tools'):
        if hasattr(agent, attr):
            tools = getattr(agent, attr)
            break
print('registered tools:', sorted([t.name if hasattr(t, 'name') else t for t in (tools or [])]))
"
```

Expected: `['create_agent', 'finalize_agent', 'list_voices', 'set_capabilities', 'set_identity', 'set_voice', 'update_agent_preview']` — exactly 7 names. If `list_tools()` doesn't exist, the verification line `for attr in ('_tools', ...)` will find the right attribute. If none of the introspection attempts work, the implementer must adapt to the SDK's actual public API — this is a Task 0 follow-up.

- [ ] **Step 3: Confirm old SWAIG names are gone**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && grep -nE "name=\"(mark_checkpoint|ask_config_question|preview_agent|list_available_functions)\"" agent/main.py
```

Expected: no output (all four old SWAIG names are deleted).

- [ ] **Step 4: Run the frontend Vitest suite**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/web" && npm test -- --run 2>&1 | tail -3
```

Expected: `Tests 3 failed | 162 passed (165)` — same baseline as before the redesign. The frontend is unaffected; nothing should change.

- [ ] **Step 5: Hand off the manual call test**

Print the manual test plan for the user. The plan is:

1. Stop any running web/agent. Start them fresh via the existing dev workflow (`agent/main.py` and `web && npm run dev`).
2. Open http://localhost:5001/dashboard. Click "Build by voice" (the wizard banner).
3. Walk through the conversation: pick a name + role + summary, pick a voice, pick capabilities + greeting, review, say "create it".
4. Verify on the dashboard: the new agent appears in the agents list. The call-fabric address from `finalize_agent` matches the agent's resource address on the dashboard.
5. Open `web/data/sally_sales.db` (or query via the dashboard's call logs page). Confirm the wizard call's row in `call_logs` has `built_agent_id` populated and a non-trivial transcript.
6. Inject a failure: temporarily set `FRONTEND_URL` to `http://localhost:9999` in `agent/.env`, restart the agent, place a wizard call, get to review, and try to create. The wizard should speak the error and stay in review. Restore `FRONTEND_URL`, ask for retry on the same call, confirm success.

If steps 4 or 5 fail, the redesign has a regression — diagnose using the agent log (which now contains full transcripts via `swaig_post_conversation`).

- [ ] **Step 6: No commit**

Verification only. Working tree shows the cumulative `M agent/main.py` from Tasks 1-4. The user gates whether to commit/push.

---

## Self-Review (planner notes)

**Spec coverage:** Each spec section maps to tasks:
- Step machine + SWAIG inventory → Tasks 1-4
- State shape (global_data) → Task 1 (initial) + Tasks 2-3 (mutations)
- Per-step prompts → Tasks 2-4
- Transcript / observability (`swaig_post_conversation`) → Task 1
- Failure handling → Task 3 (create_agent)
- Migration (in-place replace) → Task 1
- Testing → Task 5

**Placeholder scan:** No "TBD" / "TODO" tokens. The Task 0 SDK-API gap is explicitly handled as research-then-implementation; subsequent tasks reference its output. The only "implementer must adapt" note is in Task 5 Step 2 where the introspection fallback is contingent on the SDK's public API — that's a known unknown the plan calls out, not a placeholder.

**Type consistency:** The agent_draft shape, the user_event names, and the SWAIG function signatures are consistent across Tasks 1-4. `_merge_draft`, `_agent_preview_event`, `_checkpoint_event`, `_wizard_said` are defined in Task 2 Step 1 and used identically in Tasks 2-4.

**Known weak points:**
1. The exact SDK step-advance API call is "per Task 0" in every transitioning SWAIG. If Task 0 reveals a fundamentally different idiom (e.g., contexts must be declared once at agent-init via a builder rather than per-step `set_prompt`/`set_valid_steps` calls), Tasks 1-4 will need adjustment.
2. `_wizard_lookup_user_credentials` is called with `project_id` from `raw_data` — its location in the SWAIG payload is `raw_data["project_id"]` per the existing implementation, but this should be re-confirmed when Task 3 is implemented (look at the existing `create_agent` body in the old class for the precedent).

---

## SDK API Reference (Task 0 output)

### Defining a context with steps

Source: `docs/signalwire-agents/examples/contexts_demo.py` lines 46–96

```python
from signalwire_agents import AgentBase

class MyAgent(AgentBase):
    def __init__(self):
        super().__init__(name="My Agent", route="/my-agent")

        # Base prompt is REQUIRED even when using contexts
        self.prompt_add_section("Instructions", "Follow the workflow.")

        # Step 1: get the ContextBuilder
        contexts = self.define_contexts()

        # Step 2: add a named context (returns a Context object — fluent API)
        sales_context = contexts.add_context("sales") \
            .set_isolated(True) \
            .add_section("Role", "You are Franklin, a sales agent.") \
            .add_section("Voice Instructions", "Use English-Franklin voice.")

        # Step 3: add steps to the context (returns a Step object — fluent API)
        sales_context.add_step("determine_use_case") \
            .add_section("Current Task", "Identify the customer's use case") \
            .add_bullets("Required Information to Collect", [
                "What will they primarily use the computer for?",
            ]) \
            .set_step_criteria("Customer has clearly stated their use case") \
            .set_valid_steps(["determine_form_factor"]) \
            .set_valid_contexts(["tech_support", "manager"])

        sales_context.add_step("determine_form_factor") \
            .add_section("Current Task", "Determine laptop or desktop") \
            .set_step_criteria("Customer has stated LAPTOP or DESKTOP") \
            .set_valid_steps(["make_recommendation"]) \
            .set_valid_contexts(["tech_support", "manager"])
```

For a **single-context** agent the context name MUST be `"default"`.
Source: `docs/signalwire-agents/docs/contexts_guide.md` lines 119–144 (Troubleshooting §1):

```python
# Single-context: name must be "default"
contexts = self.define_contexts()
workflow = contexts.add_context("default")   # "main" would raise an error
workflow.add_step("welcome") \
    .set_text("Welcome! What's your name?") \
    .set_step_criteria("User has provided their name") \
    .set_valid_steps(["collect_email"])
```

### Per-step configuration (set_valid_steps, set_functions, set_text / add_section)

Source: `docs/signalwire-agents/docs/contexts_guide.md` lines 281–350

**Content — choose exactly one approach per step:**

```python
# Option A: direct text (mutually exclusive with add_section)
step.set_text("Please provide your email address.")

# Option B: POM sections (mutually exclusive with set_text)
step.add_section("Role", "You are a technical specialist") \
    .add_section("Instructions", "Follow diagnostic protocol") \
    .add_bullets(["Check connectivity", "Test speed"])
```

**Navigation — controlling step progression:**

```python
# Allow only these next steps (within same context)
step.set_valid_steps(["review", "edit", "cancel"])

# Dead end — cannot progress
step.set_valid_steps([])

# No call at all = implicit "next step" (the one defined after it)
```

**Context switching:**

```python
# Can switch to these contexts
step.set_valid_contexts(["billing", "technical"])

# Trapped — cannot leave context
step.set_valid_contexts([])
```

**Function restriction:**

```python
# Allow only these SWAIG functions
step.set_functions(["datetime", "web_search"])

# Block ALL functions for this step
step.set_functions("none")

# No restriction (default) — don't call set_functions() at all
```

### Advancing a step from a SWAIG handler

**THIS IS THE KEY FINDING.** Two mechanisms exist; they are different.

#### Mechanism A — `SwaigFunctionResult.swml_change_step(step_name)` (explicit, from SWAIG handler)

Source: `docs/signalwire_agents/core/function_result.py` lines 301–321

```python
def swml_change_step(self, step_name: str) -> 'SwaigFunctionResult':
    """Change the conversation step in the AI agent's workflow."""
    return self.add_action("change_step", step_name)
```

Usage in a SWAIG handler:

```python
def set_identity(self, args, raw_data):
    # ... collect data ...
    return (
        SwaigFunctionResult("Got it, moving to voice selection.")
            .update_global_data({"agent_draft": merged})
            .swml_change_step("voice")          # ← exact API call
            .swml_user_event({"type": "wizard_checkpoint", "stage": "identity"})
    )
```

The underlying action emitted is `{"change_step": "voice"}`.

#### Mechanism B — LLM-driven navigation via prompt instructions (no explicit API call)

Source: `docs/signalwire-agents/examples/contexts_demo.py` lines 50–57

The `contexts_demo.py` does NOT have any SWAIG handlers that call `swml_change_step`. Instead it instructs the LLM inside the step prompt with bullets like:

```python
.add_bullets("When to use change_context tool", [
    "Customer asks for manager/supervisor - change_context to 'manager'",
    "Customer asks technical questions  - change_context to 'tech_support'",
])
```

The SDK exposes a built-in `change_context` (and presumably `next_step`) tool that the LLM calls autonomously when the prompt criteria are met. This is the demo's idiom for context transitions.

**For the Wizard redesign, use Mechanism A (`swml_change_step`) from SWAIG handlers**, because we want explicit, programmatic gating — each SWAIG handler validates its inputs and only calls `swml_change_step` on success. This matches `set_valid_steps` which tells the LLM which steps are reachable; the SWAIG handler uses `swml_change_step` to actually move there.

#### Can a single SwaigFunctionResult do all three things at once?

Yes. The action list is additive. You can chain:

```python
return (
    SwaigFunctionResult("Confirmed, next step.")
        .update_global_data({"agent_draft": merged, "current_step": "voice"})
        .swml_change_step("voice")
        .swml_user_event({"type": "wizard_checkpoint", "stage": "identity"})
)
```

Each call appends one entry to the `action` list. Source: `function_result.py` lines 114–126:

```python
def add_action(self, name: str, data: Any) -> 'SwaigFunctionResult':
    self.action.append({name: data})
    return self
```

### Emitting a swml_user_event from a SWAIG handler

Source: `docs/signalwire_agents/core/function_result.py` lines 263–299

```python
def swml_user_event(self, event_data: Dict[str, Any]) -> 'SwaigFunctionResult':
    swml_action = {
        "sections": {
            "main": [{
                "user_event": {
                    "event": event_data
                }
            }]
        },
        "version": "1.0.0"
    }
    return self.add_action("SWML", swml_action)
```

Usage:

```python
return (
    SwaigFunctionResult("Identity recorded.")
        .swml_user_event({
            "type": "agent_preview",
            "name": "SalesBot",
            "role": "Sales Representative",
        })
        .swml_user_event({
            "type": "wizard_checkpoint",
            "stage": "identity",
        })
)
```

Multiple `.swml_user_event(...)` calls on the same result are fine — each appends a separate `SWML` action entry.

### Reading global_data inside a SWAIG handler

Source: `docs/signalwire-agents/examples/info_gatherer_example.py` lines 74–76

```python
def my_handler(self, args, raw_data):
    gd = (raw_data or {}).get("global_data", {})
    draft = gd.get("agent_draft", {})
    current_step = gd.get("current_step", "identity")
```

`raw_data` is the second positional argument to every SWAIG handler. It is a dict containing (among other keys) `"global_data"` — a dict of whatever was set via `set_global_data` / `update_global_data`.

### Updating global_data from a SWAIG handler

Source: `docs/signalwire_agents/core/function_result.py` lines 247–261

```python
def update_global_data(self, data: Dict[str, Any]) -> 'SwaigFunctionResult':
    """Merge updates into global agent data (set_global_data action)."""
    return self.add_action("set_global_data", data)
```

This is a **shallow merge** — keys in `data` overwrite matching keys in global_data; other keys are untouched. Use the `_merge_draft` helper (Task 2) for nested dict merges.

Usage:

```python
merged_draft = self._merge_draft(raw_data, {"name": args["name"], "role": args["role"]})
return (
    SwaigFunctionResult("Name and role recorded.")
        .update_global_data({"agent_draft": merged_draft, "current_step": "voice"})
        .swml_change_step("voice")
)
```

To initialize at agent startup (before any call), use the instance method directly:

```python
self.set_global_data({
    "agent_draft": {"name": "", "role": "", ...},
    "current_step": "identity",
})
```

Source: `docs/signalwire-agents/examples/simple_agent.py` line 250.

### Notes / gotchas

1. **Contexts must be declared at `__init__` time.** `self.define_contexts()` returns a builder; all `add_context()` and `add_step()` calls must happen during `__init__`. No amending after construction.

2. **Single-context agents: the context MUST be named `"default"`.** Any other name raises an error. Source: `contexts_guide.md` line 847–854.

3. **`set_text` and `add_section` are mutually exclusive per step.** Mixing them raises an error. Source: `contexts_guide.md` lines 860–872.

4. **Base prompt is required even when using contexts.** At least one `self.prompt_add_section(...)` call (or equivalent) must exist before `define_contexts()`. Source: `contexts_demo.py` lines 35–43.

5. **`set_isolated(True)` on a context** causes the context to present only its own prompt to the LLM (not the base prompt hierarchy). Used in `contexts_demo.py` lines 50, 99, 127. Not required for the Wizard — omit unless you want hard isolation.

6. **`add_enter_filler(locale, [phrases])` on a context** plays a random filler phrase when the LLM enters that context. Source: `contexts_demo.py` lines 128–137. Useful for the manager-escalation UX; not needed for the Wizard.

7. **`swml_change_context(context_name)` exists for multi-context agents.** Source: `function_result.py` lines 323–342. The Wizard uses a single context with five steps, so use `swml_change_step` only.

8. **`set_valid_steps` controls which steps the LLM is *told* it may navigate to** — it does not physically block a `swml_change_step` action to a step not in that list. The restriction is prompt-level, not enforced server-side. Use `set_valid_steps` for LLM guidance and rely on your SWAIG handler logic for actual gating.

9. **`set_functions("none")` vs `set_functions([])`.** The string `"none"` disables all functions. An empty list `[]` is not tested in the guide and may behave differently — use the string `"none"` to be safe. Source: `contexts_guide.md` lines 432–443.

10. **The `contexts_demo.py` does NOT show SWAIG handlers advancing steps.** All navigation in that demo is LLM-driven via `change_context` bullets. The Wizard's explicit SWAIG-driven advancement via `swml_change_step` is a valid but different pattern, supported by `function_result.py` lines 301–321 as confirmed above.
