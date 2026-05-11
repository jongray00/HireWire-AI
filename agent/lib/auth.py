"""Shared-secret auth for web -> agent internal API.

Spec §Flow B: the web layer is the single privileged client. Every internal
endpoint requires `X-Agent-API-Key` (constant-time-compared against
AGENT_API_KEY) and an `X-Project-Id` header that scopes the request.
"""
from __future__ import annotations

import hmac
import os
from dataclasses import dataclass

from fastapi import Header, HTTPException


@dataclass(frozen=True)
class ProjectScope:
    project_id: str


def _expected_key() -> str:
    key = os.environ.get("AGENT_API_KEY")
    if not key:
        # Fail closed — never let a missing shared secret default to "accept anything"
        raise HTTPException(status_code=500, detail="AGENT_API_KEY not configured")
    return key


def require_internal_auth(
    x_agent_api_key: str | None = Header(default=None),
    x_project_id: str | None = Header(default=None),
) -> ProjectScope:
    expected = _expected_key()
    if not x_agent_api_key:
        raise HTTPException(status_code=401, detail="missing_api_key")
    if not hmac.compare_digest(x_agent_api_key, expected):
        raise HTTPException(status_code=401, detail="invalid_api_key")
    if not x_project_id:
        raise HTTPException(status_code=400, detail="missing_project_id_header")
    return ProjectScope(project_id=x_project_id)


def require_api_key_only(
    x_agent_api_key: str | None = Header(default=None),
) -> None:
    """API-key-only variant for endpoints where no project exists yet (e.g. login).

    Spec §Flow A: the validate-credentials endpoint is called *before* the
    projects row is written, so X-Project-Id is not yet known.
    """
    expected = _expected_key()
    if not x_agent_api_key:
        raise HTTPException(status_code=401, detail="missing_api_key")
    if not hmac.compare_digest(x_agent_api_key, expected):
        raise HTTPException(status_code=401, detail="invalid_api_key")
