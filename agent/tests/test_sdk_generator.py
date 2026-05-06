"""Tests for _generate_sdk_code: SWML equality, drift-guard, smoke."""
import ast
import json
import re
from pathlib import Path

import pytest

from agent.main import VirtualEmployeeAgent, _generate_sdk_code


FIXTURES = Path(__file__).parent / "fixtures"
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
ISO_TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")

# Fields that vary by request, by deployment, or by HireWire-specific routing
# and so must be ignored when comparing live SWML to generated SWML.
STRIP_KEYS = {
    "web_hook_url", "post_prompt_url", "video_idle_file", "video_talking_file",
    "call_id", "request_id",
}


def _load(fixture_name: str) -> dict:
    return json.loads((FIXTURES / fixture_name).read_text())


def _normalize(value):
    """Recursively strip request-scoped + HireWire-specific values from SWML."""
    if isinstance(value, dict):
        return {
            k: _normalize(v)
            for k, v in value.items()
            if k not in STRIP_KEYS
        }
    if isinstance(value, list):
        return [_normalize(v) for v in value]
    if isinstance(value, str):
        if UUID_RE.match(value) or ISO_TS_RE.match(value):
            return "<scrubbed>"
        return value
    return value


def _live_swml(config: dict) -> dict:
    return _normalize(json.loads(VirtualEmployeeAgent(config)._render_swml()))


def _generated_swml(config: dict) -> dict:
    code = _generate_sdk_code(config)
    ns: dict = {}
    exec(code, ns)
    cls_name = next(
        k for k, v in ns.items()
        if isinstance(v, type) and k != "AgentBase" and k.endswith("Agent")
    )
    agent = ns[cls_name]()
    return _normalize(json.loads(agent._render_swml()))


def test_no_functions_fixture_swml_matches():
    config = _load("employee_no_functions.json")
    live = _live_swml(config)
    generated = _generated_swml(config)
    assert live == generated, (
        f"SWML mismatch:\nlive={json.dumps(live, indent=2, sort_keys=True)}\n"
        f"generated={json.dumps(generated, indent=2, sort_keys=True)}"
    )


def test_generated_code_is_valid_python():
    config = _load("employee_no_functions.json")
    code = _generate_sdk_code(config)
    ast.parse(code)  # raises SyntaxError on bad output


def test_minimal_fixture_swml_matches():
    config = _load("employee_minimal.json")
    live = _live_swml(config)
    generated = _generated_swml(config)
    assert live == generated, (
        f"minimal SWML mismatch:\nlive={json.dumps(live, indent=2, sort_keys=True)}\n"
        f"generated={json.dumps(generated, indent=2, sort_keys=True)}"
    )


def test_full_fixture_swml_matches(monkeypatch):
    monkeypatch.setenv("SIGNALWIRE_SPACE", "test.signalwire.com")
    monkeypatch.setenv("SIGNALWIRE_PROJECT_ID", "00000000-0000-0000-0000-000000000000")
    monkeypatch.setenv("SIGNALWIRE_TOKEN", "test_token")
    monkeypatch.setenv("SENDGRID_API_KEY", "test_sendgrid_key")
    config = _load("employee_full.json")
    live = _live_swml(config)
    generated = _generated_swml(config)
    assert live == generated, (
        f"full SWML mismatch:\nlive={json.dumps(live, indent=2, sort_keys=True)[:5000]}\n"
        f"generated={json.dumps(generated, indent=2, sort_keys=True)[:5000]}"
    )


def test_handlers_block_matches_source_module():
    """The HANDLERS_START..HANDLERS_END region of the generated file must be
    bit-equal to the post-imports section of agent/swaig_handlers.py (cached
    via _read_handlers_source). Catches drift when one is edited without the other."""
    from agent.main import _read_handlers_source, _HANDLERS_START, _HANDLERS_END

    config = _load("employee_no_functions.json")
    code = _generate_sdk_code(config)

    start = code.index(_HANDLERS_START)
    end = code.index(_HANDLERS_END)
    embedded = code[start + len(_HANDLERS_START):end].strip()
    expected = _read_handlers_source().strip()
    assert embedded == expected, "Handlers source drifted between module and generator embedding"


def test_generated_file_imports_in_fresh_interpreter(tmp_path):
    """Write generated code to disk, exec it in a subprocess with no agent
    package on sys.path. Proves the generated file is self-contained."""
    import os
    import subprocess
    import sys

    config = _load("employee_minimal.json")
    code = _generate_sdk_code(config)
    p = tmp_path / "generated_agent.py"
    p.write_text(code)

    # Run with uv run to ensure signalwire-agents is on the path via .venv.
    result = subprocess.run(
        ["uv", "run", "python", "-c",
         f"import importlib.util, sys; "
         f"spec = importlib.util.spec_from_file_location('gen', r'{p}'); "
         f"m = importlib.util.module_from_spec(spec); "
         f"spec.loader.exec_module(m); "
         f"print('ok')"],
        cwd=str(tmp_path),
        capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, (
        f"generated file failed to import:\nstdout={result.stdout}\nstderr={result.stderr}"
    )
    assert "ok" in result.stdout
