# Employee Contexts+Steps Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `VirtualEmployeeAgent` to use a 3-step Contexts+Steps state machine (`greet → assist → wrap_up`) so every employee call emits `step_change` events. Keep the SDK code generator's SWML parity tests passing throughout.

**Architecture:** Add `_build_employee_context` method that defines the 3-step machine in code, plus two built-in SWAIG transition tools (`begin_assist`, `wrap_up_call`). Slim `_update_personality` to keep only the cross-step Voice Interaction Guidelines POM section. Update `agent/sdk_code_templates.py` to emit a matching contexts block and the two new SWAIG handlers, preserving the byte-for-byte SWML parity guarantee.

**Tech Stack:** Python 3.11+, `signalwire-agents>=0.1.54` (Contexts+Steps API in `signalwire_agents.core.contexts`), pytest, FastAPI.

**Spec:** [`docs/superpowers/specs/2026-05-07-employee-contexts-steps-refactor-design.md`](../specs/2026-05-07-employee-contexts-steps-refactor-design.md)

**Depends on:** PR #1 (`worktree-sdk-code-generator` branch, the SDK code generator deeper pass) being merged into `main` first. Either wait for merge, or branch this work off `worktree-sdk-code-generator` and rebase onto main after PR #1 lands.

---

## SDK API Reference

Confirmed via reading `.venv/lib/python3.12/site-packages/signalwire_agents/core/contexts.py` and `agent_base.py`:

- `agent.define_contexts() -> ContextBuilder`
- `builder.add_context(name) -> Context`
- `context.add_step(name) -> Step`
- `step.set_text(text: str) -> Step` — chainable
- `step.set_step_criteria(criteria: str) -> Step` — chainable
- `step.set_valid_steps(steps: List[str]) -> Step` — chainable; omit for terminal steps
- `step.set_functions(functions: List[str]) -> Step` — chainable

Step's SWML rendered shape (from `Step.to_dict()` at `contexts.py:214-247`):

```python
{
    "name": str,
    "text": str,
    "step_criteria": str,    # optional
    "functions": [str, ...], # optional
    "valid_steps": [str, ...] # optional
}
```

Contexts block lives at `prompt.contexts.<context_name>.steps[]` in the rendered SWML payload (from `agent_base.py:766-787`). When contexts are defined, the SDK still requires a base prompt — the existing `Voice Interaction Guidelines` POM section serves this role (it remains a POM section at the top level, applied across all steps).

The two transition functions (`begin_assist`, `wrap_up_call`) are regular `@AgentBase.tool`-decorated methods. They appear in SWAIG once defined, and become reachable in a step only when listed in that step's `set_functions([...])`. The function bodies just return a `SwaigFunctionResult`; the SDK's step-advance behavior comes from the AI choosing to invoke a function whose enclosing step has `valid_steps` pointing at the next state.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `agent/main.py` | **Modify** | New `_build_employee_context` method on `VirtualEmployeeAgent`; slim `_update_personality`; new `begin_assist` and `wrap_up_call` SWAIG tools; wire `_build_employee_context` into `__init__`. |
| `agent/sdk_code_templates.py` | **Modify** | New `contexts_block(employee_config) -> str`; new `begin_assist` and `wrap_up_call` builders; export them so `_generate_sdk_code` can emit them unconditionally. |
| `agent/main.py` (`_generate_sdk_code`) | **Modify** | Replace the three `prompt_add_section` emissions with one POM emission (Voice Interaction Guidelines) + a `contexts_block(...)` call. Always emit `begin_assist` and `wrap_up_call` SWAIG handlers regardless of `enabled_functions`. |
| `agent/tests/test_sdk_code_generator.py` | **Modify** | Add `_extract_steps` and `_extract_pom_sections` helpers; add 6 new structural tests. The 14 existing SWML-parity tests pass unchanged after the generator is updated to mirror the live agent. |

---

## Task 1: Add `_extract_steps` / `_extract_pom_sections` test helpers + bootstrap structural tests (failing)

**Files:**
- Modify: `agent/tests/test_sdk_code_generator.py`

This task adds 6 NEW structural tests that fail today (because the live agent doesn't yet emit contexts/steps). Tasks 2–6 will make them pass.

- [ ] **Step 1: Add helpers + 6 new tests**

Append to `agent/tests/test_sdk_code_generator.py`:

```python
def _extract_steps(swml: dict, context_name: str = "default") -> dict:
    """Walk the SWML structure to the contexts → steps block.

    Returns a dict mapping step_name -> step_dict for the named context.
    Raises AssertionError if the contexts block is missing or malformed.
    """
    main = swml.get("sections", {}).get("main", [])
    ai_block = next((s.get("ai") for s in main if isinstance(s, dict) and s.get("ai")), None)
    assert ai_block, "No ai block in SWML main section"
    prompt = ai_block.get("prompt", {})
    contexts = prompt.get("contexts", {})
    assert context_name in contexts, f"Context '{context_name}' not found in {list(contexts.keys())}"
    steps_list = contexts[context_name].get("steps", [])
    return {s["name"]: s for s in steps_list}


def _extract_pom_sections(swml: dict) -> list:
    """Return the list of POM sections at the top-level prompt."""
    main = swml.get("sections", {}).get("main", [])
    ai_block = next((s.get("ai") for s in main if isinstance(s, dict) and s.get("ai")), None)
    assert ai_block, "No ai block in SWML main section"
    prompt = ai_block.get("prompt", {})
    return prompt.get("pom", [])


def test_step_definitions_have_correct_function_lists():
    config = _minimal_config()
    config["enabled_functions"] = ["transfer_to_human", "send_summary_sms", "check_business_hours"]
    config["transfer_number"] = "+15551112222"
    config["sms_from_number"] = "+15553334444"

    agent = VirtualEmployeeAgent(config)
    swml = json.loads(agent._render_swml())
    steps = _extract_steps(swml, "default")

    assert "begin_assist" in steps["greet"]["functions"]
    assert "check_business_hours" in steps["greet"]["functions"]
    assert "send_summary_sms" not in steps["greet"]["functions"]
    assert "transfer_to_human" not in steps["greet"]["functions"]

    assert "transfer_to_human" in steps["assist"]["functions"]
    assert "wrap_up_call" in steps["assist"]["functions"]
    assert "send_summary_sms" not in steps["assist"]["functions"]  # moved to wrap_up

    assert "send_summary_sms" in steps["wrap_up"]["functions"]
    assert "wrap_up_call" not in steps["wrap_up"]["functions"]  # already in wrap_up


def test_user_prompt_lands_in_assist_step():
    config = _minimal_config()
    config["prompt"] = "UNIQUE_MARKER_PROMPT_42"
    config["enabled_functions"] = []

    agent = VirtualEmployeeAgent(config)
    swml = json.loads(agent._render_swml())
    steps = _extract_steps(swml, "default")

    assert "UNIQUE_MARKER_PROMPT_42" in steps["assist"]["text"]
    assert "UNIQUE_MARKER_PROMPT_42" not in steps["greet"]["text"]
    assert "UNIQUE_MARKER_PROMPT_42" not in steps["wrap_up"]["text"]


def test_greeting_lands_in_greet_step():
    config = _minimal_config()
    config["greeting"] = "UNIQUE_MARKER_GREETING_99"
    config["enabled_functions"] = []

    agent = VirtualEmployeeAgent(config)
    swml = json.loads(agent._render_swml())
    steps = _extract_steps(swml, "default")

    assert "UNIQUE_MARKER_GREETING_99" in steps["greet"]["text"]


def test_voice_interaction_guidelines_remains_pom_section():
    config = _minimal_config()
    config["enabled_functions"] = []

    agent = VirtualEmployeeAgent(config)
    swml = json.loads(agent._render_swml())
    sections = _extract_pom_sections(swml)
    titles = [s.get("title") for s in sections if isinstance(s, dict)]

    assert "Voice Interaction Guidelines" in titles
    assert "Identity" not in titles, "Identity section must move to greet step text"
    assert "Instructions" not in titles, "Instructions section must move to assist step text"


def test_wrap_up_step_text_includes_sms_offer_when_enabled():
    config = _minimal_config()
    config["enabled_functions"] = ["send_summary_sms"]
    config["sms_from_number"] = "+15553334444"

    agent = VirtualEmployeeAgent(config)
    swml = json.loads(agent._render_swml())
    steps = _extract_steps(swml, "default")

    assert "text a summary" in steps["wrap_up"]["text"].lower()


def test_wrap_up_step_text_omits_sms_offer_when_disabled():
    config = _minimal_config()
    config["enabled_functions"] = ["transfer_to_human"]
    config["transfer_number"] = "+15551112222"

    agent = VirtualEmployeeAgent(config)
    swml = json.loads(agent._render_swml())
    steps = _extract_steps(swml, "default")

    assert "text a summary" not in steps["wrap_up"]["text"].lower()
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/.claude/worktrees/<worktree>" && .venv/bin/pytest agent/tests/test_sdk_code_generator.py -v -k "step_definitions or assist_step or greet_step or guidelines_remains or sms_offer"`

Expected: 6 FAIL — all six fail because `_extract_steps` raises `AssertionError: No contexts found` (or similar — current SWML has no `contexts` key at all).

The 14 existing parity tests should still PASS since the live agent and the generator are still in sync (both still emit POM-only SWML).

- [ ] **Step 3: Commit**

```bash
git add agent/tests/test_sdk_code_generator.py
git commit -m "test: bootstrap failing structural tests for contexts+steps refactor"
```

---

## Task 2: Add `begin_assist` and `wrap_up_call` SWAIG tools to live agent

**Files:**
- Modify: `agent/main.py` (add two `@AgentBase.tool`-decorated methods on `VirtualEmployeeAgent`)

These tools are first-class methods, registered automatically. They are NOT removed by the `_configure_functions` cleanup loop because we'll add them to the always-keep set.

- [ ] **Step 1: Add the two transition tools after `send_email`**

Insert these methods at `agent/main.py` immediately after `send_email` (after line 657, before `on_swml_request` at line 659):

```python
    @AgentBase.tool(
        name="begin_assist",
        description="Call this when the caller has stated their reason for calling and you are ready to start helping them.",
        parameters={"type": "object", "properties": {}}
    )
    def begin_assist(self, args, raw_data):
        """Step transition: greet -> assist."""
        return SwaigFunctionResult("Got it, let me help with that.")

    @AgentBase.tool(
        name="wrap_up_call",
        description="Call this when the caller's request is fully addressed and you are ready to close the call.",
        parameters={"type": "object", "properties": {}}
    )
    def wrap_up_call(self, args, raw_data):
        """Step transition: assist -> wrap_up."""
        return SwaigFunctionResult("Let me wrap things up.")
```

- [ ] **Step 2: Update `_configure_functions` to keep transition tools alive**

In `agent/main.py`, the `_configure_functions` cleanup loop (around line 290-310) removes any registered SWAIG function whose name isn't in `enabled_functions`. We must protect the transition tools.

Find the lines:
```python
            skill_function_names: set[str] = {
                getattr(instance, "tool_name", None)
                for instance in self.skill_manager.loaded_skills.values()
                if getattr(instance, "tool_name", None)
            }
            all_functions = list(self._tool_registry.get_all_functions().keys())
            for func_name in all_functions:
                if func_name not in swaig_functions and func_name not in skill_function_names:
                    self._tool_registry.remove_function(func_name)
```

Add a const for transition tools and include it in the keep-set:

```python
        # Transition tools are part of the greet→assist→wrap_up state machine
        # and must remain registered regardless of enabled_functions.
        BUILTIN_TRANSITIONS = {"begin_assist", "wrap_up_call"}

        if enabled_functions:
            skill_function_names: set[str] = {
                getattr(instance, "tool_name", None)
                for instance in self.skill_manager.loaded_skills.values()
                if getattr(instance, "tool_name", None)
            }
            all_functions = list(self._tool_registry.get_all_functions().keys())
            for func_name in all_functions:
                if (
                    func_name not in swaig_functions
                    and func_name not in skill_function_names
                    and func_name not in BUILTIN_TRANSITIONS
                ):
                    self._tool_registry.remove_function(func_name)
                    logger.info(f"  Removed function '{func_name}' (not in enabled list)")
```

- [ ] **Step 3: Run existing parity tests — they must still pass**

Run: `.venv/bin/pytest agent/tests/test_sdk_code_generator.py -v -k "not (step_definitions or assist_step or greet_step or guidelines_remains or sms_offer)"`

Expected: all 14 existing parity tests PASS. The new tools don't break SWML parity because the GENERATOR also needs them (added in Task 5) — but for now we haven't yet defined `contexts`, so live SWML still doesn't have the `begin_assist`/`wrap_up_call` functions in any step. They appear only in the SWAIG section. The generator emits the same SWAIG section once Task 5 lands.

If a parity test fails because the live agent's SWML now contains `begin_assist`/`wrap_up_call` SWAIG entries that the generator doesn't, we'll fix it in Task 5. For now, expect **either pass (if the SDK only includes functions referenced from a context) or fail with a specific SWAIG mismatch** — note which.

- [ ] **Step 4: Commit**

```bash
git add agent/main.py
git commit -m "feat(agent): add begin_assist and wrap_up_call transition tools"
```

---

## Task 3: Define `_build_employee_context` and wire into `VirtualEmployeeAgent.__init__`

**Files:**
- Modify: `agent/main.py` — new method `_build_employee_context`; called from `__init__` after `_update_personality`.

This is the core change. After this task, the live agent's SWML contains `contexts.default.steps[]`, but the generator hasn't been updated yet, so the 14 parity tests start failing.

- [ ] **Step 1: Add `_build_employee_context` method**

Insert this method on `VirtualEmployeeAgent` immediately after `_configure_post_prompt` (around line 220, before `_configure_functions` at line 222):

```python
    def _build_employee_context(self):
        """Define a 3-step state machine for the inbound call:
            greet → assist → wrap_up

        Mirrors the wizard's contexts/steps structure but with a generic
        flow suitable for any employee. Each step constrains which SWAIG
        functions the AI can call; the AI advances by calling begin_assist
        or wrap_up_call.
        """
        name = self.employee_config.get("name", "Assistant")
        role = self.employee_config.get("role", "Virtual Assistant")
        greeting = self.employee_config.get("greeting", f"Hello, I am {name}.")
        prompt_body = self.employee_config.get("prompt", "") or "Help the caller with their request."
        enabled_functions = self.employee_config.get("enabled_functions") or []

        # Function distribution per step
        greet_functions = ["begin_assist"]
        if "check_business_hours" in enabled_functions:
            greet_functions.append("check_business_hours")

        assist_functions = [fn for fn in enabled_functions if fn != "send_summary_sms"]
        assist_functions.append("wrap_up_call")

        wrap_up_functions = []
        if "send_summary_sms" in enabled_functions:
            wrap_up_functions.append("send_summary_sms")

        # Step text bodies
        greet_text = (
            f'You are {name}, a {role}. Open the call with: "{greeting}". '
            "After greeting, listen for what the caller needs. Keep replies to 1-3 sentences. "
            "When the caller has stated what they're calling about, call begin_assist() to start helping."
        )

        assist_text = (
            f"{prompt_body}\n\n"
            "Use the available SWAIG functions when appropriate. When the caller's request is fully "
            "addressed, call wrap_up_call() to close the call gracefully."
        )

        wrap_up_text_parts = ["Wrap the call. Briefly recap what happened in 1 sentence."]
        if "send_summary_sms" in enabled_functions:
            wrap_up_text_parts.append(
                "Then offer to text a summary to the caller's phone. If they say yes, ask for the "
                "number and call send_summary_sms with a short summary."
            )
        wrap_up_text_parts.append("Thank the caller and end the call.")
        wrap_up_text = " ".join(wrap_up_text_parts)

        # Build the state machine
        contexts = self.define_contexts()
        ctx = contexts.add_context("default")

        ctx.add_step("greet") \
            .set_text(greet_text) \
            .set_step_criteria("Caller has stated their reason for calling") \
            .set_valid_steps(["assist"]) \
            .set_functions(greet_functions)

        ctx.add_step("assist") \
            .set_text(assist_text) \
            .set_step_criteria("Caller's request handled or escalated") \
            .set_valid_steps(["wrap_up"]) \
            .set_functions(assist_functions)

        ctx.add_step("wrap_up") \
            .set_text(wrap_up_text) \
            .set_functions(wrap_up_functions)
        # wrap_up is terminal — no set_valid_steps()
```

- [ ] **Step 2: Wire `_build_employee_context` into `__init__`**

In `VirtualEmployeeAgent.__init__` (around line 122-125), the current sequence is:

```python
        # Configure personality
        self._update_personality()

        # Configure post-prompt for call analytics
        self._configure_post_prompt()

        # Add enabled functions
        self._configure_functions()
```

Insert the context build between personality and post-prompt:

```python
        # Configure personality (slimmed: only Voice Interaction Guidelines + temperature + speech_hints)
        self._update_personality()

        # Build the 3-step state machine: greet → assist → wrap_up
        self._build_employee_context()

        # Configure post-prompt for call analytics
        self._configure_post_prompt()

        # Add enabled functions
        self._configure_functions()
```

(`_update_personality` is slimmed in Task 4; for now both Identity/Instructions POM AND the new contexts will both render. That's OK temporarily — Task 4 removes the POM duplicates.)

- [ ] **Step 3: Verify the live SWML now has contexts**

Run:

```bash
.venv/bin/python -c "
from agent.main import VirtualEmployeeAgent
import json
agent = VirtualEmployeeAgent({
    'id': 'demo', 'name': 'Demo', 'role': 'Helper',
    'greeting': 'Hi.', 'prompt': 'Help the caller.',
    'enabled_functions': ['transfer_to_human']
})
swml = json.loads(agent._render_swml())
ai = next(s.get('ai') for s in swml['sections']['main'] if isinstance(s, dict) and s.get('ai'))
print(json.dumps(ai.get('prompt', {}).get('contexts', {}), indent=2)[:500])
"
```

Expected: prints a `default` context with three steps (`greet`, `assist`, `wrap_up`) including their text, criteria, valid_steps, functions.

- [ ] **Step 4: Run all tests — expect parity tests to break, structural tests partially pass**

Run: `.venv/bin/pytest agent/tests/test_sdk_code_generator.py -v`

Expected after this task:
- The 14 SWML-parity tests now FAIL because live SWML has `contexts` but the generator doesn't emit them.
- The 6 structural tests now PARTIALLY PASS (the structure exists). Specifically: `test_step_definitions_have_correct_function_lists`, `test_user_prompt_lands_in_assist_step`, `test_greeting_lands_in_greet_step`, `test_wrap_up_step_text_includes_sms_offer_when_enabled`, `test_wrap_up_step_text_omits_sms_offer_when_disabled` should PASS. `test_voice_interaction_guidelines_remains_pom_section` will FAIL because Identity / Instructions are still in the POM (Task 4 removes them).

Note the count: aim for 5 structural-pass + 1 structural-fail + 14 parity-fail.

- [ ] **Step 5: Commit**

```bash
git add agent/main.py
git commit -m "feat(agent): build greet/assist/wrap_up state machine via contexts+steps"
```

---

## Task 4: Slim `_update_personality` to keep only Voice Interaction Guidelines

**Files:**
- Modify: `agent/main.py` — `_update_personality` method (lines ~153-194).

- [ ] **Step 1: Replace `_update_personality` body**

Find the current method (around lines 153-194). Replace its body with:

```python
    def _update_personality(self):
        """Set top-level cross-step config: voice-interaction guidelines POM
        section, temperature, and speech_hints. Step-specific identity and
        instructions live in the contexts/steps state machine — see
        _build_employee_context.
        """
        # Voice interaction guidelines apply across all steps
        guidelines = [
            "Keep responses to 1-3 sentences — this is a phone call, not a text chat",
            "Be conversational and natural, not robotic",
            "Listen fully before responding",
            "If you are unsure about something, say so and offer to connect the caller with a human",
            "Always end interactions with a clear next step",
        ]
        # NOTE: the SMS-offer guideline is no longer added here — it lives in
        # the wrap_up step's text (see _build_employee_context).

        self.prompt_add_section(
            "Voice Interaction Guidelines",
            bullets=guidelines
        )

        # Temperature applies across all steps
        temperature = self.employee_config.get('temperature', 0.7)
        self.set_param("temperature", temperature)
```

(`speech_hints` is set in `__init__` directly at lines 110-116; that stays untouched.)

- [ ] **Step 2: Run tests — `test_voice_interaction_guidelines_remains_pom_section` should now PASS**

Run: `.venv/bin/pytest agent/tests/test_sdk_code_generator.py::test_voice_interaction_guidelines_remains_pom_section -v`

Expected: PASS. The Identity and Instructions POM sections are gone; only Voice Interaction Guidelines remains.

The 14 parity tests are still failing (generator still doesn't emit contexts).

- [ ] **Step 3: Commit**

```bash
git add agent/main.py
git commit -m "refactor(agent): slim _update_personality — identity/instructions live in steps now"
```

---

## Task 5: Update generator to emit contexts/steps + transition tools

**Files:**
- Modify: `agent/sdk_code_templates.py` — new `contexts_block` helper, plus `begin_assist` / `wrap_up_call` builders.
- Modify: `agent/main.py` `_generate_sdk_code` — replace POM emission with VIG-only POM + `contexts_block` call; always emit `begin_assist` + `wrap_up_call` SWAIG handlers.

This task brings the generator back into parity with the live agent. After this task, all 20 tests (14 parity + 6 structural) should pass.

- [ ] **Step 1: Add `_build_begin_assist` and `_build_wrap_up_call` to `agent/sdk_code_templates.py`**

Append to `agent/sdk_code_templates.py`:

```python
def _build_begin_assist(employee_config: dict) -> tuple[str, dict[str, str]]:
    method = '''    @AgentBase.tool(
        name="begin_assist",
        description="Call this when the caller has stated their reason for calling and you are ready to start helping them.",
        parameters={"type": "object", "properties": {}}
    )
    def begin_assist(self, args, raw_data):
        """Step transition: greet -> assist."""
        return SwaigFunctionResult("Got it, let me help with that.")'''
    return method, {}


def _build_wrap_up_call(employee_config: dict) -> tuple[str, dict[str, str]]:
    method = '''    @AgentBase.tool(
        name="wrap_up_call",
        description="Call this when the caller's request is fully addressed and you are ready to close the call.",
        parameters={"type": "object", "properties": {}}
    )
    def wrap_up_call(self, args, raw_data):
        """Step transition: assist -> wrap_up."""
        return SwaigFunctionResult("Let me wrap things up.")'''
    return method, {}


SWAIG_TEMPLATES["begin_assist"] = _build_begin_assist
SWAIG_TEMPLATES["wrap_up_call"] = _build_wrap_up_call
```

- [ ] **Step 2: Add `contexts_block(employee_config) -> str` helper**

Append to `agent/sdk_code_templates.py`:

```python
def contexts_block(employee_config: dict) -> str:
    """Emit the `define_contexts()` + 3 `add_step(...)` calls mirroring
    VirtualEmployeeAgent._build_employee_context.

    Returns a code-string ready to insert into the generated agent's
    __init__ method at one indent level inside the class body.
    """
    name = employee_config.get("name", "Assistant").replace('"', '\\"')
    role = employee_config.get("role", "Virtual Assistant").replace('"', '\\"')
    greeting = (employee_config.get("greeting") or f"Hello, I am {name}.").replace('"', '\\"')
    prompt_body = employee_config.get("prompt") or "Help the caller with their request."
    enabled_functions = employee_config.get("enabled_functions") or []

    greet_functions = ["begin_assist"]
    if "check_business_hours" in enabled_functions:
        greet_functions.append("check_business_hours")
    assist_functions = [fn for fn in enabled_functions if fn != "send_summary_sms"]
    assist_functions.append("wrap_up_call")
    wrap_up_functions = ["send_summary_sms"] if "send_summary_sms" in enabled_functions else []

    greet_text = (
        f'You are {name}, a {role}. Open the call with: "{greeting}". '
        "After greeting, listen for what the caller needs. Keep replies to 1-3 sentences. "
        "When the caller has stated what they're calling about, call begin_assist() to start helping."
    )

    assist_text = (
        f"{prompt_body}\n\n"
        "Use the available SWAIG functions when appropriate. When the caller's request is fully "
        "addressed, call wrap_up_call() to close the call gracefully."
    )

    wrap_up_parts = ["Wrap the call. Briefly recap what happened in 1 sentence."]
    if "send_summary_sms" in enabled_functions:
        wrap_up_parts.append(
            "Then offer to text a summary to the caller's phone. If they say yes, ask for the "
            "number and call send_summary_sms with a short summary."
        )
    wrap_up_parts.append("Thank the caller and end the call.")
    wrap_up_text = " ".join(wrap_up_parts)

    return (
        "        contexts = self.define_contexts()\n"
        "        ctx = contexts.add_context(\"default\")\n"
        "\n"
        f"        ctx.add_step(\"greet\") \\\n"
        f"            .set_text({json.dumps(greet_text)}) \\\n"
        "            .set_step_criteria(\"Caller has stated their reason for calling\") \\\n"
        "            .set_valid_steps([\"assist\"]) \\\n"
        f"            .set_functions({json.dumps(greet_functions)})\n"
        "\n"
        f"        ctx.add_step(\"assist\") \\\n"
        f"            .set_text({json.dumps(assist_text)}) \\\n"
        "            .set_step_criteria(\"Caller's request handled or escalated\") \\\n"
        "            .set_valid_steps([\"wrap_up\"]) \\\n"
        f"            .set_functions({json.dumps(assist_functions)})\n"
        "\n"
        f"        ctx.add_step(\"wrap_up\") \\\n"
        f"            .set_text({json.dumps(wrap_up_text)}) \\\n"
        f"            .set_functions({json.dumps(wrap_up_functions)})\n"
    )
```

- [ ] **Step 3: Rewrite the prompt-section emission in `_generate_sdk_code`**

In `agent/main.py`, locate `_generate_sdk_code`'s f-string template (around lines 1645-1697). The current template emits Identity, Instructions, and Voice Interaction Guidelines POM sections. Replace those three with: ONE Voice Interaction Guidelines POM section, then a `{contexts_lines}` placeholder.

Find the variables block (around lines 1565-1590) and remove `identity_body_literal`, `instructions_block`, and rename `guidelines_literal` to apply only to the VIG. Then add a `contexts_lines = contexts_block(employee_config)` line.

In the f-string template, find:
```python
        self.prompt_add_section(
            "Identity",
            body={identity_body_literal},
        )
{instructions_block}        self.prompt_add_section(
            "Voice Interaction Guidelines",
            bullets={guidelines_literal},
        )
```

Replace with:
```python
        self.prompt_add_section(
            "Voice Interaction Guidelines",
            bullets={guidelines_literal},
        )

{contexts_lines}
```

- [ ] **Step 4: Always emit `begin_assist` + `wrap_up_call` SWAIG handlers**

In `_generate_sdk_code` (the emit loop around lines 1600-1612), the loop iterates `enabled_functions` and looks up each in `SWAIG_TEMPLATES`. Add a special-case prepend so `begin_assist` and `wrap_up_call` are always emitted, regardless of `enabled_functions`.

Find:
```python
    swaig_methods: list = []
    helpers: dict[str, str] = {}
    unknown_warnings: list[str] = []
    for fn_id in enabled_functions:
        if fn_id == "search_knowledge":
            continue
        builder = SWAIG_TEMPLATES.get(fn_id)
        if builder is None:
            unknown_warnings.append(f"    # WARN: skipped unknown function '{fn_id}'")
            continue
        method_src, builder_helpers = builder(employee_config)
        swaig_methods.append(method_src)
        for hname, hsrc in builder_helpers.items():
            helpers.setdefault(hname, hsrc)
```

Replace with:
```python
    swaig_methods: list = []
    helpers: dict[str, str] = {}
    unknown_warnings: list[str] = []

    # Built-in transitions are emitted unconditionally — they're part of the
    # state machine, not the user-configurable enabled_functions list.
    BUILTIN_TRANSITIONS = ["begin_assist", "wrap_up_call"]
    for fn_id in BUILTIN_TRANSITIONS:
        method_src, builder_helpers = SWAIG_TEMPLATES[fn_id](employee_config)
        swaig_methods.append(method_src)
        for hname, hsrc in builder_helpers.items():
            helpers.setdefault(hname, hsrc)

    for fn_id in enabled_functions:
        if fn_id == "search_knowledge":
            continue
        if fn_id in BUILTIN_TRANSITIONS:
            continue  # already emitted
        builder = SWAIG_TEMPLATES.get(fn_id)
        if builder is None:
            unknown_warnings.append(f"    # WARN: skipped unknown function '{fn_id}'")
            continue
        method_src, builder_helpers = builder(employee_config)
        swaig_methods.append(method_src)
        for hname, hsrc in builder_helpers.items():
            helpers.setdefault(hname, hsrc)
```

- [ ] **Step 5: Run all tests — expect 20/20 pass**

Run: `.venv/bin/pytest agent/tests/test_sdk_code_generator.py -v`

Expected: 20 passed (14 parity + 6 structural).

If a parity test fails, the assertion diff identifies which detail of the generated SWML still drifts from live. Iterate until all pass.

- [ ] **Step 6: Commit**

```bash
git add agent/sdk_code_templates.py agent/main.py
git commit -m "feat(agent-code): emit contexts+steps and transition tools in generator"
```

---

## Task 6: Manual smoke test against running app

**Files:** none modified — verification step only.

The unit tests verify the SWML schema is correct, but they don't verify that a live call actually emits `step_change` events into `swaig_log`. That requires placing a real call against a running agent.

- [ ] **Step 1: Start the backend**

Run (in a separate terminal):
```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/.claude/worktrees/<worktree>" && .venv/bin/uvicorn agent.main:app --host 127.0.0.1 --port 8000 --log-level info
```

- [ ] **Step 2: Create or use a test employee**

If the in-memory store is empty:
```bash
curl -sf -X POST http://127.0.0.1:8000/api/create-employee -H "Content-Type: application/json" -d '{
  "id": "smoke-test",
  "name": "Smoke Test",
  "role": "Receptionist",
  "greeting": "Thanks for calling.",
  "prompt": "You help callers with general questions.",
  "voice": "openai.nova",
  "enabled_functions": ["transfer_to_human", "send_summary_sms"],
  "transfer_number": "+15551112222",
  "sms_from_number": "+15553334444"
}'
```

- [ ] **Step 3: Inspect the SWML directly**

Run: `curl -sf http://127.0.0.1:8000/swml/smoke-test | python3 -m json.tool | head -100`

Confirm the output contains a `prompt.contexts.default.steps` array with three entries: `greet`, `assist`, `wrap_up`.

- [ ] **Step 4: Place a call and inspect the post-conversation payload**

Use the dashboard or SignalWire's test caller to dial the agent. Have a brief conversation (state your reason for calling, let the AI help, then hang up).

Inspect the payload received by `/api/post-prompt/smoke-test`. The `swaig_log` array should contain entries with type `step_change` (or similar — the SDK names this event). The exact field name and shape are SDK-defined; this is the verification we couldn't do in unit tests.

If `step_change` events do NOT appear:
- Check the SDK version (`pip show signalwire-agents`). Pre-0.1.54 versions may not emit them.
- Check the `swaig_log` for any other state-related events; the SDK may use a different event name.
- Document the actual event names in a comment in `_build_employee_context` for sub-project 2's UI to consume.

If `step_change` events DO appear: capture a sample payload and save it to `docs/superpowers/specs/2026-05-07-employee-contexts-steps-refactor-design.md` as an appendix for sub-project 2's reference.

- [ ] **Step 5: Document findings**

Append a section to the spec file (`docs/superpowers/specs/2026-05-07-employee-contexts-steps-refactor-design.md`) titled `## Smoke test findings (YYYY-MM-DD)` capturing:
- SDK event name (e.g., `step_change`, `state_change`, etc.)
- Sample payload structure
- Any quirks observed

Commit:
```bash
git add docs/superpowers/specs/2026-05-07-employee-contexts-steps-refactor-design.md
git commit -m "docs: capture smoke-test findings for state machine"
```

---

## Task 7: Update spec status + memory

**Files:**
- Modify: `docs/superpowers/specs/2026-05-07-employee-contexts-steps-refactor-design.md` — change status to Implemented.
- Modify: `~/.claude/projects/.../memory/project_hirewire_pending.md` — note this sub-project is complete; sub-project 2 (state-flow UI tab) is the remaining open work.

- [ ] **Step 1: Update spec status**

Edit the spec frontmatter, change `**Status:** Design approved, pending plan` to `**Status:** Implemented`.

- [ ] **Step 2: Update memory**

In `/Users/jonny/.claude/projects/-Users-jonny-Library-Mobile-Documents-com-apple-CloudDocs-CLOUD-CLAUDE/memory/project_hirewire_pending.md`, add to the resolved-tasks list:
- `✅ Employee agents now use Contexts+Steps (greet → assist → wrap_up). Branch <branch-name>. Step_change events confirmed during smoke test.`

And replace the call-log UI redesign section to mention sub-project 2 is now unblocked.

- [ ] **Step 3: Final test run + commit**

Run: `.venv/bin/pytest agent/tests/ -v`
Expected: 20 passed.

```bash
git add docs/superpowers/specs/2026-05-07-employee-contexts-steps-refactor-design.md
git commit -m "docs: mark employee contexts+steps refactor as implemented"
```

---

## Self-Review Notes

### Spec coverage
- Goal 1 (3 steps in default context): covered by `_build_employee_context` (Task 3) + `test_step_definitions_have_correct_function_lists` (Task 1).
- Goal 2 (step_change events emitted): covered by Task 6's manual smoke test.
- Goal 3 (prompt → assist text): covered by `test_user_prompt_lands_in_assist_step` (Task 1).
- Goal 4 (greeting → greet text): covered by `test_greeting_lands_in_greet_step` (Task 1).
- Goal 5 (enabled_functions distributed): covered by `test_step_definitions_have_correct_function_lists` (Task 1).
- Goal 6 (generator emits new structure): covered by Task 5 + the 14 parity tests.
- Goal 7 (new tests verify structure): covered by the 6 structural tests in Task 1.

### Open questions resolution
1. SDK API confirmed via reading `contexts.py` and `agent_base.py`. Documented in the SDK API Reference section above.
2. Transition function bodies just return `SwaigFunctionResult` — the SDK handles step advancement based on `valid_steps` constraint when the AI invokes a function within a step. Confirmed via wizard's pattern (its `set_identity` etc. work the same way).
3. SWML shape for contexts: `prompt.contexts.<context_name>.steps[]`. Each step is `{name, text, step_criteria?, functions?, valid_steps?}`. Documented in the SDK API Reference section.
4. Smoke test for `step_change` events: included as Task 6 (manual verification). Programmatic simulation of an LLM-driven conversation is out of scope — the SDK doesn't expose a clean test harness for that, and a fake LLM client would test fixtures rather than real behavior.

### Placeholder scan
No "TBD"/"TODO"/"appropriate error handling" patterns. Every step has concrete code or commands.

### Type consistency
- `_build_employee_context` (Task 3) and `contexts_block` (Task 5) produce identical step structures (same step names, same function-distribution rules, same text bodies). Both reference the same source-of-truth dispatch (`enabled_functions`).
- Built-in transitions consistently named `begin_assist` and `wrap_up_call` across Tasks 2, 3, 5.
- Test helpers (`_extract_steps`, `_extract_pom_sections`) used in Task 1 and remain valid for all subsequent tasks.
