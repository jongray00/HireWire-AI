# SDK Code Generator — Deeper Pass

**Date:** 2026-05-07
**Status:** Implemented
**Owner:** HireWire-AI

## Background

`/agent-code/{employee_id}` returns runnable Python that mirrors how the live agent is built. The first-pass generator (`_generate_sdk_code` at `agent/main.py:1519`) emits the right shape — `AgentBase` subclass, `add_language`, `prompt_add_section`, `set_post_prompt` — but declares enabled functions as an inert list (`self._enabled_functions = [...]`) instead of registering real `@AgentBase.tool` handlers. Result: running the generated file does not produce SWML matching the live `/swml/{employee_id}`, because the SWAIG section is empty.

Goal of this pass: when a developer copies the generated file and runs it in their own environment with appropriate env vars set, the route serves SWML schema-equivalent to the live agent's SWML.

## Goals

1. Generated `python <employee_id>.py` boots an SDK agent that serves SWML at `/swml/<employee_id>` whose schema content matches the live HireWire `/swml/<employee_id>`. Webhook URL host will differ (copier's host vs HireWire's); all other content must match.
2. Every SWAIG function the live agent exposes for this employee is present in the generated file with the same name, description, and parameters.
3. Handler bodies are real implementations, not stubs. Per-environment values (transfer numbers, SMS from-number, email SMTP creds, SignalWire credentials for DataSphere) are read from environment variables; current HireWire-stored values are surfaced as comments for the copier's reference.
4. DataSphere `search_knowledge` is correctly emitted via `self.add_skill("datasphere_serverless", {...})` when enabled, with the same `tool_name` hash and routing pom-section that the live agent registers.
5. The generator is guarded by an automated SWML-parity test that fails CI when any drift is introduced.

## Non-Goals

- Adding authentication/authorization to `/agent-code/{employee_id}`. Currently unauthenticated; that's a separate follow-up.
- Emitting wizard agent SWAIG tools (`set_identity`, `list_voices`, `set_voice`, `set_capabilities`, `update_agent_preview`, `create_agent`, `finalize_agent`). Wizard is a separate code path.
- Supporting user-defined custom SWAIG functions. The product does not expose this.
- Reproducing the exact webhook URL host. The generated file serves on the copier's host; only schema content must match.
- Making the generated file depend on any HireWire module. Its only dependency is `signalwire-agents`.

## Module layout

New module `agent/sdk_code_templates.py` with three exports:

- `SWAIG_TEMPLATES: dict[str, Callable[[dict], str]]` — one builder per supported function id. Each builder takes the full `employee_config` dict and returns a code string containing the full `@AgentBase.tool(...)` decorator and method body.
- `datasphere_block(employee_config) -> str` — returns the `add_skill("datasphere_serverless", {...})` calls and the optional `add_pom_section("Knowledge Base Routing", ...)` call as a code string. Returns empty string if `search_knowledge` is not enabled or `documents` is empty.
- `env_var_header(employee_config, enabled_functions) -> str` — returns the top-of-file docstring listing required env vars, with current HireWire values surfaced as comments and a quickstart block.

`agent/main.py`:

- `_generate_sdk_code` rewritten to compose output from the new module:
  1. File header + docstring (`env_var_header`)
  2. `import os`, `from signalwire_agents import AgentBase, SwaigFunctionResult`
  3. Class declaration and `__init__` open
  4. `super().__init__(...)`, `add_language`, `set_param("temperature", ...)`, `set_param("greeting", ...)`
  5. `self.prompt_add_section("Identity and mission", """...""")`
  6. `datasphere_block(...)` if applicable
  7. For each id in `enabled_functions` (excluding `search_knowledge` and unknown ids), append `SWAIG_TEMPLATES[id](employee_config)`
  8. Unknown ids → emit `# WARN: skipped unknown function 'X'` comment, do not crash
  9. `self.set_post_prompt(...)` block (existing copy)
  10. Footer: `if __name__ == "__main__": <ClassName>().run()`
- `/agent-code/{employee_id}` endpoint signature and response unchanged.

## SWAIG handler templates

Six functions are supported (matching the live `VirtualEmployeeAgent` SWAIG tools at `agent/main.py:301`–`agent/main.py:584`). Each builder mirrors the corresponding live method body, with `self.employee_config.get("<key>")` references mechanically rewritten to `os.environ.get("HIREWIRE_<KEY>", "")`. Static employee config values (e.g. agent name in SMS body, business hours) are inlined as Python literals at generator time rather than read from env.

| Function id | Source lines (live) | Env vars |
|---|---|---|
| `transfer_to_human` | `agent/main.py:301`–`agent/main.py:340` | `HIREWIRE_TRANSFER_NUMBER`, `HIREWIRE_TRANSFER_FROM` |
| `send_summary_sms` | `agent/main.py:354`–`agent/main.py:420` | `HIREWIRE_SMS_FROM_NUMBER` |
| `schedule_callback` | `agent/main.py:422`–`agent/main.py:470` | (determined when reading live body during implementation) |
| `check_business_hours` | `agent/main.py:471`–`agent/main.py:502` | (none — hours inlined from config) |
| `collect_customer_info` | `agent/main.py:503`–`agent/main.py:560` | (none — fields inlined) |
| `send_email` | `agent/main.py:562`–`agent/main.py:?` | SMTP env vars (exact set determined by live body) |

Wizard-only tools at `agent/main.py:996`+ (`set_identity`, `list_voices`, `set_voice`, `set_capabilities`, `update_agent_preview`, `create_agent`, `finalize_agent`) are explicitly excluded — they belong to the wizard agent class and are not legal employee functions.

## DataSphere `search_knowledge`

When `enabled_functions` contains `search_knowledge` AND `documents` is non-empty:

- For each document in `employee_config["documents"]`, emit one `self.add_skill("datasphere_serverless", {...})` call mirroring the live logic at `agent/main.py:247`–`agent/main.py:265`.
- The `tool_name` field is computed in the generator (same `hashlib.md5(doc_id).hexdigest()[:6]` + safe-name logic) so the emitted name matches what the live agent registers.
- `space_name`, `project_id`, `token` are read from `os.environ["SIGNALWIRE_SPACE"]`, `os.environ["SIGNALWIRE_PROJECT_ID"]`, `os.environ["SIGNALWIRE_TOKEN"]` — no defaults, fail fast if missing.
- `document_id`, `count`, `distance`, `description`, `swaig_fields.fillers` are inlined as literals.
- If `len(documents) > 1`, also emit `self.add_pom_section("Knowledge Base Routing", body=...)` with the same routing text the live agent emits.

If `search_knowledge` is enabled but `documents` is empty, emit a comment block explaining that no documents were configured. Do not crash.

## Env-var header

Top of generated file:

```python
"""
{name} ({role})

Generated agent code from HireWire-AI. When run, this file serves SWML at
http://localhost:3000/swml/{employee_id} whose schema matches the live HireWire
agent's SWML for this employee.

Required environment variables:
  SIGNALWIRE_SPACE          — your SignalWire space (e.g. example.signalwire.com)
  SIGNALWIRE_PROJECT_ID     — your SignalWire project ID
  SIGNALWIRE_TOKEN          — your SignalWire API token
  HIREWIRE_TRANSFER_NUMBER  — number to transfer callers to
                              (HireWire had: +15551112222)
  HIREWIRE_SMS_FROM_NUMBER  — SMS sender number
                              (HireWire had: +15551113333)
  ...

Quickstart:
  pip install signalwire-agents
  export SIGNALWIRE_TOKEN=...
  python {employee_id}.py
"""
```

The list of env vars in the header is dynamically built from which builders are emitted. Only env vars actually used by the enabled functions are listed. SignalWire credentials are listed iff `search_knowledge` is enabled. SignalWire token is never inlined as a default value, even as a comment — only the placeholder description is shown.

User-config values (transfer_number, sms_from_number, etc.) ARE surfaced as comments. These are user-set values from the dashboard and the copier is presumed authorized to view them (since they obtained the file via `/agent-code/{employee_id}`). API tokens are NOT surfaced as comments.

## Verification

New test file: `agent/tests/test_sdk_code_generator.py`.

Pytest is added as a dev dependency in `pyproject.toml` under `[project.optional-dependencies.dev]`. A new `[tool.pytest.ini_options]` block sets `testpaths = ["agent/tests"]`.

### Test fixtures

Three `employee_config` fixtures, in-memory dicts:

1. **Minimal** — only `transfer_to_human` enabled, no DataSphere, basic prompt + greeting.
2. **All-functions** — all six SWAIG functions enabled, no DataSphere.
3. **Full** — all six SWAIG functions + `search_knowledge` with two documents, full prompt body.

### Test flow

For each fixture:

1. Generate code via `_generate_sdk_code(config)`, write to `tmp_path/generated.py`.
2. Use `importlib.util.spec_from_file_location` to import the generated module.
3. Instantiate the generated agent class.
4. Render its SWML by calling the SDK's render method. Exact API to be confirmed during plan phase by reading `signalwire-agents` SDK source — likely `agent.get_swml_response()` or similar non-network method. If no such method exists, fall back to standing up the FastAPI route in-process and issuing a request via `httpx`.
5. Construct `VirtualEmployeeAgent(employee_id, config)` and render its SWML the same way.
6. Normalize both SWML payloads:
   - Replace any absolute webhook URL host with relative path (`https://*/swaig` → `/swaig`).
   - Sort dict keys at every level if the SDK doesn't already produce a stable ordering.
7. Assert `generated_normalized == live_normalized`.

### Drift coverage

The test catches:

- A new `@AgentBase.tool` added to `VirtualEmployeeAgent` without a corresponding template.
- A change to an existing tool's `name`, `description`, or `parameters` schema not propagated to the generator.
- A change to the prompt section text, post-prompt text, or `add_language`/`set_param` calls.
- A change to DataSphere skill registration logic.

### Skipped from coverage

- Handler runtime correctness (e.g. SMS send actually working). Out of scope; the test only verifies SWML schema parity.
- Webhook URL host correctness. Normalized away because they legitimately differ.

## Risks and mitigations

- **Risk:** Live SDK changes its SWML rendering API and the test loses access to a render method.
  **Mitigation:** Test isolates the render call into a single helper. If the API moves, only that helper changes.
- **Risk:** Drift sneaks in if developers add a new SWAIG tool but don't run the test before merging.
  **Mitigation:** Test must be wired into CI (out of scope for this design but will be flagged in the implementation plan as a follow-up commit).
- **Risk:** Hand-maintained templates fall behind live bodies for edge-case logic (e.g. error fallback strings).
  **Mitigation:** Template builders include the full body source verbatim. The SWML-parity test won't catch handler-body drift, but body drift only affects runtime behavior of the copied file, not its SWML — acceptable trade-off given the YAGNI bar.

## Open questions for the implementation plan

These do not block design approval but should be resolved during plan-writing:

1. Confirm the exact `signalwire-agents` SDK call that renders SWML without starting an HTTP server. Read `signalwire-agents` source under `.venv/lib/python3.12/site-packages/`.
2. Determine the exact env vars and config keys used by `send_email` and `schedule_callback` by reading their live bodies.
3. Decide whether the SWML-parity test should be wired into CI as part of this work, or as a separate follow-up commit.
