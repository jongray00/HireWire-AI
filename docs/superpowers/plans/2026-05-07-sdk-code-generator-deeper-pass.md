# SDK Code Generator — Deeper Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/agent-code/{employee_id}` return Python that, when run with appropriate env vars set, serves SWML schema-equivalent to the live HireWire `/swml/{employee_id}` for that employee.

**Architecture:** Extract per-function code templates into a new `agent/sdk_code_templates.py`. Rewrite `_generate_sdk_code` in `agent/main.py` to compose output by mirroring `VirtualEmployeeAgent.__init__`'s flow exactly. Guard against drift with a SWML-parity pytest that compares the SDK's `_render_swml()` output between the generated agent and the live `VirtualEmployeeAgent` for representative fixtures.

**Tech Stack:** Python 3.11+, `signalwire-agents>=0.1.54`, FastAPI, pytest (added in this plan), `importlib.util` for dynamic test loading.

**Spec:** [`docs/superpowers/specs/2026-05-07-sdk-code-generator-deeper-pass-design.md`](../specs/2026-05-07-sdk-code-generator-deeper-pass-design.md)

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `agent/sdk_code_templates.py` | **Create** | All per-function code-string templates: `SWAIG_TEMPLATES`, `datasphere_block`, `env_var_header`, helper methods registry. |
| `agent/main.py` | **Modify** (lines 1519–1617) | Rewrite `_generate_sdk_code` to compose from `agent/sdk_code_templates`. |
| `agent/tests/__init__.py` | **Create** (empty) | Marks test dir as package. |
| `agent/tests/test_sdk_code_generator.py` | **Create** | SWML-parity tests across three fixtures. |
| `pyproject.toml` | **Modify** | Add `[project.optional-dependencies.dev]` with `pytest`; add `[tool.pytest.ini_options]` with `testpaths = ["agent/tests"]`. |

The generator's public contract (`_generate_sdk_code(employee_config) -> str` and the `/agent-code/{employee_id}` endpoint) is unchanged.

---

## SWAIG Templates Helper Convention

Each entry in `SWAIG_TEMPLATES` is a function `(employee_config: dict) -> tuple[str, dict[str, str]]`:
- First element: the full `@AgentBase.tool(...)` decorator + method body source.
- Second element: a dict of helper-method-name → source (e.g. `{"_clean_phone_number": "<source>"}`). Helpers are de-duped across all enabled templates by the composer in `_generate_sdk_code`.

This avoids duplicating `_clean_phone_number` if multiple templates ever need it.

---

## Task 1: Add pytest dev dep + bootstrap test infrastructure

**Files:**
- Modify: `pyproject.toml`
- Create: `agent/tests/__init__.py`
- Create: `agent/tests/test_sdk_code_generator.py`

- [ ] **Step 1: Add pytest as dev dependency in `pyproject.toml`**

Replace the file with:

```toml
[project]
name = "repl-nix-workspace"
version = "0.1.0"
description = "Add your description here"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.119.1",
    "python-dotenv>=1.1.1",
    "signalwire-agents>=0.1.54",
    "uvicorn[standard]>=0.38.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
]

[tool.pytest.ini_options]
testpaths = ["agent/tests"]
```

- [ ] **Step 2: Create empty test package init**

Create `agent/tests/__init__.py` with empty content.

- [ ] **Step 3: Install dev deps**

Run: `cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && uv sync --extra dev`
Expected: pytest installed in `.venv`.

- [ ] **Step 4: Write the bootstrap parity test (currently failing)**

Create `agent/tests/test_sdk_code_generator.py`:

```python
"""SWML-parity tests for the SDK code generator.

Each fixture builds an in-memory employee_config, runs both the live
VirtualEmployeeAgent and the generator's output through the SDK's
_render_swml() method, and asserts the resulting SWML strings match
modulo webhook URL hosts.
"""
import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

# Make `agent` importable when tests run from repo root.
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from agent.main import VirtualEmployeeAgent, _generate_sdk_code


def _load_generated_module(code: str, tmp_path: Path):
    """Write generated code to a temp file and import it."""
    file_path = tmp_path / "generated_agent.py"
    file_path.write_text(code)
    spec = importlib.util.spec_from_file_location("generated_agent", file_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _normalize_swml(swml_str: str) -> dict:
    """Parse SWML JSON and strip webhook hosts so we compare schema, not host."""
    data = json.loads(swml_str)
    text = json.dumps(data, sort_keys=True)
    # Strip absolute webhook hosts → relative paths, both http and https.
    text = re.sub(r'https?://[^/"]+/swaig', '/swaig', text)
    text = re.sub(r'https?://[^/"]+/post_prompt', '/post_prompt', text)
    return json.loads(text)


def _find_first_class(module):
    """Return the first AgentBase subclass defined in the imported module."""
    from signalwire_agents import AgentBase
    for name in dir(module):
        obj = getattr(module, name)
        if isinstance(obj, type) and issubclass(obj, AgentBase) and obj is not AgentBase:
            return obj
    raise AssertionError("No AgentBase subclass found in generated module")


def _minimal_config():
    return {
        "id": "test-min",
        "name": "Test Minimal",
        "role": "Receptionist",
        "voice": "openai.nova",
        "language": "en-US",
        "temperature": 0.7,
        "greeting": "Hello, this is Test Minimal.",
        "prompt": "Help callers with basic questions.",
        "enabled_functions": [],
    }


def test_minimal_config_swml_parity(tmp_path, monkeypatch):
    """Empty enabled_functions: prompt + post-prompt + language must match."""
    config = _minimal_config()
    # Generate
    code = _generate_sdk_code(config)
    module = _load_generated_module(code, tmp_path)
    GenAgent = _find_first_class(module)
    gen_agent = GenAgent()
    gen_swml = gen_agent._render_swml()

    # Live
    live_agent = VirtualEmployeeAgent("test-min", config)
    live_swml = live_agent._render_swml()

    assert _normalize_swml(gen_swml) == _normalize_swml(live_swml)
```

- [ ] **Step 5: Run the failing test**

Run: `cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && .venv/bin/pytest agent/tests/test_sdk_code_generator.py::test_minimal_config_swml_parity -v`
Expected: FAIL — current `_generate_sdk_code` produces different prompt sections (`Identity and mission` vs live's `Identity` / `Instructions` / `Voice Interaction Guidelines`), and a simplified post-prompt vs live's rich JSON instructions. The diff in the assertion error confirms the drift to fix in Task 3.

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml agent/tests/__init__.py agent/tests/test_sdk_code_generator.py
git commit -m "test: bootstrap pytest + failing SWML-parity test for sdk code generator"
```

---

## Task 2: Create `agent/sdk_code_templates.py` skeleton

**Files:**
- Create: `agent/sdk_code_templates.py`

- [ ] **Step 1: Create the module with empty exports**

Create `agent/sdk_code_templates.py`:

```python
"""Code-string templates used by `_generate_sdk_code` in agent/main.py.

Each entry in SWAIG_TEMPLATES maps a SWAIG function id to a builder:
    builder(employee_config: dict) -> tuple[str, dict[str, str]]

Returns:
    (method_source, helpers)

method_source: full @AgentBase.tool(...) decorator + method body, ready to
    paste into a generated file at one indent level inside the class body.
helpers: dict of helper-method-name -> source. Composer de-dups by name
    so the same helper from multiple templates is emitted exactly once.
"""
from __future__ import annotations

from typing import Callable, Dict, Tuple


# function_id -> builder(employee_config) -> (method_source, helpers)
SWAIG_TEMPLATES: Dict[str, Callable[[dict], Tuple[str, Dict[str, str]]]] = {}


def datasphere_block(employee_config: dict) -> str:
    """Return code for `add_skill("datasphere_serverless", ...)` calls plus the
    optional Knowledge Base Routing pom-section. Returns "" if not applicable.
    """
    return ""


def env_var_header(employee_config: dict, enabled_functions: list[str]) -> str:
    """Return the top-of-file docstring listing required env vars + quickstart.

    Only lists env vars actually consumed by the enabled functions / DataSphere.
    Surfaces user-config values as comments (e.g. HireWire-stored transfer
    number) but never inlines API tokens.
    """
    return ""
```

- [ ] **Step 2: Run the test (still failing, but no import errors)**

Run: `cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && .venv/bin/pytest agent/tests/test_sdk_code_generator.py -v`
Expected: FAIL on assertion (same as Task 1) — but no import errors.

- [ ] **Step 3: Commit**

```bash
git add agent/sdk_code_templates.py
git commit -m "feat: scaffold agent/sdk_code_templates module"
```

---

## Task 3: Rewrite `_generate_sdk_code` to mirror live `__init__` flow

**Files:**
- Modify: `agent/main.py` (replace `_generate_sdk_code` body, lines 1519–1617)

This task fixes the prompt-section / post-prompt / `add_language` drift identified by the failing test. After this task, the minimal-config test should pass.

- [ ] **Step 1: Replace `_generate_sdk_code` with the corrected composer**

Replace `agent/main.py` lines 1519–1617 with:

```python
def _generate_sdk_code(employee_config: Dict[str, Any]) -> str:
    """Render runnable Python that, when executed, builds the live agent's SWML.

    Mirrors VirtualEmployeeAgent.__init__ in this file: same add_language call
    (with speech_fillers + function_fillers), same three prompt sections
    (Identity / Instructions / Voice Interaction Guidelines), same conditional
    SMS-offer bullet, same temperature, same rich post-prompt, same DataSphere
    skill registration logic, and emits real handler bodies for every enabled
    SWAIG function with per-environment values read from os.environ.
    """
    from agent.sdk_code_templates import (
        SWAIG_TEMPLATES,
        datasphere_block,
        env_var_header,
    )

    name = employee_config.get("name", "Employee")
    role = employee_config.get("role", "Virtual Assistant")
    employee_id = employee_config.get("id", "employee")
    voice = employee_config.get("voice", "openai.nova")
    language_code = employee_config.get("language", "en-US")
    temperature = employee_config.get("temperature", 0.7)
    greeting = employee_config.get("greeting", f"Hello, I am {name}.")
    prompt_body = employee_config.get("prompt", "")
    enabled_functions = employee_config.get("enabled_functions") or []

    # Resolve language name the same way the live agent does.
    lang_map = {
        "en": "English", "en-US": "English", "en-GB": "English",
        "en-AU": "English", "en-IN": "English", "en-NZ": "English",
        "es": "Spanish", "es-ES": "Spanish", "es-419": "Spanish",
        "fr": "French", "fr-FR": "French", "fr-CA": "French",
        "de": "German", "de-DE": "German",
        "it": "Italian", "it-IT": "Italian",
        "pt": "Portuguese", "pt-BR": "Portuguese", "pt-PT": "Portuguese",
        "ja": "Japanese", "ja-JP": "Japanese",
        "zh": "Chinese", "zh-CN": "Chinese",
        "ko": "Korean", "ko-KR": "Korean",
        "hi": "Hindi", "ru": "Russian", "nl": "Dutch", "pl": "Polish",
        "sv": "Swedish", "sv-SE": "Swedish",
        "da": "Danish", "da-DK": "Danish",
        "tr": "Turkish", "vi": "Vietnamese", "uk": "Ukrainian",
        "multi": "Multilingual",
    }
    language_name = lang_map.get(language_code, "English")

    class_name = "".join(word.capitalize() or "_" for word in (name.split() or ["Agent"])) or "Agent"

    # Build voice-interaction guidelines (mirror _update_personality lines 171-185).
    guidelines = [
        "Keep responses to 1-3 sentences — this is a phone call, not a text chat",
        "Be conversational and natural, not robotic",
        "Listen fully before responding",
        "If you are unsure about something, say so and offer to connect the caller with a human",
        "Always end interactions with a clear next step",
    ]
    if "send_summary_sms" in enabled_functions:
        guidelines.append(
            "Before ending the call, ask the caller if they would like a summary sent to their phone via text message. "
            "If yes, ask for their phone number, then use the send_summary_sms function."
        )

    guidelines_literal = json.dumps(guidelines, indent=8).replace("\n", "\n        ")

    # Identity section body (mirror _update_personality line 161-164).
    safe_greeting = greeting.replace('"', '\\"')
    identity_body = f'You are {name}, a {role}. Your greeting is: "{safe_greeting}"'
    identity_body_escaped = identity_body.replace('"""', '\\"\\"\\"')

    # Instructions section is conditional on prompt_body being non-empty.
    safe_prompt = prompt_body.replace('"""', '\\"\\"\\"')
    instructions_block = (
        f'        self.prompt_add_section("Instructions", body="""{safe_prompt}""")\n'
        if prompt_body else ""
    )

    # Compose enabled SWAIG handlers, de-duping helpers.
    swaig_methods: list[str] = []
    helpers: dict[str, str] = {}
    unknown_warnings: list[str] = []
    for fn_id in enabled_functions:
        if fn_id == "search_knowledge":
            continue  # handled by datasphere_block
        builder = SWAIG_TEMPLATES.get(fn_id)
        if builder is None:
            unknown_warnings.append(f"    # WARN: skipped unknown function '{fn_id}'")
            continue
        method_src, builder_helpers = builder(employee_config)
        swaig_methods.append(method_src)
        for hname, hsrc in builder_helpers.items():
            helpers.setdefault(hname, hsrc)

    helpers_block = "\n\n".join(helpers.values())
    swaig_block = "\n\n".join(swaig_methods)
    unknown_block = "\n".join(unknown_warnings)
    datasphere_lines = datasphere_block(employee_config)

    header = env_var_header(employee_config, enabled_functions)

    # Post-prompt mirrors _configure_post_prompt verbatim.
    post_prompt_text = (
        "You have just finished a phone conversation. Produce a JSON object summarizing it. "
        "ALWAYS produce valid JSON — do not add commentary, do not wrap in code fences, "
        "do not refuse. If the call was short, silent, or had no clear content, still "
        "produce the JSON with reasonable defaults (empty strings, empty arrays, null where appropriate).\\n"
        "\\n"
        "Required fields (every one must appear, even if empty):\\n"
        '  \"summary\": 2-3 sentence summary of what happened. If nothing happened, say so plainly.\\n'
        '  \"caller_intent\": one sentence describing what the caller wanted. Empty string if unclear.\\n'
        '  \"outcome\": one of \"resolved\" | \"transferred\" | \"abandoned\" | \"follow_up_needed\" | \"no_outcome\".\\n'
        '  \"sentiment\": one of \"positive\" | \"neutral\" | \"negative\".\\n'
        '  \"topics\": array of 1-5 lowercase topic keywords. Empty array if none.\\n'
        '  \"follow_up\": any action items, or null.\\n'
        '  \"key_quotes\": array of up to 3 short verbatim quotes from the caller. Empty array if none.\\n'
        '  \"next_steps\": array of recommended next steps for the agent owner. Empty array if none.\\n'
        "\\n"
        "Output ONLY the JSON object. No preamble, no postscript, no markdown fences."
    )

    return f'''#!/usr/bin/env python3
{header}
import os

from signalwire_agents import AgentBase, SwaigFunctionResult


class {class_name}(AgentBase):
    """An AI voice agent built with the signalwire-agents SDK."""

    def __init__(self):
        super().__init__(
            name="{name}",
            route="/swml/{employee_id}",
        )

        self.add_language(
            name="{language_name}",
            code="{language_code}",
            voice="{voice}",
            speech_fillers=[
                "Let me help you with that...",
                "One moment please...",
                "I'm processing your request...",
            ],
            function_fillers=[
                "Let me check on that for you...",
                "I'm looking that up now...",
            ],
        )

        self.prompt_add_section(
            "Identity",
            body="""{identity_body_escaped}""",
        )
{instructions_block}        self.prompt_add_section(
            "Voice Interaction Guidelines",
            bullets={guidelines_literal},
        )

        self.set_param("temperature", {temperature})

{datasphere_lines}
        self.set_post_prompt(
            "{post_prompt_text}"
        )

{swaig_block}

{helpers_block}
{unknown_block}


if __name__ == "__main__":
    {class_name}().run()
'''
```

- [ ] **Step 2: Run the minimal-config test**

Run: `cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && .venv/bin/pytest agent/tests/test_sdk_code_generator.py::test_minimal_config_swml_parity -v`
Expected: PASS — minimal config (no SWAIG functions, no DataSphere) produces SWML matching the live agent's. If it fails, the assertion error diff identifies which prompt/post-prompt/language detail is still drifting; fix and rerun.

- [ ] **Step 3: Commit**

```bash
git add agent/main.py
git commit -m "feat(agent-code): mirror live __init__ flow in generator"
```

---

## Task 4: Add `transfer_to_human` template

**Files:**
- Modify: `agent/sdk_code_templates.py`
- Modify: `agent/tests/test_sdk_code_generator.py`

- [ ] **Step 1: Add the failing test**

Append to `agent/tests/test_sdk_code_generator.py`:

```python
def test_transfer_to_human_swml_parity(tmp_path):
    config = _minimal_config()
    config["enabled_functions"] = ["transfer_to_human"]
    config["transfer_number"] = "+15551112222"
    config["phone_number"] = "+15554443333"

    code = _generate_sdk_code(config)
    module = _load_generated_module(code, tmp_path)
    gen_agent = _find_first_class(module)()
    gen_swml = gen_agent._render_swml()

    live_agent = VirtualEmployeeAgent("test-transfer", config)
    live_swml = live_agent._render_swml()

    assert _normalize_swml(gen_swml) == _normalize_swml(live_swml)
```

- [ ] **Step 2: Run the failing test**

Run: `cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && .venv/bin/pytest agent/tests/test_sdk_code_generator.py::test_transfer_to_human_swml_parity -v`
Expected: FAIL — generated SWML has no `transfer_to_human` SWAIG function (template not registered).

- [ ] **Step 3: Add the template**

Append to `agent/sdk_code_templates.py`:

```python
def _build_transfer_to_human(employee_config: dict) -> tuple[str, dict[str, str]]:
    method = '''    @AgentBase.tool(
        name="transfer_to_human",
        description="Transfer the call to a human representative at a real phone number",
        parameters={
            "type": "object",
            "properties": {
                "department": {
                    "type": "string",
                    "description": "Department to transfer to (e.g. sales, support, general)"
                },
                "reason": {
                    "type": "string",
                    "description": "Brief reason for the transfer"
                }
            }
        }
    )
    def transfer_to_human(self, args, raw_data):
        """Transfer call to a configured phone number."""
        department = args.get("department", "general")
        reason = args.get("reason", "Requested human assistance")
        number = os.environ.get("HIREWIRE_TRANSFER_NUMBER", "")

        if not number:
            return SwaigFunctionResult(
                "I'm sorry, there's no transfer number configured right now. "
                "Let me take a message instead so someone can call you back."
            )

        result = SwaigFunctionResult(
            f"I'll connect you with our {department} team now. Please hold.",
            post_process=True,
        )
        from_addr = os.environ.get("HIREWIRE_TRANSFER_FROM") or os.environ.get("HIREWIRE_PHONE_NUMBER") or None
        result.connect(number, final=True, from_addr=from_addr)
        return result'''
    return method, {}


SWAIG_TEMPLATES["transfer_to_human"] = _build_transfer_to_human
```

- [ ] **Step 4: Run both tests**

Run: `cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && .venv/bin/pytest agent/tests/test_sdk_code_generator.py -v`
Expected: PASS for both `test_minimal_config_swml_parity` and `test_transfer_to_human_swml_parity`. SWAIG-function declarations (name, description, parameters) match live SWML.

- [ ] **Step 5: Commit**

```bash
git add agent/sdk_code_templates.py agent/tests/test_sdk_code_generator.py
git commit -m "feat(agent-code): emit real transfer_to_human handler"
```

---

## Task 5: Add `send_summary_sms` template (with `_clean_phone_number` helper)

**Files:**
- Modify: `agent/sdk_code_templates.py`
- Modify: `agent/tests/test_sdk_code_generator.py`

- [ ] **Step 1: Add the failing test**

Append:

```python
def test_send_summary_sms_swml_parity(tmp_path):
    config = _minimal_config()
    config["enabled_functions"] = ["send_summary_sms"]
    config["sms_from_number"] = "+15557778888"

    code = _generate_sdk_code(config)
    module = _load_generated_module(code, tmp_path)
    gen_agent = _find_first_class(module)()
    gen_swml = gen_agent._render_swml()

    live_agent = VirtualEmployeeAgent("test-sms", config)
    live_swml = live_agent._render_swml()

    assert _normalize_swml(gen_swml) == _normalize_swml(live_swml)
```

- [ ] **Step 2: Run the test (failing)**

Run: `.venv/bin/pytest agent/tests/test_sdk_code_generator.py::test_send_summary_sms_swml_parity -v`
Expected: FAIL — `send_summary_sms` not in generated SWML, plus the `Voice Interaction Guidelines` section will have an extra bullet on the live side (the SMS-offer guideline) since `send_summary_sms in enabled_functions` triggers it. The new test exercises BOTH the conditional guideline (already implemented in Task 3) and the missing tool.

- [ ] **Step 3: Add the template**

Append to `agent/sdk_code_templates.py`:

```python
def _build_send_summary_sms(employee_config: dict) -> tuple[str, dict[str, str]]:
    agent_name = employee_config.get("name", "Agent").replace('"', '\\"')
    method = f'''    @AgentBase.tool(
        name="send_summary_sms",
        description="Send an SMS text message to the caller's phone number. Can send call summaries, confirmations, follow-ups, or any custom message. Ask for their phone number first.",
        parameters={{
            "type": "object",
            "properties": {{
                "phone_number": {{
                    "type": "string",
                    "description": "The caller's phone number to send the SMS to (E.164 format)"
                }},
                "message": {{
                    "type": "string",
                    "description": "The text message to send — can be a call summary, confirmation, or any relevant message"
                }},
                "caller_info": {{
                    "type": "string",
                    "description": "Caller name and contact info if provided"
                }}
            }},
            "required": ["phone_number", "message"]
        }}
    )
    def send_summary_sms(self, args, raw_data):
        """Send an SMS with the call summary to a number the caller provided."""
        phone_number_raw = args.get("phone_number", "")
        message = args.get("message", "") or args.get("summary", "No message provided")
        caller_info = args.get("caller_info", "")
        from_number = os.environ.get("HIREWIRE_SMS_FROM_NUMBER", "")

        phone_number = self._clean_phone_number(phone_number_raw)

        if not phone_number or len(phone_number) < 10:
            return SwaigFunctionResult(
                "I need a valid phone number to send the summary. Could you please provide your full phone number including area code?"
            )

        if not from_number:
            return SwaigFunctionResult(
                "I'm sorry, text messaging is not set up for this agent right now. I've noted the summary for our team."
            )

        max_message_len = 300
        if len(message) > max_message_len:
            message = message[:max_message_len] + "..."
        parts = [f"[SignalWire] {agent_name} Call Summary:"]
        if caller_info:
            parts.append(f"Caller: {{caller_info}}")
        parts.append(message)
        parts.append("REPLY STOP TO STOP")
        body = "\\n".join(parts)

        try:
            result = SwaigFunctionResult(f"I've sent a text summary to {{phone_number_raw}}.")
            result.send_sms(phone_number, from_number, body)
            return result
        except Exception:
            return SwaigFunctionResult(
                "I'm sorry, I wasn't able to send the text message right now. I've noted the summary for our team instead."
            )'''

    helper = '''    @staticmethod
    def _clean_phone_number(number: str) -> str:
        """Sanitize phone number to E.164 format — strip hyphens, spaces, parens."""
        import re
        if not number:
            return ""
        cleaned = re.sub(r'[^\\d+]', '', number)
        if cleaned and not cleaned.startswith('+'):
            cleaned = '+' + cleaned
        return cleaned'''

    return method, {"_clean_phone_number": helper}


SWAIG_TEMPLATES["send_summary_sms"] = _build_send_summary_sms
```

Note: the `agent_name` is interpolated at GENERATION time as a Python literal in the f-string template's `parts` list, while `caller_info` is interpolated at the GENERATED-CODE's runtime via `{{caller_info}}` (escaped braces in the outer f-string). Likewise `phone_number_raw`.

- [ ] **Step 4: Run all tests**

Run: `.venv/bin/pytest agent/tests/test_sdk_code_generator.py -v`
Expected: PASS for all three tests (minimal, transfer, sms).

- [ ] **Step 5: Commit**

```bash
git add agent/sdk_code_templates.py agent/tests/test_sdk_code_generator.py
git commit -m "feat(agent-code): emit send_summary_sms handler with phone helper"
```

---

## Task 6: Add `schedule_callback` template

**Files:**
- Modify: `agent/sdk_code_templates.py`
- Modify: `agent/tests/test_sdk_code_generator.py`

- [ ] **Step 1: Add failing test**

Append:

```python
def test_schedule_callback_swml_parity(tmp_path):
    config = _minimal_config()
    config["enabled_functions"] = ["schedule_callback"]

    code = _generate_sdk_code(config)
    module = _load_generated_module(code, tmp_path)
    gen_agent = _find_first_class(module)()
    gen_swml = gen_agent._render_swml()

    live_agent = VirtualEmployeeAgent("test-cb", config)
    live_swml = live_agent._render_swml()

    assert _normalize_swml(gen_swml) == _normalize_swml(live_swml)
```

- [ ] **Step 2: Run (failing)**

Run: `.venv/bin/pytest agent/tests/test_sdk_code_generator.py::test_schedule_callback_swml_parity -v`
Expected: FAIL.

- [ ] **Step 3: Add template**

Append to `agent/sdk_code_templates.py`:

```python
def _build_schedule_callback(employee_config: dict) -> tuple[str, dict[str, str]]:
    method = '''    @AgentBase.tool(
        name="schedule_callback",
        description="Schedule a PHONE CALLBACK for later. Collects name, number, preferred time, and reason. This is NOT for sending text messages — use send_summary_sms for that.",
        parameters={
            "type": "object",
            "properties": {
                "caller_name": {
                    "type": "string",
                    "description": "The caller's name"
                },
                "callback_number": {
                    "type": "string",
                    "description": "Phone number to call back"
                },
                "preferred_time": {
                    "type": "string",
                    "description": "When the caller would like to be called back"
                },
                "reason": {
                    "type": "string",
                    "description": "Reason for the callback"
                }
            },
            "required": ["caller_name", "callback_number", "preferred_time"]
        }
    )
    def schedule_callback(self, args, raw_data):
        """Collect callback request details and store them on global_data."""
        caller_name = args.get("caller_name", "")
        callback_number = args.get("callback_number", "")
        preferred_time = args.get("preferred_time", "")
        reason = args.get("reason", "")

        result = SwaigFunctionResult(
            f"I've scheduled a callback for {caller_name} at {preferred_time}. "
            "Someone from our team will reach out to you then."
        )
        result.update_global_data({
            "callback": {
                "name": caller_name,
                "number": callback_number,
                "time": preferred_time,
                "reason": reason[:100],
            }
        })
        return result'''
    return method, {}


SWAIG_TEMPLATES["schedule_callback"] = _build_schedule_callback
```

- [ ] **Step 4: Run all tests**

Run: `.venv/bin/pytest agent/tests/test_sdk_code_generator.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add agent/sdk_code_templates.py agent/tests/test_sdk_code_generator.py
git commit -m "feat(agent-code): emit schedule_callback handler"
```

---

## Task 7: Add `check_business_hours` template

**Files:**
- Modify: `agent/sdk_code_templates.py`
- Modify: `agent/tests/test_sdk_code_generator.py`

- [ ] **Step 1: Add failing test**

Append:

```python
def test_check_business_hours_swml_parity(tmp_path):
    config = _minimal_config()
    config["enabled_functions"] = ["check_business_hours"]
    config["business_hours_start"] = 8
    config["business_hours_end"] = 17
    config["business_days"] = [0, 1, 2, 3, 4, 5]

    code = _generate_sdk_code(config)
    module = _load_generated_module(code, tmp_path)
    gen_agent = _find_first_class(module)()
    gen_swml = gen_agent._render_swml()

    live_agent = VirtualEmployeeAgent("test-bh", config)
    live_swml = live_agent._render_swml()

    assert _normalize_swml(gen_swml) == _normalize_swml(live_swml)
```

- [ ] **Step 2: Run (failing)**

Run: `.venv/bin/pytest agent/tests/test_sdk_code_generator.py::test_check_business_hours_swml_parity -v`
Expected: FAIL.

- [ ] **Step 3: Add template**

Append to `agent/sdk_code_templates.py`:

```python
def _build_check_business_hours(employee_config: dict) -> tuple[str, dict[str, str]]:
    start = employee_config.get("business_hours_start", 9)
    end = employee_config.get("business_hours_end", 18)
    days = employee_config.get("business_days", [0, 1, 2, 3, 4])
    import json as _json
    days_literal = _json.dumps(days)

    method = f'''    @AgentBase.tool(
        name="check_business_hours",
        description="Check if the business is currently open and provide hours information",
        parameters={{
            "type": "object",
            "properties": {{}}
        }}
    )
    def check_business_hours(self, args, raw_data):
        """Return business hours — uses inlined config values."""
        from datetime import datetime
        now = datetime.now()
        hour = now.hour
        weekday = now.weekday()

        start = {start}
        end = {end}
        days = {days_literal}

        day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        open_days = [day_names[d] for d in sorted(days)]
        hours_str = f"{{start % 12 or 12}} {{'AM' if start < 12 else 'PM'}} to {{end % 12 or 12}} {{'AM' if end < 12 else 'PM'}}"

        if weekday in days and start <= hour < end:
            return SwaigFunctionResult(
                f"We are currently open. Our business hours are {{open_days[0]}} through {{open_days[-1]}}, {{hours_str}}."
            )
        else:
            return SwaigFunctionResult(
                f"We are currently closed. Our business hours are {{open_days[0]}} through {{open_days[-1]}}, {{hours_str}}. "
                "I can take a message or schedule a callback for when we reopen."
            )'''
    return method, {}


SWAIG_TEMPLATES["check_business_hours"] = _build_check_business_hours
```

- [ ] **Step 4: Run all tests**

Run: `.venv/bin/pytest agent/tests/test_sdk_code_generator.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add agent/sdk_code_templates.py agent/tests/test_sdk_code_generator.py
git commit -m "feat(agent-code): emit check_business_hours handler"
```

---

## Task 8: Add `collect_customer_info` template

**Files:**
- Modify: `agent/sdk_code_templates.py`
- Modify: `agent/tests/test_sdk_code_generator.py`

- [ ] **Step 1: Add failing test**

Append:

```python
def test_collect_customer_info_swml_parity(tmp_path):
    config = _minimal_config()
    config["enabled_functions"] = ["collect_customer_info"]

    code = _generate_sdk_code(config)
    module = _load_generated_module(code, tmp_path)
    gen_agent = _find_first_class(module)()
    gen_swml = gen_agent._render_swml()

    live_agent = VirtualEmployeeAgent("test-cci", config)
    live_swml = live_agent._render_swml()

    assert _normalize_swml(gen_swml) == _normalize_swml(live_swml)
```

- [ ] **Step 2: Run (failing)**

Run: `.venv/bin/pytest agent/tests/test_sdk_code_generator.py::test_collect_customer_info_swml_parity -v`
Expected: FAIL.

- [ ] **Step 3: Add template**

Append to `agent/sdk_code_templates.py`:

```python
def _build_collect_customer_info(employee_config: dict) -> tuple[str, dict[str, str]]:
    method = '''    @AgentBase.tool(
        name="collect_customer_info",
        description="Collect structured customer information during the call. Gather details conversationally — name, email, phone, company, and any notes. Call this once you have collected the relevant details.",
        parameters={
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "The customer's full name"
                },
                "email": {
                    "type": "string",
                    "description": "The customer's email address"
                },
                "phone": {
                    "type": "string",
                    "description": "The customer's phone number"
                },
                "company": {
                    "type": "string",
                    "description": "The customer's company or organization"
                },
                "notes": {
                    "type": "string",
                    "description": "Any additional notes or context from the conversation"
                }
            }
        }
    )
    def collect_customer_info(self, args, raw_data):
        """Collect and store structured customer information on global_data."""
        name = args.get("name", "")
        email = args.get("email", "")
        phone = args.get("phone", "")
        company = args.get("company", "")
        notes = args.get("notes", "")

        result = SwaigFunctionResult(
            f"Got it, I've recorded {'your' if name else 'the'} information. Is there anything else I can help with?"
        )
        result.update_global_data({
            "customer_info": {
                "name": name,
                "email": email,
                "phone": phone,
                "company": company,
                "notes": notes[:500],
            }
        })
        return result'''
    return method, {}


SWAIG_TEMPLATES["collect_customer_info"] = _build_collect_customer_info
```

- [ ] **Step 4: Run all tests**

Run: `.venv/bin/pytest agent/tests/test_sdk_code_generator.py -v`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add agent/sdk_code_templates.py agent/tests/test_sdk_code_generator.py
git commit -m "feat(agent-code): emit collect_customer_info handler"
```

---

## Task 9: Add `send_email` template

**Files:**
- Modify: `agent/sdk_code_templates.py`
- Modify: `agent/tests/test_sdk_code_generator.py`

- [ ] **Step 1: Add failing test**

Append:

```python
def test_send_email_swml_parity(tmp_path):
    config = _minimal_config()
    config["enabled_functions"] = ["send_email"]
    config["sendgrid_api_key"] = "SG.test"
    config["email_from_address"] = "noreply@example.com"
    config["email_from_name"] = "Test"

    code = _generate_sdk_code(config)
    module = _load_generated_module(code, tmp_path)
    gen_agent = _find_first_class(module)()
    gen_swml = gen_agent._render_swml()

    live_agent = VirtualEmployeeAgent("test-email", config)
    live_swml = live_agent._render_swml()

    assert _normalize_swml(gen_swml) == _normalize_swml(live_swml)
```

- [ ] **Step 2: Run (failing)**

Run: `.venv/bin/pytest agent/tests/test_sdk_code_generator.py::test_send_email_swml_parity -v`
Expected: FAIL.

- [ ] **Step 3: Add template**

Append to `agent/sdk_code_templates.py`:

```python
def _build_send_email(employee_config: dict) -> tuple[str, dict[str, str]]:
    default_from_name = employee_config.get("email_from_name") or employee_config.get("name", "Agent")
    safe_default_from_name = default_from_name.replace('"', '\\"')

    method = f'''    @AgentBase.tool(
        name="send_email",
        description="Send a follow-up email to the caller. Collects their email address and sends a message with call details, confirmations, or any relevant information.",
        parameters={{
            "type": "object",
            "properties": {{
                "to_email": {{
                    "type": "string",
                    "description": "The recipient's email address"
                }},
                "subject": {{
                    "type": "string",
                    "description": "Email subject line"
                }},
                "body": {{
                    "type": "string",
                    "description": "Email body content — include call summary, action items, or relevant details"
                }}
            }},
            "required": ["to_email", "subject", "body"]
        }}
    )
    def send_email(self, args, raw_data):
        """Send an email via SendGrid (requires `pip install sendgrid`)."""
        to_email = args.get("to_email", "")
        subject = args.get("subject", "")
        body = args.get("body", "")

        sendgrid_api_key = os.environ.get("SENDGRID_API_KEY", "")
        from_email = os.environ.get("HIREWIRE_EMAIL_FROM_ADDRESS", "")
        from_name = os.environ.get("HIREWIRE_EMAIL_FROM_NAME", "") or "{safe_default_from_name}"

        if not to_email or "@" not in to_email:
            return SwaigFunctionResult(
                "I need a valid email address to send to. Could you please provide your email?"
            )

        if not sendgrid_api_key or not from_email:
            result = SwaigFunctionResult(
                "Email isn't set up for this agent yet. Let me take a note of your request instead."
            )
            result.update_global_data({{
                "email_requested": {{
                    "to": to_email,
                    "subject": subject,
                    "body": body[:500],
                    "status": "not_configured",
                }}
            }})
            return result

        try:
            from sendgrid import SendGridAPIClient
            from sendgrid.helpers.mail import Mail

            message = Mail(
                from_email=(from_email, from_name),
                to_emails=to_email,
                subject=subject or f"Follow-up from {{from_name}}",
                plain_text_content=body,
            )
            sg = SendGridAPIClient(sendgrid_api_key)
            response = sg.send(message)

            result = SwaigFunctionResult(f"I've sent an email to {{to_email}}.")
            result.update_global_data({{
                "email_sent": {{
                    "to": to_email,
                    "subject": subject,
                    "status": "sent",
                    "status_code": response.status_code,
                }}
            }})
            return result
        except Exception as e:
            result = SwaigFunctionResult(
                "I'm sorry, I wasn't able to send the email right now. I've noted your request for our team."
            )
            result.update_global_data({{
                "email_requested": {{
                    "to": to_email,
                    "subject": subject,
                    "body": body[:500],
                    "status": "failed",
                    "error": str(e)[:200],
                }}
            }})
            return result'''
    return method, {}


SWAIG_TEMPLATES["send_email"] = _build_send_email
```

- [ ] **Step 4: Run all tests**

Run: `.venv/bin/pytest agent/tests/test_sdk_code_generator.py -v`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add agent/sdk_code_templates.py agent/tests/test_sdk_code_generator.py
git commit -m "feat(agent-code): emit send_email handler"
```

---

## Task 10: Implement `datasphere_block` for `search_knowledge`

**Files:**
- Modify: `agent/sdk_code_templates.py`
- Modify: `agent/tests/test_sdk_code_generator.py`

- [ ] **Step 1: Add failing test (single doc + multi-doc)**

Append:

```python
def test_datasphere_single_doc_swml_parity(tmp_path, monkeypatch):
    monkeypatch.setenv("SIGNALWIRE_SPACE", "test.signalwire.com")
    monkeypatch.setenv("SIGNALWIRE_PROJECT_ID", "proj-1")
    monkeypatch.setenv("SIGNALWIRE_TOKEN", "tok-1")

    config = _minimal_config()
    config["enabled_functions"] = ["search_knowledge"]
    config["documents"] = [
        {"document_id": "doc-aaa", "name": "Handbook", "description": "Company handbook", "distance": 3.0},
    ]

    code = _generate_sdk_code(config)
    module = _load_generated_module(code, tmp_path)
    gen_agent = _find_first_class(module)()
    gen_swml = gen_agent._render_swml()

    live_agent = VirtualEmployeeAgent("test-ds1", config)
    live_swml = live_agent._render_swml()

    assert _normalize_swml(gen_swml) == _normalize_swml(live_swml)


def test_datasphere_multi_doc_swml_parity(tmp_path, monkeypatch):
    monkeypatch.setenv("SIGNALWIRE_SPACE", "test.signalwire.com")
    monkeypatch.setenv("SIGNALWIRE_PROJECT_ID", "proj-1")
    monkeypatch.setenv("SIGNALWIRE_TOKEN", "tok-1")

    config = _minimal_config()
    config["enabled_functions"] = ["search_knowledge"]
    config["documents"] = [
        {"document_id": "doc-aaa", "name": "Handbook", "description": "Company handbook", "distance": 3.0},
        {"document_id": "doc-bbb", "name": "Pricing", "description": "Pricing FAQ", "distance": 2.5},
    ]

    code = _generate_sdk_code(config)
    module = _load_generated_module(code, tmp_path)
    gen_agent = _find_first_class(module)()
    gen_swml = gen_agent._render_swml()

    live_agent = VirtualEmployeeAgent("test-ds2", config)
    live_swml = live_agent._render_swml()

    assert _normalize_swml(gen_swml) == _normalize_swml(live_swml)
```

- [ ] **Step 2: Run (failing)**

Run: `.venv/bin/pytest agent/tests/test_sdk_code_generator.py::test_datasphere_single_doc_swml_parity -v`
Expected: FAIL — generator doesn't emit `add_skill(...)` yet.

- [ ] **Step 3: Implement `datasphere_block`**

Replace the `datasphere_block` stub in `agent/sdk_code_templates.py` with:

```python
def datasphere_block(employee_config: dict) -> str:
    """Emit `self.add_skill("datasphere_serverless", {...})` calls + optional
    Knowledge Base Routing pom-section. Returns "" if not applicable.

    Mirrors VirtualEmployeeAgent._configure_functions lines 247-273.
    """
    enabled = employee_config.get("enabled_functions") or []
    if "search_knowledge" not in enabled:
        return ""
    documents = employee_config.get("documents") or []
    if not documents:
        return "        # search_knowledge enabled but no documents configured\n"

    import hashlib
    import json as _json

    lines: list[str] = []
    routing_descriptions: list[str] = []

    for doc in documents:
        if isinstance(doc, dict):
            doc_id = doc.get("document_id", "")
            doc_name = doc.get("name", doc_id[:8])
            doc_desc = doc.get("description", "")
            doc_distance = doc.get("distance", 3.0)
        else:
            doc_id = doc
            doc_name = doc_id[:8]
            doc_desc = ""
            doc_distance = 3.0

        if not doc_id:
            continue

        doc_hash = hashlib.md5(str(doc_id).encode()).hexdigest()[:6]
        safe_name = doc_name.lower().replace(" ", "_").replace("-", "_")[:20]
        tool_name = f"search_{safe_name}_{doc_hash}"
        description_text = doc_desc or f"Search the {doc_name} knowledge base"

        skill_block = (
            '        self.add_skill("datasphere_serverless", {\n'
            '            "space_name": os.environ["SIGNALWIRE_SPACE"],\n'
            '            "project_id": os.environ["SIGNALWIRE_PROJECT_ID"],\n'
            '            "token": os.environ["SIGNALWIRE_TOKEN"],\n'
            f'            "document_id": {_json.dumps(doc_id)},\n'
            '            "count": 3,\n'
            f'            "distance": {doc_distance},\n'
            f'            "tool_name": {_json.dumps(tool_name)},\n'
            f'            "description": {_json.dumps(description_text)},\n'
            '            "swaig_fields": {\n'
            '                "fillers": {\n'
            '                    "en-US": [\n'
            '                        "Let me check our documentation...",\n'
            '                        "Searching our knowledge base...",\n'
            '                        "Looking that up for you...",\n'
            '                    ]\n'
            '                }\n'
            '            },\n'
            '        })'
        )
        lines.append(skill_block)
        routing_descriptions.append(f"- {tool_name}: {description_text}")

    if len(routing_descriptions) > 1:
        routing = "You have access to these knowledge bases:\\n" + "\\n".join(routing_descriptions)
        routing += "\\nChoose the most relevant one based on the caller's question."
        lines.append(
            f'        self.add_pom_section("Knowledge Base Routing", body={_json.dumps(routing)})'
        )

    return "\n".join(lines) + "\n"
```

- [ ] **Step 4: Run all tests**

Run: `.venv/bin/pytest agent/tests/test_sdk_code_generator.py -v`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add agent/sdk_code_templates.py agent/tests/test_sdk_code_generator.py
git commit -m "feat(agent-code): emit DataSphere skill registration for search_knowledge"
```

---

## Task 11: Implement `env_var_header`

**Files:**
- Modify: `agent/sdk_code_templates.py`
- Modify: `agent/tests/test_sdk_code_generator.py`

This task does not affect SWML parity (the header is a docstring above `import os`). Test asserts content rather than parity.

- [ ] **Step 1: Add header content tests**

Append:

```python
def test_env_var_header_lists_only_used_vars(tmp_path):
    config = _minimal_config()
    config["enabled_functions"] = ["transfer_to_human"]
    config["transfer_number"] = "+15551112222"

    code = _generate_sdk_code(config)

    assert "HIREWIRE_TRANSFER_NUMBER" in code
    # Not enabled: SMS, email, SignalWire creds
    assert "HIREWIRE_SMS_FROM_NUMBER" not in code
    assert "SENDGRID_API_KEY" not in code
    assert "SIGNALWIRE_TOKEN" not in code


def test_env_var_header_includes_signalwire_creds_for_datasphere(tmp_path, monkeypatch):
    monkeypatch.setenv("SIGNALWIRE_SPACE", "test.signalwire.com")
    monkeypatch.setenv("SIGNALWIRE_PROJECT_ID", "proj-1")
    monkeypatch.setenv("SIGNALWIRE_TOKEN", "tok-1")

    config = _minimal_config()
    config["enabled_functions"] = ["search_knowledge"]
    config["documents"] = [{"document_id": "doc-aaa", "name": "Handbook"}]

    code = _generate_sdk_code(config)
    assert "SIGNALWIRE_SPACE" in code
    assert "SIGNALWIRE_PROJECT_ID" in code
    assert "SIGNALWIRE_TOKEN" in code


def test_env_var_header_surfaces_user_config_values_as_comments(tmp_path):
    config = _minimal_config()
    config["enabled_functions"] = ["transfer_to_human"]
    config["transfer_number"] = "+15551112222"

    code = _generate_sdk_code(config)
    assert "+15551112222" in code  # surfaced as comment for the copier
```

- [ ] **Step 2: Run the failing tests**

Run: `.venv/bin/pytest agent/tests/test_sdk_code_generator.py::test_env_var_header_lists_only_used_vars -v`
Expected: FAIL — header is currently empty stub.

- [ ] **Step 3: Implement `env_var_header`**

Replace the stub:

```python
def env_var_header(employee_config: dict, enabled_functions: list[str]) -> str:
    """Top-of-file docstring listing required env vars + quickstart.

    Includes SignalWire creds only if `search_knowledge` is enabled with docs.
    Surfaces user-config values (transfer_number, sms_from_number, etc.) as
    inline comments so the copier sees what HireWire had configured. API
    tokens are never surfaced.
    """
    name = employee_config.get("name", "Employee")
    role = employee_config.get("role", "Virtual Assistant")
    employee_id = employee_config.get("id", "employee")

    rows: list[str] = []

    if "search_knowledge" in enabled_functions and (employee_config.get("documents") or []):
        rows.append("  SIGNALWIRE_SPACE          — your SignalWire space (e.g. example.signalwire.com)")
        rows.append("  SIGNALWIRE_PROJECT_ID     — your SignalWire project ID")
        rows.append("  SIGNALWIRE_TOKEN          — your SignalWire API token (do NOT commit)")

    if "transfer_to_human" in enabled_functions:
        cur = employee_config.get("transfer_number", "")
        rows.append(f"  HIREWIRE_TRANSFER_NUMBER  — number to transfer callers to{(' (HireWire had: ' + cur + ')') if cur else ''}")
        cur_from = employee_config.get("transfer_from") or employee_config.get("phone_number", "")
        if cur_from:
            rows.append(f"  HIREWIRE_TRANSFER_FROM    — caller-ID for transfer (HireWire had: {cur_from})")
        else:
            rows.append("  HIREWIRE_TRANSFER_FROM    — caller-ID for transfer (optional)")

    if "send_summary_sms" in enabled_functions:
        cur = employee_config.get("sms_from_number", "")
        rows.append(f"  HIREWIRE_SMS_FROM_NUMBER  — SMS sender number{(' (HireWire had: ' + cur + ')') if cur else ''}")

    if "send_email" in enabled_functions:
        cur_addr = employee_config.get("email_from_address", "")
        cur_nm = employee_config.get("email_from_name", "")
        rows.append("  SENDGRID_API_KEY          — your SendGrid API key (do NOT commit)")
        rows.append(f"  HIREWIRE_EMAIL_FROM_ADDRESS — sender email{(' (HireWire had: ' + cur_addr + ')') if cur_addr else ''}")
        if cur_nm:
            rows.append(f"  HIREWIRE_EMAIL_FROM_NAME  — sender display name (HireWire had: {cur_nm})")
        else:
            rows.append("  HIREWIRE_EMAIL_FROM_NAME  — sender display name (optional)")

    env_section = (
        "\nRequired environment variables:\n" + "\n".join(rows) + "\n"
    ) if rows else ""

    return (
        '"""\n'
        f"{name} ({role})\n\n"
        "Generated agent code from HireWire-AI. When run, this file serves SWML at\n"
        f"http://localhost:3000/swml/{employee_id} whose schema matches the live HireWire\n"
        "agent's SWML for this employee."
        f"{env_section}"
        "\nQuickstart:\n"
        "  pip install signalwire-agents\n"
        "  # set required env vars above\n"
        f"  python {employee_id}.py\n"
        '"""'
    )
```

- [ ] **Step 4: Run all tests**

Run: `.venv/bin/pytest agent/tests/test_sdk_code_generator.py -v`
Expected: 12 passed.

- [ ] **Step 5: Commit**

```bash
git add agent/sdk_code_templates.py agent/tests/test_sdk_code_generator.py
git commit -m "feat(agent-code): build dynamic env-var header for generated file"
```

---

## Task 12: All-functions integration test + unknown-function warning

**Files:**
- Modify: `agent/tests/test_sdk_code_generator.py`

This is the final integration check: every function enabled simultaneously, plus DataSphere with two docs. Also verifies unknown function ids produce warning comments without crashing.

- [ ] **Step 1: Add the integration test + unknown-function test**

Append:

```python
def test_full_config_swml_parity(tmp_path, monkeypatch):
    monkeypatch.setenv("SIGNALWIRE_SPACE", "test.signalwire.com")
    monkeypatch.setenv("SIGNALWIRE_PROJECT_ID", "proj-1")
    monkeypatch.setenv("SIGNALWIRE_TOKEN", "tok-1")

    config = _minimal_config()
    config["enabled_functions"] = [
        "transfer_to_human", "send_summary_sms", "schedule_callback",
        "check_business_hours", "collect_customer_info", "send_email",
        "search_knowledge",
    ]
    config["transfer_number"] = "+15551112222"
    config["sms_from_number"] = "+15553334444"
    config["sendgrid_api_key"] = "SG.test"
    config["email_from_address"] = "noreply@example.com"
    config["business_hours_start"] = 8
    config["business_hours_end"] = 18
    config["business_days"] = [0, 1, 2, 3, 4]
    config["documents"] = [
        {"document_id": "doc-aaa", "name": "Handbook", "description": "Handbook", "distance": 3.0},
        {"document_id": "doc-bbb", "name": "Pricing", "description": "Pricing", "distance": 2.5},
    ]

    code = _generate_sdk_code(config)
    module = _load_generated_module(code, tmp_path)
    gen_agent = _find_first_class(module)()
    gen_swml = gen_agent._render_swml()

    live_agent = VirtualEmployeeAgent("test-full", config)
    live_swml = live_agent._render_swml()

    assert _normalize_swml(gen_swml) == _normalize_swml(live_swml)


def test_unknown_function_emits_warning_no_crash(tmp_path):
    config = _minimal_config()
    config["enabled_functions"] = ["transfer_to_human", "set_identity"]  # set_identity is wizard-only
    config["transfer_number"] = "+15551112222"

    code = _generate_sdk_code(config)
    assert "WARN: skipped unknown function 'set_identity'" in code
    # Must still load and render SWML
    module = _load_generated_module(code, tmp_path)
    gen_agent = _find_first_class(module)()
    swml = gen_agent._render_swml()
    assert "transfer_to_human" in swml
    assert "set_identity" not in swml
```

- [ ] **Step 2: Run all tests**

Run: `cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && .venv/bin/pytest agent/tests/test_sdk_code_generator.py -v`
Expected: 14 passed. If full-config fails, the assertion diff identifies whether ordering of `add_skill` calls vs `set_post_prompt` matters or another sequencing detail differs from live.

- [ ] **Step 3: Sanity-check by hitting the live endpoint locally**

Run (in a separate terminal): `cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && uvicorn agent.main:app --port 8000` (background)

Then: `curl -s http://localhost:8000/agent-code/<some-existing-employee-id> | head -50`

Expected: Generated Python preview shows the new env-var header, three prompt sections, real handler decorators, DataSphere skill block (if enabled), and a clean `if __name__ == "__main__":` footer.

Stop the uvicorn process.

- [ ] **Step 4: Commit**

```bash
git add agent/tests/test_sdk_code_generator.py
git commit -m "test(agent-code): full-config parity + unknown-function warning"
```

---

## Task 13: Update memory + spec status

**Files:**
- Modify: spec front-matter (mark status as Implemented)
- Update memory: clear `project_hirewire_pending.md` SDK-generator section

- [ ] **Step 1: Update spec status**

Edit `docs/superpowers/specs/2026-05-07-sdk-code-generator-deeper-pass-design.md`, change `**Status:** Design approved, pending plan` to `**Status:** Implemented`.

- [ ] **Step 2: Update memory file**

Edit `/Users/jonny/.claude/projects/-Users-jonny-Library-Mobile-Documents-com-apple-CloudDocs-CLOUD-CLAUDE/memory/project_hirewire_pending.md` — remove the "Deeper SDK-code generator improvements" section (Task 2). Keep call-log UI redesign as the remaining open item.

- [ ] **Step 3: Final test run + commit**

Run: `.venv/bin/pytest agent/tests/ -v`
Expected: all green.

```bash
git add docs/superpowers/specs/2026-05-07-sdk-code-generator-deeper-pass-design.md
git commit -m "docs: mark sdk code generator spec as implemented"
```

---

## Self-Review Notes

- **Spec coverage:** Goals 1–5 covered. Goal 1 (SWML parity) covered by every parity test in Tasks 3–10, 12. Goal 2 (every SWAIG function present with same signature) covered per-function in Tasks 4–9. Goal 3 (real handler bodies + env vars) is the body of Tasks 4–9. Goal 4 (DataSphere) covered in Task 10. Goal 5 (CI guard) covered by `[tool.pytest.ini_options]` config in Task 1 and the test suite itself.
- **Open questions resolution:**
  1. SDK render API: confirmed `agent._render_swml()` exists and returns a string.
  2. `send_email` env vars: confirmed via reading lines 584–657 — uses SendGrid, not SMTP.
  3. CI wiring: spec said this could be a separate follow-up. The `[tool.pytest.ini_options]` config is added in Task 1; actual CI workflow (e.g. GitHub Actions) is left as a follow-up because the repo's CI setup is not in scope for this plan.
- **Placeholder scan:** No "TBD"/"TODO"/"appropriate error handling" patterns. Every step has concrete code or a concrete command.
- **Type consistency:** `SWAIG_TEMPLATES` builder signature `(dict) -> tuple[str, dict[str, str]]` is consistent across all builders. `datasphere_block(dict) -> str`, `env_var_header(dict, list[str]) -> str` consistent across declaration in Task 2 and implementations in Tasks 10, 11.
- **Drift insurance:** If `VirtualEmployeeAgent.__init__` changes a prompt section name or adds a new tool decorator without a corresponding template update, Tasks 3 and 12's parity tests will fail loudly. The handler-body drift (e.g. someone changes the response string in live `transfer_to_human`) is NOT caught — body changes only affect runtime, not SWML, which is the acceptable trade-off the spec called out.
