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
