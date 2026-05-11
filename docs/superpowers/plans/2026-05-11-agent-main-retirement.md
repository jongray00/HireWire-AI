# Agent main.py Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute task-by-task. Each task here uses checkbox (`- [ ]`) syntax for tracking. Phase A is fully fleshed-out; Phases B–F are sketched and must be deepened in a follow-up before execution.

**Goal:** Move every FastAPI surface in `agent/main.py` (12 routes, 1 middleware, 7 helpers, 2 module-level globals, `VirtualEmployeeAgent`, `WizardAgent`) into modular pieces beneath `agent/` so that `agent/app.py` becomes the single FastAPI entry point. `agent/main.py` ends life as a thin compatibility shim (`from agent.app import app`), and after one week of stable runs in production is deleted entirely.

**Architecture:** Decompose `main.py` (2137 LOC) into:
- `agent/lib/util.py` — pure helpers (`_detect_ngrok_url`, `_validate_datasphere_doc`, `_LANGUAGE_MAP`).
- `agent/lib/virtual_employee_agent.py` — the `VirtualEmployeeAgent` class.
- `agent/lib/wizard_agent.py` — the `WizardAgent` class + `_wizard_lookup_user_credentials` + `_wizard_create_employee_via_frontend` + `_wizard_create_inflight` module state.
- `agent/lib/agent_registry.py` — owns the `employees`, `agent_instances`, `agent_credentials` dicts and the `_remount_employee_router` mounting primitive (the in-memory state previously global on `main`).
- `agent/lib/sdk_code.py` — the `_generate_sdk_code` renderer (lifted verbatim from `main.py`).
- `agent/routes/employees.py` — `/api/create-employee`, `/api/list-employees`, `/api/employee/{id}` (GET/PATCH/DELETE), `/api/update-config`, `/api/config`, `/api/agent-info`, `/agent-code/{id}`.
- `agent/routes/post_prompt.py` — `/api/post-prompt/{path:path}` (already authed via per-project Basic Auth).
- `agent/routes/health.py` — `/health`.
- `agent/app.py` — `build_app()` mounts every router, runs lifespan migrations, mounts wizard + writes the credentials file inside the lifespan startup phase (not at module import).

The decomposition is **strictly mechanical**: behavior is unchanged at every step. Tests are the safety net.

**Tech Stack:** Python 3.11+, FastAPI, signalwire-agents>=0.1.54, pytest, uvicorn.

**Spec:** No separate spec — design is captured here. The decomposition mirrors how `agent/app.py` was already structured for Phase 2 (auth routes); we're extending the same pattern.

---

## Why phased

The 2137-line `main.py` is the running production app. Every employee's SWML route is mounted off `main.app` via `_remount_employee_router`. The wizard agent is mounted at module-import time. The `/api/post-prompt` proxy is live SignalWire webhook traffic. Retiring this in one shot — moving every route, both agent classes, and all module state simultaneously — would mean either a multi-hour merge conflict with no incremental test signal, or a big-bang cutover with no rollback path.

Splitting into six phases means:
1. Each phase ends with an app that boots, all existing tests pass, and we can ship to prod.
2. Phase A (pure helpers) lands as a no-op refactor that exercises the new module layout before we move any routes.
3. Phase E (the highest-risk phase — `/api/post-prompt` and per-employee SWML routers) sits at the end of the route-migration sequence, after we've already proven the inclusion mechanism on lower-risk routes.
4. Phase F (cutover) flips the deploy entrypoint from `agent.main:app` to `agent.app:app` in one line; `main.py` becomes a `from agent.app import app` shim. The original 2100-line file is not deleted until we've burned in for a week.

## Inventory (catalogued from agent/main.py)

### Module state (globals that cross route boundaries)

| Symbol | Lines | Used by | Target |
|---|---|---|---|
| `_LANGUAGE_MAP` | 68–84 | `VirtualEmployeeAgent._get_language_name`, `_generate_sdk_code` | `agent/lib/util.py` |
| `SWML_USER`, `SWML_PASSWORD`, `SHARED_BASIC_AUTH`, `APP_DOMAIN`, `FRONTEND_URL`, `WEB_DB_PATH` | 95–104 | `VirtualEmployeeAgent.on_swml_request`, `_remount_employee_router`, `_wizard_*`, lifespan credentials file | `agent/lib/agent_runtime.py` (module-level constants module) |
| `agent_credentials` (dict) | 125–129 | `/api/config`, `/api/agent-info`, credentials-file write | `agent/lib/agent_registry.py` (registry-owned state with getter) |
| `employees` (dict[str, dict]) | 133 | All `/api/employee*` routes, `/api/list-employees`, `/api/config`, `/api/update-config`, `/agent-code` | `agent/lib/agent_registry.py` |
| `agent_instances` (dict[str, AgentBase]) | 137 | `/api/create-employee`, `/api/update-config`, `/api/employee/{id}` PATCH/DELETE, lifespan wizard mount | `agent/lib/agent_registry.py` |
| `_wizard_create_inflight` (dict) | 874 | `WizardAgent.create_agent` dedup guard | `agent/lib/wizard_agent.py` (module-private) |

### Helpers / standalone functions

| Function | Lines | Pure? | Target |
|---|---|---|---|
| `require_webhook_basic_auth` (FastAPI dep) | 39–64 | Stateful (DB) | `agent/routes/post_prompt.py` (route-local) |
| `_detect_ngrok_url` | 107–118 | Pure | `agent/lib/util.py` |
| `_wizard_lookup_user_credentials` | 847–869 | Pure (reads sqlite) | `agent/lib/wizard_agent.py` |
| `_wizard_create_employee_via_frontend` | 877–905 | Pure (http) | `agent/lib/wizard_agent.py` |
| `_remount_employee_router` | 1512–1528 | Mutates `app.routes` | `agent/lib/agent_registry.py` (takes `app` param) |
| `_validate_datasphere_doc` | 1533–1554 | Pure (http) | `agent/lib/util.py` |
| `_generate_sdk_code` | 1657–1823 | Pure | `agent/lib/sdk_code.py` |

### Classes

| Class | Lines | Target |
|---|---|---|
| `VirtualEmployeeAgent` (`AgentBase` subclass; 14 SWAIG tools + `on_swml_request`) | 140–844 | `agent/lib/virtual_employee_agent.py` |
| `WizardAgent` (`AgentBase` subclass; 7 SWAIG tools + `on_swml_request`) | 908–1487 | `agent/lib/wizard_agent.py` |

### FastAPI surface

| Decorator | Line | Route | Mutates state? | Phase |
|---|---|---|---|---|
| `@app.middleware("http")` | 1506 | `bypass_auth` (no-op pass-through) | No | A (drop entirely — it's dead code) |
| `@app.post` | 1557 | `/api/create-employee` | Yes — `employees`, `agent_instances`, `app.routes` | D |
| `@app.get` | 1635 | `/api/list-employees` | No | C |
| `@app.get` | 1645 | `/api/employee/{employee_id}` | No | C |
| `@app.get` | 1826 | `/agent-code/{employee_id}` | No | C |
| `@app.patch` | 1842 | `/api/employee/{employee_id}` | Yes | D |
| `@app.delete` | 1899 | `/api/employee/{employee_id}` | Yes | D |
| `@app.post` | 1934 | `/api/update-config` (legacy) | Yes | D |
| `@app.get` | 1991 | `/api/config` (legacy) | No | C |
| `@app.get` | 2011 | `/api/agent-info` | No | C |
| `@app.post` | 2024 | `/api/post-prompt/{path:path}` | No (proxy) | E |
| `@app.get` | 2068 | `/health` | No | C |

### Module-import side effects (lines 2083–2112)

- Instantiates `WizardAgent`, calls `_remount_employee_router("wizard", wizard)`, stores in `agent_instances["wizard"]`. **Target:** move into `app.py` lifespan startup so it runs once per process under `build_app`.
- Writes `web/agent-credentials.json` from `SHARED_BASIC_AUTH`. **Target:** same lifespan startup hook.

### `__main__` block (lines 2116–2137)

Auto-detects ngrok URL if `APP_DOMAIN` unset, then `uvicorn.run(app, …)`. **Target:** delete in Phase F (use `uvicorn agent.app:app` directly instead — the existing deploy pattern).

### Aggregate impact

- **2137 LOC** to move.
- **12 routes** + 1 middleware (dropped).
- **2 agent classes** to extract.
- **5 module-level state buckets** to consolidate into a registry.
- **2 import-time side effects** to move into lifespan startup.

---

## Phases

### Phase A: Move pure helpers (lowest risk)

Move stateless utility functions out of `main.py` into `agent/lib/util.py`. `main.py` re-imports them so old import paths keep working. No route changes, no class moves. **3 tasks, fully fleshed out below.**

### Phase B: Extract `VirtualEmployeeAgent` and `WizardAgent` classes

Move both AgentBase subclasses to `agent/lib/virtual_employee_agent.py` and `agent/lib/wizard_agent.py`. `main.py` re-exports them. `_generate_sdk_code` also moves to `agent/lib/sdk_code.py`. Tests under `agent/tests/test_sdk_code_generator.py` already import `from agent.main import VirtualEmployeeAgent, _generate_sdk_code` — keep these working via re-export.

### Phase C: Move read-only routes (low risk)

Create `agent/routes/employees.py`, `agent/routes/agent_info.py`, `agent/routes/health.py`. Move all GET routes plus the in-memory `employees` dict (now read-only from main.py's perspective) behind a tiny `AgentRegistry` accessor that both old `main.py` and new routes share.

### Phase D: Move state-mutating routes (medium risk)

Move `/api/create-employee`, `/api/employee/{id}` PATCH+DELETE, `/api/update-config`. Coordinate via the `AgentRegistry` introduced in C. Critical: `_remount_employee_router` is the only writer that mutates `app.routes` mid-flight. Pass the `app` reference into `AgentRegistry.create_employee()` instead of relying on the module-level `app` symbol.

### Phase E: Move webhook + SWML serving (highest risk — LIVE TRAFFIC)

Move `/api/post-prompt/{path:path}` to `agent/routes/post_prompt.py` and migrate the wizard mount + per-employee router mounting into `agent/app.py` lifespan startup. Per-employee SWML routes (`/swml/<id>`) are mounted via `_remount_employee_router` and serve live SignalWire dial traffic — any downtime here drops calls. Cutover plan: ship Phase E behind a feature flag (`HIREWIRE_AGENT_APP_ENABLED=1`); leave `agent.main:app` running for one full deploy cycle in production with traffic still pointed at it; smoke-test `agent.app:app` against a parallel ngrok tunnel; flip when green.

### Phase F: Cutover + cleanup

Switch the deploy entrypoint (Replit run command, replit.md docs) from `agent.main:app` to `agent.app:app`. Replace `agent/main.py`'s body with a single line: `from agent.app import app  # noqa: F401 — back-compat shim`. After 1 week of stable production runs, delete `agent/main.py` entirely. Update `agent/tests/test_post_prompt_auth.py` and `agent/tests/test_sdk_code_generator.py` to import from `agent.app` / `agent.lib.virtual_employee_agent` directly instead of `agent.main`.

---

## Phase A: Move pure helpers — Tasks (FULLY FLESHED OUT)

These three tasks move stateless functions and the language map out of `main.py`. After Phase A, `main.py` keeps the same imports for back-compat, so nothing downstream breaks.

### Task A.1: Move `_detect_ngrok_url` to `agent/lib/util.py`

**Files:**
- Create: `agent/lib/util.py`
- Create: `agent/tests/test_util.py`
- Modify: `agent/main.py` (replace inline def with re-import)

**Why first:** `_detect_ngrok_url` is the simplest pure helper. It has no imports of anything else in `main.py`. Moving it first verifies the new file's import wiring without any class/route coupling.

- [ ] **Step 1: Write the failing test**

Create `agent/tests/test_util.py`:

```python
"""Tests for agent.lib.util — pure helpers extracted from agent/main.py."""
import json
import urllib.error
from unittest.mock import MagicMock, patch

from agent.lib import util


def test_detect_ngrok_url_returns_https_tunnel_when_present():
    """Picks the first tunnel whose proto is 'https' from ngrok's local API."""
    payload = {
        "tunnels": [
            {"proto": "http", "public_url": "http://nope.ngrok.io"},
            {"proto": "https", "public_url": "https://abc123.ngrok.io"},
        ]
    }
    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps(payload).encode()
    with patch("urllib.request.urlopen", return_value=mock_resp):
        assert util._detect_ngrok_url() == "https://abc123.ngrok.io"


def test_detect_ngrok_url_returns_none_when_ngrok_unreachable():
    """Returns None on connection failure rather than raising."""
    with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("nope")):
        assert util._detect_ngrok_url() is None


def test_detect_ngrok_url_returns_none_when_no_https_tunnel():
    """Returns None when no tunnel has proto=https."""
    payload = {"tunnels": [{"proto": "http", "public_url": "http://x.ngrok.io"}]}
    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps(payload).encode()
    with patch("urllib.request.urlopen", return_value=mock_resp):
        assert util._detect_ngrok_url() is None
```

Verify it fails because `agent.lib.util` doesn't exist:

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && .venv/bin/pytest agent/tests/test_util.py -x 2>&1 | tail -10
```

Expect `ModuleNotFoundError: No module named 'agent.lib.util'`.

- [ ] **Step 2: Create `agent/lib/util.py`**

```python
"""Pure helper functions used across the HireWire agent backend.

These were originally module-level functions in agent/main.py.  Moving them
here lets routes, lib modules, and agent classes share them without circular
imports back through main.
"""
from __future__ import annotations

import json
import urllib.request
from typing import Optional


# Module-level language-code -> language-name map.  Consumed by both
# VirtualEmployeeAgent._get_language_name and _generate_sdk_code.
_LANGUAGE_MAP = {
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


def _detect_ngrok_url() -> Optional[str]:
    """Query ngrok's local API for the current public https tunnel URL."""
    try:
        resp = urllib.request.urlopen("http://localhost:4040/api/tunnels", timeout=2)
        data = json.loads(resp.read())
        for tunnel in data.get("tunnels", []):
            if tunnel.get("proto") == "https":
                return tunnel["public_url"]
    except Exception:
        pass
    return None
```

Verify the test now passes:

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && .venv/bin/pytest agent/tests/test_util.py -x 2>&1 | tail -10
```

Expect `3 passed`.

- [ ] **Step 3: Update `agent/main.py` to re-import from util.py**

Replace lines 66–84 (the `_LANGUAGE_MAP` literal) AND lines 107–118 (the `_detect_ngrok_url` def) in `agent/main.py`. Both should become a single import block near the top of the file (next to the existing `from agent.lib import webhook_auth, db, config` at line 36):

```python
from agent.lib.util import _LANGUAGE_MAP, _detect_ngrok_url
```

Use `Edit` with exact `old_string`:

For `_LANGUAGE_MAP`:

```
# Module-level language-code → language-name map.  Used by both
# VirtualEmployeeAgent._get_language_name and _generate_sdk_code.
_LANGUAGE_MAP = {
    "en": "English", "en-US": "English", "en-GB": "English",
    ... (full block)
    "multi": "Multilingual",
}
```

Replace with nothing (empty string) — but only after confirming the `from agent.lib.util import …` line is in place.

For `_detect_ngrok_url`:

```
def _detect_ngrok_url() -> Optional[str]:
    """Query ngrok local API to get the current public tunnel URL."""
    try:
        import urllib.request
        resp = urllib.request.urlopen("http://localhost:4040/api/tunnels", timeout=2)
        data = json.loads(resp.read())
        for tunnel in data.get("tunnels", []):
            if tunnel.get("proto") == "https":
                return tunnel["public_url"]
    except Exception:
        pass
    return None
```

Replace with nothing.

- [ ] **Step 4: Verify the full test suite still passes**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && .venv/bin/pytest agent/ -x 2>&1 | tail -20
```

Expect all existing tests to pass (no regression). `_LANGUAGE_MAP` is still importable from `agent.main` (re-exported via the `from agent.lib.util import …` line), so `_generate_sdk_code`'s use of it still works.

- [ ] **Step 5: Smoke-boot the app**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && timeout 6 .venv/bin/uvicorn agent.main:app --host 127.0.0.1 --port 8765 --log-level info 2>&1 | tail -15
```

Expect lines: `Wizard agent mounted at /swml/wizard` and `Application startup complete`. No tracebacks.

- [ ] **Step 6: Hand off**

Working tree shows `M agent/main.py`, `?? agent/lib/util.py`, `?? agent/tests/test_util.py`. Do not commit — controller handles git.

---

### Task A.2: Move `_validate_datasphere_doc` to `agent/lib/util.py`

**Files:**
- Modify: `agent/lib/util.py` (add function)
- Modify: `agent/tests/test_util.py` (add tests)
- Modify: `agent/main.py` (re-import)

**Why:** `_validate_datasphere_doc` is a pure HTTP call with no shared state. Like `_detect_ngrok_url` it's a thin urllib wrapper and moves cleanly.

- [ ] **Step 1: Write failing tests**

Append to `agent/tests/test_util.py`:

```python
def test_validate_datasphere_doc_returns_valid_on_2xx():
    mock_resp = MagicMock()
    mock_resp.__enter__.return_value = mock_resp
    mock_resp.read.return_value = b"{}"
    with patch("urllib.request.urlopen", return_value=mock_resp):
        result = util._validate_datasphere_doc(
            "space.signalwire.com", "proj-1", "tok-1", "doc-1"
        )
    assert result == {"valid": True}


def test_validate_datasphere_doc_returns_invalid_on_exception():
    with patch("urllib.request.urlopen", side_effect=urllib.error.HTTPError(
        "url", 401, "unauthorized", {}, None
    )):
        result = util._validate_datasphere_doc("s", "p", "t", "d")
    assert result["valid"] is False
    assert "error" in result
```

Verify failure: `ImportError: cannot import name '_validate_datasphere_doc' from 'agent.lib.util'`.

- [ ] **Step 2: Move the function**

Append to `agent/lib/util.py`:

```python
def _validate_datasphere_doc(
    space_name: str, project_id: str, token: str, doc_id: str
) -> dict:
    """Validate a DataSphere document_id by making a test query."""
    import base64
    import json as _json
    try:
        url = f"https://{space_name}/api/datasphere/documents/search"
        body = _json.dumps({
            "document_id": doc_id,
            "query_string": "test",
            "count": 1,
            "distance": 10.0,
        }).encode()
        auth = f"{project_id}:{token}"
        auth_header = base64.b64encode(auth.encode()).decode()
        req = urllib.request.Request(url, data=body, method="POST", headers={
            "Authorization": f"Basic {auth_header}",
            "Content-Type": "application/json",
        })
        urllib.request.urlopen(req, timeout=5)
        return {"valid": True}
    except Exception as e:
        return {"valid": False, "error": str(e)}
```

- [ ] **Step 3: Verify the new tests pass**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && .venv/bin/pytest agent/tests/test_util.py -x 2>&1 | tail -10
```

- [ ] **Step 4: Re-import in main.py**

In `agent/main.py`, update the existing import line to:

```python
from agent.lib.util import _LANGUAGE_MAP, _detect_ngrok_url, _validate_datasphere_doc
```

Delete the `_validate_datasphere_doc` function definition (lines 1533–1554).

- [ ] **Step 5: Full suite + smoke boot**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && .venv/bin/pytest agent/ -x 2>&1 | tail -20
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && timeout 6 .venv/bin/uvicorn agent.main:app --host 127.0.0.1 --port 8765 --log-level info 2>&1 | tail -10
```

- [ ] **Step 6: Hand off**

---

### Task A.3: Move runtime constants (`SWML_USER`, `SHARED_BASIC_AUTH`, `APP_DOMAIN`, `FRONTEND_URL`, `WEB_DB_PATH`) to `agent/lib/agent_runtime.py`

**Files:**
- Create: `agent/lib/agent_runtime.py`
- Create: `agent/tests/test_agent_runtime.py`
- Modify: `agent/main.py` (re-import from runtime module)

**Why:** These constants need to be shared between the agent classes (`VirtualEmployeeAgent.on_swml_request` uses `APP_DOMAIN`), the wizard (`_wizard_create_employee_via_frontend` uses `FRONTEND_URL`), and the lifespan startup hook (which writes `web/agent-credentials.json` from `SHARED_BASIC_AUTH`). Centralizing them now prevents circular-import pain in Phase B.

**Caveat — env vs constant:** Today `APP_DOMAIN` is read once at module import. The `__main__` block (line 2127–2132) mutates it after import if ngrok is auto-detected. Phase A preserves this: keep the mutable global, but wrap it in a module-level setter `set_app_domain()` that the `__main__` block calls explicitly. Routes / agents read it via `get_app_domain()`.

- [ ] **Step 1: Write failing tests**

Create `agent/tests/test_agent_runtime.py`:

```python
"""Tests for agent.lib.agent_runtime — runtime constants module."""
import importlib
import os

import pytest


@pytest.fixture(autouse=True)
def clean_module():
    """Reload agent_runtime between tests so env-var changes take effect."""
    import agent.lib.agent_runtime as rt
    importlib.reload(rt)
    yield rt


def test_swml_user_defaults_to_signalwire(clean_module, monkeypatch):
    monkeypatch.delenv("SWML_BASIC_AUTH_USER", raising=False)
    rt = importlib.reload(clean_module)
    assert rt.SWML_USER == "signalwire"


def test_swml_password_falls_back_to_random_token(monkeypatch):
    monkeypatch.delenv("SWML_BASIC_AUTH_PASSWORD", raising=False)
    import agent.lib.agent_runtime as rt
    rt = importlib.reload(rt)
    # Random 32-byte token-urlsafe is at least 32 chars long.
    assert len(rt.SWML_PASSWORD) >= 30


def test_shared_basic_auth_uses_env_when_set(monkeypatch):
    monkeypatch.setenv("SWML_BASIC_AUTH_USER", "alice")
    monkeypatch.setenv("SWML_BASIC_AUTH_PASSWORD", "s3cret")
    import agent.lib.agent_runtime as rt
    rt = importlib.reload(rt)
    assert rt.SHARED_BASIC_AUTH == ("alice", "s3cret")


def test_set_app_domain_mutates_module_global():
    import agent.lib.agent_runtime as rt
    rt = importlib.reload(rt)
    rt.set_app_domain("https://abc.ngrok.io")
    assert rt.get_app_domain() == "https://abc.ngrok.io"
```

- [ ] **Step 2: Create `agent/lib/agent_runtime.py`**

```python
"""Runtime constants for the HireWire agent backend.

These values were originally module-level constants in agent/main.py.  Moving
them here breaks the import cycle that would otherwise form once we extract
VirtualEmployeeAgent / WizardAgent into their own modules (Phase B): the agent
classes need APP_DOMAIN and SHARED_BASIC_AUTH, but main.py also needs the
agent classes — without this module, they would import each other.
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path
from typing import Tuple

from dotenv import load_dotenv

load_dotenv()

SWML_USER: str = os.getenv("SWML_BASIC_AUTH_USER", "signalwire")
SWML_PASSWORD: str = (
    os.getenv("SWML_BASIC_AUTH_PASSWORD") or secrets.token_urlsafe(32)
)
SHARED_BASIC_AUTH: Tuple[str, str] = (SWML_USER, SWML_PASSWORD)

# APP_DOMAIN is mutable — agent/main.py's __main__ block (and, in Phase F,
# agent/app.py's lifespan) may set it from ngrok auto-detection at startup.
# Read it via get_app_domain(); set it via set_app_domain().
_APP_DOMAIN: str = os.getenv("APP_DOMAIN", "")

FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:5001")
WEB_DB_PATH: str = os.getenv(
    "DATABASE_PATH",
    str(Path(__file__).resolve().parent.parent.parent / "web" / "data" / "sally_sales.db"),
)


def get_app_domain() -> str:
    return _APP_DOMAIN


def set_app_domain(value: str) -> None:
    global _APP_DOMAIN
    _APP_DOMAIN = value
```

- [ ] **Step 3: Verify tests pass**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && .venv/bin/pytest agent/tests/test_agent_runtime.py -x 2>&1 | tail -10
```

- [ ] **Step 4: Refactor `main.py` to re-import**

In `agent/main.py`, replace lines 95–104 (the `SWML_USER` / `SWML_PASSWORD` / `SHARED_BASIC_AUTH` / `APP_DOMAIN` / `FRONTEND_URL` / `WEB_DB_PATH` block) with:

```python
from agent.lib.agent_runtime import (
    SWML_USER,
    SWML_PASSWORD,
    SHARED_BASIC_AUTH,
    FRONTEND_URL,
    WEB_DB_PATH,
    get_app_domain,
    set_app_domain,
)
```

Replace all references to the bare `APP_DOMAIN` symbol inside `main.py` with `get_app_domain()`:

- Line 807 (`VirtualEmployeeAgent.on_swml_request`): `base_url = (f"{protocol}://{host}" if host else get_app_domain()) or ""`
- Line 828: `post_prompt_domain = get_app_domain() or (f"{protocol}://{host}" if host else None)`
- Line 1117 (`WizardAgent.on_swml_request`): same pattern.
- Line 2001 (`/api/config` route): `swml_url = f"{get_app_domain()}{default_swml_path}" if get_app_domain() else default_swml_path`
- Line 2107 (`__main__` credentials write): `"app_domain": get_app_domain(),`
- Line 2127–2131 (`__main__` ngrok auto-detect): replace `APP_DOMAIN = detected; agent_credentials["app_domain"] = detected` with `set_app_domain(detected); agent_credentials["app_domain"] = detected`.

Use `Edit` with `replace_all=False` for each site to preserve unique context.

- [ ] **Step 5: Full suite + smoke boot**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && .venv/bin/pytest agent/ -x 2>&1 | tail -20
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && timeout 6 .venv/bin/uvicorn agent.main:app --host 127.0.0.1 --port 8765 --log-level info 2>&1 | tail -10
```

The wizard must still mount and the credentials file must still write — both depend on `SHARED_BASIC_AUTH`.

- [ ] **Step 6: Verify the credentials file content**

```bash
cd "/Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI" && python -c "import json; print(json.dumps(json.load(open('web/agent-credentials.json')), indent=2))" 2>&1 | tail -10
```

Expect `username` and `password` fields matching what the agent process used. No regression.

- [ ] **Step 7: Hand off**

---

## Phase A Exit Criteria

- [ ] `agent/lib/util.py` exists with `_LANGUAGE_MAP`, `_detect_ngrok_url`, `_validate_datasphere_doc`.
- [ ] `agent/lib/agent_runtime.py` exists with all 6 runtime constants + `get/set_app_domain`.
- [ ] `agent/main.py` LOC dropped by ~40 (helpers gone, constants now imports).
- [ ] All existing tests pass (`.venv/bin/pytest agent/ -x`).
- [ ] `uvicorn agent.main:app` boots cleanly with `Wizard agent mounted at /swml/wizard`.
- [ ] No callers anywhere import the moved symbols from anywhere except `agent.lib.util` or `agent.lib.agent_runtime` directly — verify with `grep -rn "from agent.main import _detect_ngrok_url\|from agent.main import _LANGUAGE_MAP\|from agent.main import _validate_datasphere_doc" agent/`. Expect zero hits.

After Phase A lands, **stop and re-evaluate**. Phases B–F need fleshing out below before continuing.

---

## Phase B: Extract `VirtualEmployeeAgent` + `WizardAgent` + `_generate_sdk_code`

## TODO before execution: flesh out tasks

### Task B.1: Move `VirtualEmployeeAgent` to `agent/lib/virtual_employee_agent.py`

**Why this is tricky:**
- The class has 14 `@AgentBase.tool`-decorated methods. Decorators reference `AgentBase` and `SwaigFunctionResult` — both must be importable from the new module.
- `_configure_functions` calls `self.skill_manager.loaded_skills` and `self._tool_registry` (private SDK API) — confirm these survive class relocation.
- `on_swml_request` reads `APP_DOMAIN` — already migrated to `get_app_domain()` in Phase A, so the move is clean.
- `_get_language_name` reads `_LANGUAGE_MAP` — already an import.
- Test `agent/tests/test_sdk_code_generator.py` line 20: `from agent.main import VirtualEmployeeAgent, _generate_sdk_code` — must remain importable. Solution: add `from agent.lib.virtual_employee_agent import VirtualEmployeeAgent` and `from agent.lib.sdk_code import _generate_sdk_code` to `main.py` (re-export).

**Steps:**
- [ ] Step 1: Create `agent/lib/virtual_employee_agent.py`. Copy the class verbatim, plus its imports. Confirm `__init__.py` is fine (no PEP 562 lazy imports).
- [ ] Step 2: Delete the class body from `main.py`, add a re-export line.
- [ ] Step 3: Run `agent/tests/test_sdk_code_generator.py` and `agent/tests/test_post_prompt_auth.py`.
- [ ] Step 4: Smoke-boot.

### Task B.2: Move `WizardAgent` + helpers + dedup map to `agent/lib/wizard_agent.py`

**Why this is tricky:**
- `_wizard_create_inflight` is module-private state. Move it to `agent/lib/wizard_agent.py` as a module global; do not expose it publicly.
- `_wizard_lookup_user_credentials` reads `WEB_DB_PATH` — imported via `from agent.lib.agent_runtime import WEB_DB_PATH`.
- `_wizard_create_employee_via_frontend` reads `FRONTEND_URL` — same import path.

**Steps:**
- [ ] Step 1: Create `agent/lib/wizard_agent.py` with the class and three module-private helpers.
- [ ] Step 2: Delete from `main.py`, add re-export.
- [ ] Step 3: Verify the wizard still mounts at `/swml/wizard` on smoke boot.

### Task B.3: Move `_generate_sdk_code` + `sdk_code_templates` consumer to `agent/lib/sdk_code.py`

**Why this is tricky:**
- The function is 170 LOC and consumes `_LANGUAGE_MAP` plus templates from `agent/sdk_code_templates.py`.
- The function name `_generate_sdk_code` is private — but it's imported as a public symbol by the test suite (`test_sdk_code_generator.py:20`). Keep the underscore prefix to signal internal; re-export from `main.py` for back-compat.

**Steps:**
- [ ] Step 1: Create `agent/lib/sdk_code.py` with `_generate_sdk_code`. Imports: `_LANGUAGE_MAP` from `agent.lib.util`; templates from `agent.sdk_code_templates`.
- [ ] Step 2: Delete from `main.py`, add re-export.
- [ ] Step 3: Run `test_sdk_code_generator.py` — all 14 SWML-parity tests must still pass.

### Phase B Exit Criteria

- [ ] `main.py` has shrunk by ~1300 LOC (both classes + SDK generator moved).
- [ ] All tests pass.
- [ ] Wizard still mounts on boot; per-employee SWML routes still work (test by `POST /api/create-employee` against the smoke-boot instance and checking `/swml/<new-id>/` returns 307).

---

## Phase C: Move read-only routes

## TODO before execution: flesh out tasks

### Task C.1: Introduce `AgentRegistry` in `agent/lib/agent_registry.py`

**Why this comes first in Phase C:** Every read route reads from the `employees`, `agent_instances`, `agent_credentials` globals. Move those globals into a registry singleton accessed via `get_registry()`, then `main.py` becomes a thin reference holder. Both old `main.py` routes (still mounted on `app`) and the new routes in `agent/routes/employees.py` share the same registry instance.

**Registry shape:**

```python
class AgentRegistry:
    def __init__(self):
        self.employees: Dict[str, Dict[str, Any]] = {}
        self.agent_instances: Dict[str, AgentBase] = {}
        self.agent_credentials: Dict[str, str] = {
            "username": SWML_USER,
            "password": SWML_PASSWORD,
            "app_domain": get_app_domain(),
        }

    def list_employees(self) -> List[Dict[str, Any]]: ...
    def get_employee(self, eid: str) -> Optional[Dict[str, Any]]: ...
    def upsert_employee(self, eid: str, config: dict, agent: AgentBase) -> None: ...
    def delete_employee(self, eid: str) -> Optional[str]: ...  # returns name

_registry: Optional[AgentRegistry] = None

def get_registry() -> AgentRegistry:
    global _registry
    if _registry is None:
        _registry = AgentRegistry()
    return _registry
```

- [ ] Step 1: Tests for `AgentRegistry` (in-memory, no FastAPI).
- [ ] Step 2: Implementation.
- [ ] Step 3: Modify `main.py` to assign `employees = get_registry().employees` etc. as backwards-compatible aliases so existing route code is unchanged in this task.

### Task C.2: Create `agent/routes/employees.py` with read-only routes

- [ ] Create `agent/routes/employees.py` with `/api/list-employees`, `/api/employee/{id}` GET, `/agent-code/{id}`. All read from `get_registry()`.
- [ ] **Do NOT yet remove them from main.py.** The intention is to mount the new router on `agent/app.py` (currently un-deployed) and verify it serves identical responses, side-by-side.
- [ ] Add a smoke test: `TestClient(agent.app.app).get("/api/list-employees")` should return the same JSON shape as `TestClient(agent.main.app).get("/api/list-employees")`.

### Task C.3: Create `agent/routes/agent_info.py` + `agent/routes/health.py`

- [ ] `/api/config`, `/api/agent-info`, `/health` — same pattern. Mount in `agent/app.py`.
- [ ] Side-by-side response equality test.

### Task C.4: Remove read-only routes from `main.py`

**Only after** Task C.2 + C.3 confirm side-by-side parity. Delete the route bodies in `main.py`; the registry-backed routes in `agent/routes/` are the only implementation left. **At this point `agent/app.py` is no longer parallel — it shares the registry with `main.py`.**

### Phase C Exit Criteria

- [ ] All GET routes serve from `agent/routes/*.py` modules.
- [ ] `agent/app.py` mounts those routers in `build_app()`.
- [ ] `main.py` no longer defines any GET routes.
- [ ] Existing tests pass; new equality tests confirm parity.

---

## Phase D: Move state-mutating routes — the hardest registry handoff

## TODO before execution: flesh out tasks

### Risk callouts

- `_remount_employee_router(employee_id, agent)` mutates `app.routes` in-place — it both removes old routes with a given prefix and calls `app.include_router(...)`. This is the only function that touches `app` mutably outside startup.
- Today, `_remount_employee_router` closes over the module-level `app` from `main.py`. After Phase C, both `agent.main:app` and `agent.app:app` exist as separate FastAPI instances. If a route is registered against the wrong `app`, requests 404.
- **The fix:** `_remount_employee_router(app, employee_id, agent)` becomes an explicit-`app`-arg function on `AgentRegistry`. Routes that call it (POST/PATCH/DELETE employee, POST update-config) must receive the right `app` via `Request` or via the route's `Request.app` attribute. FastAPI provides `request.app` for free.

### Task sketches

- [ ] **D.1:** Refactor `_remount_employee_router` to take `app` as an argument. Move into `AgentRegistry` as `mount_agent(app, employee_id, agent)`. Update both `main.py`'s `__main__` block (wizard mount) and the existing routes (still in main) to pass `app` explicitly.
- [ ] **D.2:** Create `/api/create-employee` in `agent/routes/employees.py` using `request.app` to get the FastAPI instance. Mount on `agent/app.py` (still side-by-side with `main.py`'s identical route).
- [ ] **D.3:** Same for PATCH and DELETE `/api/employee/{id}`.
- [ ] **D.4:** Same for `/api/update-config`.
- [ ] **D.5:** **Critical parity test:** create an employee via `agent.app:app`'s `/api/create-employee`, then verify the new SWML route is reachable on **both** `agent.app:app` and `agent.main:app` — confirming they share the registry but each has its own `app.routes`. This will surface any cross-app route-isolation issues.
- [ ] **D.6:** Remove the route bodies from `main.py`.

### Phase D Exit Criteria

- [ ] All mutating routes live in `agent/routes/employees.py`.
- [ ] `_remount_employee_router` is gone; replaced with `AgentRegistry.mount_agent(app, ...)`.
- [ ] No mutation of `agent.main:app.routes` happens from a non-`main` route.

---

## Phase E: Move `/api/post-prompt` and lifespan startup hooks — LIVE TRAFFIC

## TODO before execution: flesh out tasks

### Risk callouts (highest in the plan)

- `/api/post-prompt/{path:path}` is hit on every real SignalWire call's post-prompt webhook. A 500 here means a lost call summary. Use per-project Basic Auth (already wired via `require_webhook_basic_auth` — copy that dependency module-for-module).
- Per-employee SWML mounts (`/swml/<id>`) and the wizard mount (`/swml/wizard`) currently happen at **module import time** in `main.py` (line 2085). In `agent.app:app` they need to happen in lifespan startup so test/import doesn't have the side effect.
- The credentials file write at `main.py:2095–2112` also happens at import time. Move into lifespan startup. If `web/agent-credentials.json` is missing for even one request, the Node SWML proxy fails its BasicAuth check.

### Task sketches

- [ ] **E.1:** Create `agent/routes/post_prompt.py`. Lift `proxy_post_prompt` and `require_webhook_basic_auth` verbatim. Mount on `agent/app.py`.
- [ ] **E.2:** Side-by-side parity test: spin up both `agent.main:app` and `agent.app:app`, POST the same authed payload to both, assert identical 200 responses.
- [ ] **E.3:** Modify `agent/app.py` `lifespan` to:
  1. Run DB migrations (already in place).
  2. Instantiate `WizardAgent`, mount via `AgentRegistry.mount_agent(_app, "wizard", wizard)`.
  3. Read every persisted employee from `web/data/sally_sales.db` and re-mount its router (currently `main.py` does NOT do this — it relies on the frontend POSTing `/api/create-employee` on startup to recreate state; verify whether the new `agent.app` should preserve that behavior or actively rehydrate from DB).
  4. Write `web/agent-credentials.json`.
- [ ] **E.4:** Feature-flag the cutover: `HIREWIRE_AGENT_APP_ENABLED=1`. When unset (default), `agent.main:app` keeps serving everything. When set, deploy switches to `agent.app:app`.
- [ ] **E.5:** Remove `/api/post-prompt` and the import-time wizard mount from `main.py`.

### Phase E Exit Criteria

- [ ] `agent.app:app` boots, mounts the wizard, writes the credentials file, and re-mounts every persisted employee's SWML router during lifespan startup.
- [ ] `/api/post-prompt` lives in `agent/routes/post_prompt.py`.
- [ ] `main.py` is now ~150 LOC — just leftover lifecycle stubs and the `__main__` block.
- [ ] One full deploy cycle has passed with `HIREWIRE_AGENT_APP_ENABLED=1` in staging.

---

## Phase F: Cutover + cleanup

## TODO before execution: flesh out tasks

### Task sketches

- [ ] **F.1:** Flip deploy entrypoint. Update `replit.md` (lines 76, 126), any `Procfile`, and the Replit run command from `agent.main:app` to `agent.app:app`.
- [ ] **F.2:** Replace `agent/main.py` body with a one-line shim:
  ```python
  """Backwards-compat shim — agent/main.py was retired in Phase F.

  The single FastAPI entry point is now agent/app.py.  This module re-exports
  `app` so any external scripts pinned to `agent.main:app` keep working until
  they migrate to `agent.app:app`.
  """
  from agent.app import app  # noqa: F401
  ```
  Also re-export `VirtualEmployeeAgent` and `_generate_sdk_code` from the same shim so the test suite doesn't break in one step.
- [ ] **F.3:** Update tests:
  - `agent/tests/test_post_prompt_auth.py:40` — change `import agent.main as m` to `import agent.app as m`.
  - `agent/tests/test_sdk_code_generator.py:20` — change `from agent.main import VirtualEmployeeAgent, _generate_sdk_code` to `from agent.lib.virtual_employee_agent import VirtualEmployeeAgent` and `from agent.lib.sdk_code import _generate_sdk_code`.
- [ ] **F.4:** Burn-in. Run for 1 week. Watch:
  - Sentry / logs for any "no such attribute" errors implicating the shim.
  - SignalWire call-quality dashboard — no regression in post-prompt success rate.
  - `web/agent-credentials.json` mtime — must be refreshed on each agent restart.
- [ ] **F.5:** After burn-in, delete `agent/main.py` entirely. Update the comment in `agent/sdk_code_templates.py:1` (`"""Code-string templates used by _generate_sdk_code in agent/main.py."""` → `"… in agent/lib/sdk_code.py."""`).

### Phase F Exit Criteria

- [ ] Deploy uses `agent.app:app`.
- [ ] `agent/main.py` deleted.
- [ ] No production references to `agent.main` remain anywhere — verify with `grep -rn "agent.main\|agent/main.py" /Users/jonny/Library/Mobile Documents/com~apple~CloudDocs/CLOUD-CLAUDE/HireWire-AI/` returning zero non-historical hits.

---

## Test strategy across the whole plan

- Phase A through B: existing unit tests (`agent/tests/test_*.py`) are the safety net. They import from `agent.main` — keep re-exports in place so they pass unchanged until Phase F.
- Phase C through E: every newly-created route gets a **side-by-side parity test** that POSTs the same payload to `agent.main:app` and `agent.app:app` using `TestClient`, then asserts identical JSON. This catches behavioral drift early.
- Phase E: add a load-shedding canary in staging. Run for 24h with `HIREWIRE_AGENT_APP_ENABLED=1` before flipping production.
- Phase F: post-cutover, the parity tests are deleted (only one app remains).

## Files added / modified summary (planned end-state)

```
agent/
├── app.py                                # MODIFIED (Phase E)  ~200 LOC
├── main.py                               # DELETED (Phase F end)
├── lib/
│   ├── util.py                           # NEW (Phase A)       ~80 LOC
│   ├── agent_runtime.py                  # NEW (Phase A)       ~50 LOC
│   ├── virtual_employee_agent.py         # NEW (Phase B)       ~700 LOC
│   ├── wizard_agent.py                   # NEW (Phase B)       ~600 LOC
│   ├── sdk_code.py                       # NEW (Phase B)       ~200 LOC
│   ├── agent_registry.py                 # NEW (Phase C)       ~150 LOC
│   └── (existing modules unchanged)
├── routes/
│   ├── auth.py                           # unchanged
│   ├── employees.py                      # NEW (Phase C+D)     ~300 LOC
│   ├── agent_info.py                     # NEW (Phase C)       ~50 LOC
│   ├── post_prompt.py                    # NEW (Phase E)       ~80 LOC
│   └── health.py                         # NEW (Phase C)       ~20 LOC
└── tests/
    ├── test_util.py                      # NEW (Phase A)
    ├── test_agent_runtime.py             # NEW (Phase A)
    ├── test_agent_registry.py            # NEW (Phase C)
    ├── test_routes_employees.py          # NEW (Phase C+D)
    └── (existing tests — re-pointed in Phase F)
```

Net delta: `main.py` (-2137) + new modules (~2400). Slightly larger total LOC (decomposition costs a few imports + module boilerplate) but each file fits in one head's worth of context.

## Rollback strategy

- **Phase A–B:** Trivial — revert the commit. Old globals come back, re-exports vanish.
- **Phase C–D:** Revert the commit that removed the route from `main.py`. Both implementations coexist for a window precisely so rollback is one commit.
- **Phase E:** `HIREWIRE_AGENT_APP_ENABLED=0` flips back to `agent.main:app` without code changes. Keep the env-var path until Phase F is complete.
- **Phase F:** Restore `agent/main.py` from git history. The shim period (Phase F.2 through F.5) means production has known-good copies of the shim file for at least one week before deletion.

---

## Open questions / decisions to surface before Phase B begins

1. **Employee state hydration:** Today, employee configs live in two places: in-memory `employees` dict on `main.py`, and serialized to `web/data/sally_sales.db` by the Node web layer. The Python agent does NOT read employees from the DB on boot — it depends on the web layer to POST `/api/create-employee` to recreate state. **Decision needed:** when `agent/app.py` takes over in Phase E, should it actively rehydrate employees from SQLite? If yes, that's net-new behavior and gets its own task before Phase E ships. If no, the current cold-start dance stays unchanged.

2. **`agent_credentials` lifecycle:** The dict mutates at module import (line 125), again at lifespan startup (line 2097), and is read by both `/api/config` and `/api/agent-info`. Phase C must decide whether to expose it as `AgentRegistry.credentials` (mutable) or as a snapshot built once per request. Mutable matches today's behavior.

3. **Test isolation:** `agent/tests/test_post_prompt_auth.py:39-41` uses `importlib.reload(m)` to pick up env-var changes. If `agent.main` becomes a shim, the reload may not re-trigger lifespan startup. Verify behavior in Phase F.3 before deleting the test fixture.
