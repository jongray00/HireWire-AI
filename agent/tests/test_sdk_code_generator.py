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
    """Parse SWML JSON and strip webhook URLs so we compare schema, not hosts/tokens."""
    data = json.loads(swml_str)
    text = json.dumps(data, sort_keys=True)
    # Strip full webhook URLs (including path, auth credentials, and __token query params)
    # down to a stable stub. The SDK embeds per-instance auth tokens and timestamps that
    # differ between two separate agent instances even with the same config.
    text = re.sub(r'https?://[^"]*?/swaig(/[^"]*)?', '/swaig/', text)
    text = re.sub(r'https?://[^"]*?/post_prompt(/[^"]*)?', '/post_prompt/', text)
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


def test_minimal_config_swml_parity(tmp_path):
    """Empty enabled_functions: prompt + post-prompt + language must match."""
    config = _minimal_config()
    # Generate
    code = _generate_sdk_code(config)
    module = _load_generated_module(code, tmp_path)
    GenAgent = _find_first_class(module)
    gen_agent = GenAgent()
    gen_swml = gen_agent._render_swml()

    # Live
    live_agent = VirtualEmployeeAgent(config)
    live_swml = live_agent._render_swml()

    assert _normalize_swml(gen_swml) == _normalize_swml(live_swml)


def test_transfer_to_human_swml_parity(tmp_path):
    """Only transfer_to_human enabled; must match SWML."""
    config = _minimal_config()
    config["id"] = "test-transfer"
    config["enabled_functions"] = ["transfer_to_human"]
    config["transfer_number"] = "+15551112222"
    config["phone_number"] = "+15554443333"

    code = _generate_sdk_code(config)
    module = _load_generated_module(code, tmp_path)
    GenAgent = _find_first_class(module)
    gen_agent = GenAgent()
    gen_swml = gen_agent._render_swml()

    live_agent = VirtualEmployeeAgent(config)
    live_swml = live_agent._render_swml()

    assert _normalize_swml(gen_swml) == _normalize_swml(live_swml)


def test_send_summary_sms_swml_parity(tmp_path):
    """Only send_summary_sms enabled; must match SWML."""
    config = _minimal_config()
    config["id"] = "test-sms"
    config["enabled_functions"] = ["send_summary_sms"]
    config["sms_from_number"] = "+15557778888"

    code = _generate_sdk_code(config)
    module = _load_generated_module(code, tmp_path)
    GenAgent = _find_first_class(module)
    gen_agent = GenAgent()
    gen_swml = gen_agent._render_swml()

    live_agent = VirtualEmployeeAgent(config)
    live_swml = live_agent._render_swml()

    assert _normalize_swml(gen_swml) == _normalize_swml(live_swml)


def test_schedule_callback_swml_parity(tmp_path):
    """Only schedule_callback enabled; must match SWML."""
    config = _minimal_config()
    config["id"] = "test-cb"
    config["enabled_functions"] = ["schedule_callback"]

    code = _generate_sdk_code(config)
    module = _load_generated_module(code, tmp_path)
    GenAgent = _find_first_class(module)
    gen_agent = GenAgent()
    gen_swml = gen_agent._render_swml()

    live_agent = VirtualEmployeeAgent(config)
    live_swml = live_agent._render_swml()

    assert _normalize_swml(gen_swml) == _normalize_swml(live_swml)


def test_check_business_hours_swml_parity(tmp_path):
    """Only check_business_hours enabled; must match SWML."""
    config = _minimal_config()
    config["id"] = "test-bh"
    config["enabled_functions"] = ["check_business_hours"]
    config["business_hours_start"] = 8
    config["business_hours_end"] = 17
    config["business_days"] = [0, 1, 2, 3, 4, 5]

    code = _generate_sdk_code(config)
    module = _load_generated_module(code, tmp_path)
    GenAgent = _find_first_class(module)
    gen_agent = GenAgent()
    gen_swml = gen_agent._render_swml()

    live_agent = VirtualEmployeeAgent(config)
    live_swml = live_agent._render_swml()

    assert _normalize_swml(gen_swml) == _normalize_swml(live_swml)


def test_collect_customer_info_swml_parity(tmp_path):
    """Only collect_customer_info enabled; must match SWML."""
    config = _minimal_config()
    config["id"] = "test-cci"
    config["enabled_functions"] = ["collect_customer_info"]

    code = _generate_sdk_code(config)
    module = _load_generated_module(code, tmp_path)
    GenAgent = _find_first_class(module)
    gen_agent = GenAgent()
    gen_swml = gen_agent._render_swml()

    live_agent = VirtualEmployeeAgent(config)
    live_swml = live_agent._render_swml()

    assert _normalize_swml(gen_swml) == _normalize_swml(live_swml)


def test_send_email_swml_parity(tmp_path):
    """Only send_email enabled; must match SWML."""
    config = _minimal_config()
    config["id"] = "test-email"
    config["enabled_functions"] = ["send_email"]
    config["sendgrid_api_key"] = "SG.test"
    config["email_from_address"] = "noreply@example.com"
    config["email_from_name"] = "Test"

    code = _generate_sdk_code(config)
    module = _load_generated_module(code, tmp_path)
    GenAgent = _find_first_class(module)
    gen_agent = GenAgent()
    gen_swml = gen_agent._render_swml()

    live_agent = VirtualEmployeeAgent(config)
    live_swml = live_agent._render_swml()

    assert _normalize_swml(gen_swml) == _normalize_swml(live_swml)


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

    live_agent = VirtualEmployeeAgent(config)
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

    live_agent = VirtualEmployeeAgent(config)
    live_swml = live_agent._render_swml()

    assert _normalize_swml(gen_swml) == _normalize_swml(live_swml)


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


def test_full_config_swml_parity(tmp_path, monkeypatch):
    """Full config with 7 functions and 2 documents: generated SWML must match live."""
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

    live_agent = VirtualEmployeeAgent(config)
    live_swml = live_agent._render_swml()

    assert _normalize_swml(gen_swml) == _normalize_swml(live_swml)


def test_unknown_function_emits_warning_no_crash(tmp_path):
    """Unknown function should emit warning comment and not crash; valid functions must work.

    The contexts/steps refactor surfaces the unknown function name inside the
    assist step's `functions` list (mirroring the live agent — it does the same
    because `_build_employee_context` distributes `enabled_functions` verbatim).
    What the generator must NOT do is emit a SWAIG handler for it: there's no
    template, so the warning comment goes in instead. SWML parity holds because
    the live agent also doesn't define a `set_identity` SWAIG tool, so neither
    has it in the SWAIG functions block.
    """
    config = _minimal_config()
    config["enabled_functions"] = ["transfer_to_human", "set_identity"]  # set_identity is wizard-only
    config["transfer_number"] = "+15551112222"

    code = _generate_sdk_code(config)
    assert "WARN: skipped unknown function 'set_identity'" in code
    # Must still load and render SWML
    module = _load_generated_module(code, tmp_path)
    gen_agent = _find_first_class(module)()
    gen_swml_json = json.loads(gen_agent._render_swml())

    # transfer_to_human handler exists and is reachable from the assist step.
    swaig_names = [
        f["function"]
        for f in next(s.get("ai") for s in gen_swml_json["sections"]["main"] if isinstance(s, dict) and s.get("ai")).get("SWAIG", {}).get("functions", [])
    ]
    assert "transfer_to_human" in swaig_names
    # No SWAIG handler emitted for the unknown function (the warning replaces the handler).
    assert "set_identity" not in swaig_names

    # SWML parity with live agent must hold even with an unknown function present.
    live_swml = VirtualEmployeeAgent(config)._render_swml()
    assert _normalize_swml(gen_agent._render_swml()) == _normalize_swml(live_swml)


# ---------------------------------------------------------------------------
# Structural helpers + tests for the Contexts+Steps refactor (Task 1).
# These tests are expected to FAIL until Tasks 2-5 land — they assert the
# eventual shape of the SWML (contexts.default.steps[]) which doesn't exist
# yet on the live agent.
# ---------------------------------------------------------------------------


def _extract_steps(swml: dict, context_name: str = "default") -> dict:
    """Walk the SWML structure to the contexts -> steps block.

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
