# Employee Agent Contexts+Steps Refactor

**Date:** 2026-05-07
**Status:** Implemented
**Owner:** HireWire-AI
**Depends on:** PR #1 (SDK code generator deeper pass — branch `worktree-sdk-code-generator`) being merged first.

## Background

Employee agents (`VirtualEmployeeAgent` in `agent/main.py`) build their SWML using free-form POM sections (`prompt_add_section("Identity"...)`, `prompt_add_section("Instructions"...)`, `prompt_add_section("Voice Interaction Guidelines"...)`). This works for the LLM, but it does NOT use SignalWire's Contexts and Steps feature, so no `step_change` events are emitted in `swaig_log`.

The wizard agent (which builds new employee configs over a phone call) already uses Contexts and Steps (`agent/main.py:849-938`), so its calls produce rich state-flow data. Regular employee call logs do not.

The state-flow visualization in postpromptviewer's P.I.E. Viewer is driven by these `step_change` events plus the function-call entries in `swaig_log`. Without state events from employee agents, a state-flow tab in HireWire-AI would be sparse for the majority of call logs.

This sub-project refactors `VirtualEmployeeAgent` to use a generic 3-state Contexts+Steps machine so every employee call emits `step_change` events. Sub-project 2 (state-flow UI tab) consumes the resulting data.

## Goals

1. Every employee agent's SWML defines a `default` context with three steps: `greet`, `assist`, `wrap_up`.
2. The agent emits at least two `step_change` events on a typical inbound call: `greet → assist` and `assist → wrap_up`.
3. The user's existing `prompt` field maps cleanly to the `assist` step's text. No DB migration required.
4. The user's existing `greeting` field maps cleanly to the `greet` step's opening line.
5. Existing `enabled_functions` keep working; functions are distributed across steps per the rules below.
6. SDK code generator (from sub-project 0) is updated to emit the new structure so SWML parity tests still pass.
7. New tests verify the step structure, function distribution, and prompt mapping.

## Non-Goals

- Per-employee custom state machines. v1 always uses the same 3-state default. Custom state machines belong to a future enhancement.
- Role-aware state machines. v1 is identical for sales / support / receptionist roles.
- Retroactively annotating historical call logs with synthetic state events. Out of scope.
- Modifying the wizard agent's own contexts (it already has its own state machine).
- Building the state-flow UI tab. That's sub-project 2.
- Persisting state machine definitions in the database. The state machine is hard-coded in `VirtualEmployeeAgent`.

## State machine

Single context `default`, three steps:

```
greet ──[begin_assist()]──→ assist ──[wrap_up_call()]──→ wrap_up (terminal)
```

### Step `greet`

- **Text body:**
  ```
  You are {name}, a {role}. Open the call with: "{greeting}".
  After greeting, listen for what the caller needs. Keep replies to 1-3 sentences.
  When the caller has stated what they're calling about, call begin_assist() to start helping.
  ```
- **`set_step_criteria("Caller has stated their reason for calling")`**
- **`set_valid_steps(["assist"])`**
- **`set_functions(<step-greet functions>)`** where step-greet functions = `["begin_assist"] + (["check_business_hours"] if "check_business_hours" in enabled_functions else [])`

### Step `assist`

- **Text body:**
  ```
  {employee_config["prompt"] verbatim, or "Help the caller with their request." if empty}

  Use the available SWAIG functions when appropriate. When the caller's request is fully
  addressed, call wrap_up_call() to close the call gracefully.
  ```
- **`set_step_criteria("Caller's request handled or escalated")`**
- **`set_valid_steps(["wrap_up"])`**
- **`set_functions(<step-assist functions>)`** where step-assist functions = `[fn for fn in enabled_functions if fn != "send_summary_sms"] + ["wrap_up_call"]`. (`send_summary_sms` is moved to `wrap_up` since the SMS-summary offer happens at end-of-call.)

### Step `wrap_up`

- **Text body:** dynamically composed:
  - Always starts: `"Wrap the call. Briefly recap what happened in 1 sentence."`
  - If `send_summary_sms` enabled, append: `" Then offer to text a summary to the caller's phone. If they say yes, ask for the number and call send_summary_sms with a short summary."`
  - Always ends: `" Thank the caller and end the call."`
- **No `set_valid_steps()`** — terminal step.
- **`set_functions(<step-wrap-up functions>)`** where step-wrap-up functions = `(["send_summary_sms"] if enabled else [])`

## Two new built-in SWAIG transition tools

Both are first-class methods on `VirtualEmployeeAgent`, registered for every employee regardless of `enabled_functions`. They are NOT exposed in the `enabled_functions` UI — they're internal plumbing.

### `begin_assist()`

```python
@AgentBase.tool(
    name="begin_assist",
    description="Call this when the caller has stated their reason for calling and you are ready to start helping them.",
    parameters={"type": "object", "properties": {}}
)
def begin_assist(self, args, raw_data):
    return SwaigFunctionResult("Got it, let me help with that.")
```

The SDK's `set_valid_steps(["assist"])` constraint on the `greet` step combined with the AI calling `begin_assist` advances the state machine. The function body itself does not need to call any step-advance method — the SDK handles transition based on the step constraint.

### `wrap_up_call()`

```python
@AgentBase.tool(
    name="wrap_up_call",
    description="Call this when the caller's request is fully addressed and you are ready to close the call.",
    parameters={"type": "object", "properties": {}}
)
def wrap_up_call(self, args, raw_data):
    return SwaigFunctionResult("Let me wrap things up.")
```

## Voice Interaction Guidelines retention

The current `Voice Interaction Guidelines` POM section (set via `prompt_add_section(..., bullets=[...])` at `agent/main.py:187-190`) is RETAINED as a top-level POM section. Top-level POM applies across every step in a contexts/steps agent, so the guidelines remain in scope at all times. This avoids duplicating the guidelines into each step's text.

The conditional SMS-offer guideline (added at `agent/main.py:181-185` only when `send_summary_sms` is enabled) is REMOVED from the POM section. The same instruction is now baked into the `wrap_up` step's text directly, where it is naturally scoped.

The `Identity` POM section is REMOVED (its content moves to `greet` step text).
The `Instructions` POM section is REMOVED (its content moves to `assist` step text).

## Backwards compatibility

No database migration. The refactor is purely a change to `VirtualEmployeeAgent.__init__` / `_update_personality`. On the next call to any existing employee, the agent rebuilds with the new contexts/steps structure derived from the unchanged `prompt`, `greeting`, and `enabled_functions` fields.

**Behavior risk:** an existing employee's `prompt` field may include implicit state instructions like `"First qualify the lead, then book a meeting"`. Under the new structure, this entire prompt collapses into the `assist` step's text. The AI still receives the instructions, just inside one step rather than spread across multiple. The state-flow visualization will show this as a single `assist` node rather than multiple sub-states. Acceptable trade-off for v1.

**LLM-behavior risk:** the AI may now hesitate to call `begin_assist` and stay in `greet` longer than expected, or fail to call `wrap_up_call` and never advance to `wrap_up`. Mitigations:
- Each step's text explicitly instructs when to call the transition function.
- Step descriptions in `set_step_criteria` give the SDK a hint for advancement.
- We add a smoke test that runs a synthetic call against the new agent (mocked LLM responses) and asserts that `step_change` events appear in the resulting `swaig_log`.

## SDK code generator update

The generator in `agent/sdk_code_templates.py` (from sub-project 0) currently emits:

```python
self.prompt_add_section("Identity", ...)
self.prompt_add_section("Instructions", ...)  # conditional
self.prompt_add_section("Voice Interaction Guidelines", ...)
```

After this refactor, it must emit:

```python
self.prompt_add_section("Voice Interaction Guidelines", ...)  # only this remains as POM

contexts = self.define_contexts()
ctx = contexts.add_context("default")
ctx.add_step("greet").set_text(...).set_step_criteria(...).set_valid_steps(["assist"]).set_functions([...])
ctx.add_step("assist").set_text(...).set_step_criteria(...).set_valid_steps(["wrap_up"]).set_functions([...])
ctx.add_step("wrap_up").set_text(...).set_functions([...])
```

Plus the `begin_assist` and `wrap_up_call` SWAIG handlers (always emitted regardless of `enabled_functions`).

Changes to `agent/sdk_code_templates.py`:
- New helper `contexts_block(employee_config) -> str` that emits the `define_contexts()` + 3 `add_step(...)` calls, mirroring the live agent's `_build_employee_context` method.
- Two new entries in `SWAIG_TEMPLATES`: `"begin_assist"` and `"wrap_up_call"`. These templates are emitted by the generator UNCONDITIONALLY (special-cased in `_generate_sdk_code`'s emit loop, since they're not in the user-configurable `enabled_functions` list).

Changes to `_generate_sdk_code` in `agent/main.py`:
- Replace the three `prompt_add_section` emissions with: one POM section for Voice Interaction Guidelines + a call to `contexts_block(...)`.
- Always include `begin_assist` and `wrap_up_call` in the emitted SWAIG handlers, before the user-enabled functions.

## Tests

The 14 existing SWML-parity tests in `agent/tests/test_sdk_code_generator.py` will start failing because the live SWML now contains a `contexts` section that the generator's output must also contain. The parity tests don't need rewriting — they check `_render_swml()` equality. The generator update above ensures both sides produce the new structure.

**New tests in the same file:**

1. `test_step_definitions_have_correct_function_lists`:
   ```python
   def test_step_definitions_have_correct_function_lists():
       config = _minimal_config()
       config["enabled_functions"] = ["transfer_to_human", "send_summary_sms", "check_business_hours"]
       agent = VirtualEmployeeAgent(config)
       swml = json.loads(agent._render_swml())
       steps = _extract_steps(swml, "default")  # helper
       assert "begin_assist" in steps["greet"]["functions"]
       assert "check_business_hours" in steps["greet"]["functions"]
       assert "send_summary_sms" not in steps["greet"]["functions"]
       assert "transfer_to_human" in steps["assist"]["functions"]
       assert "wrap_up_call" in steps["assist"]["functions"]
       assert "send_summary_sms" not in steps["assist"]["functions"]  # moved to wrap_up
       assert "send_summary_sms" in steps["wrap_up"]["functions"]
   ```

2. `test_user_prompt_lands_in_assist_step`:
   ```python
   def test_user_prompt_lands_in_assist_step():
       config = _minimal_config()
       config["prompt"] = "UNIQUE_MARKER_PROMPT_42"
       agent = VirtualEmployeeAgent(config)
       swml = json.loads(agent._render_swml())
       steps = _extract_steps(swml, "default")
       assert "UNIQUE_MARKER_PROMPT_42" in steps["assist"]["text"]
       assert "UNIQUE_MARKER_PROMPT_42" not in steps["greet"]["text"]
       assert "UNIQUE_MARKER_PROMPT_42" not in steps["wrap_up"]["text"]
   ```

3. `test_greeting_lands_in_greet_step`:
   ```python
   def test_greeting_lands_in_greet_step():
       config = _minimal_config()
       config["greeting"] = "UNIQUE_MARKER_GREETING_99"
       agent = VirtualEmployeeAgent(config)
       swml = json.loads(agent._render_swml())
       steps = _extract_steps(swml, "default")
       assert "UNIQUE_MARKER_GREETING_99" in steps["greet"]["text"]
   ```

4. `test_voice_interaction_guidelines_remains_pom_section`:
   ```python
   def test_voice_interaction_guidelines_remains_pom_section():
       config = _minimal_config()
       agent = VirtualEmployeeAgent(config)
       swml = json.loads(agent._render_swml())
       pom_sections = _extract_pom_sections(swml)  # helper
       titles = [s.get("title") for s in pom_sections]
       assert "Voice Interaction Guidelines" in titles
       assert "Identity" not in titles
       assert "Instructions" not in titles
   ```

5. `test_wrap_up_step_text_includes_sms_offer_when_enabled`:
   ```python
   def test_wrap_up_step_text_includes_sms_offer_when_enabled():
       config = _minimal_config()
       config["enabled_functions"] = ["send_summary_sms"]
       agent = VirtualEmployeeAgent(config)
       swml = json.loads(agent._render_swml())
       steps = _extract_steps(swml, "default")
       assert "text a summary" in steps["wrap_up"]["text"].lower()

   def test_wrap_up_step_text_omits_sms_offer_when_disabled():
       config = _minimal_config()
       config["enabled_functions"] = ["transfer_to_human"]
       agent = VirtualEmployeeAgent(config)
       swml = json.loads(agent._render_swml())
       steps = _extract_steps(swml, "default")
       assert "text a summary" not in steps["wrap_up"]["text"].lower()
   ```

6. The 14 existing parity tests are updated only if their fixtures need new fields (`prompt` is already present in `_minimal_config()`). They re-pass once the generator + live agent both emit the new structure.

Helpers `_extract_steps(swml, context_name)` and `_extract_pom_sections(swml)` are added to the test file to navigate the SWML schema.

## Files touched

| File | Change |
|---|---|
| `agent/main.py` | New private method `_build_employee_context` on `VirtualEmployeeAgent`. `_update_personality` slimmed to: speech_hints + temperature + Voice Interaction Guidelines POM section only. New `begin_assist` and `wrap_up_call` SWAIG-decorated methods. Wire `_build_employee_context` into `__init__` after `_update_personality`. |
| `agent/sdk_code_templates.py` | New `contexts_block(employee_config) -> str`. New entries in `SWAIG_TEMPLATES` for `begin_assist` and `wrap_up_call`. |
| `agent/tests/test_sdk_code_generator.py` | New `_extract_steps` and `_extract_pom_sections` helpers. 6 new tests as specified above. The 14 existing parity tests pass unchanged. |

## Open questions for the implementation plan

1. Confirm the exact SDK API for context/step definition. Read `signalwire-agents` SDK source under `.venv/lib/python3.12/site-packages/signalwire_agents/` for: `define_contexts`, `add_context`, `add_step`, `set_text`, `set_step_criteria`, `set_valid_steps`, `set_functions`. Verify whether `set_valid_steps` semantically blocks the AI from advancing to non-listed steps, or just hints.
2. Confirm whether `begin_assist` / `wrap_up_call` need to do anything inside their body besides return `SwaigFunctionResult` to trigger a step transition, or whether the transition is purely driven by the SDK based on which step the AI is in when the function is called.
3. Determine the exact JSON shape of the `contexts` block in rendered SWML so the test helpers `_extract_steps` and `_extract_pom_sections` know what to navigate.
4. Decide whether the smoke test for `step_change` events (running the agent against mocked LLM responses) is in scope for this sub-project or deferred to a follow-up. Spec leans toward in-scope but acknowledges complexity.
