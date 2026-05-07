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
