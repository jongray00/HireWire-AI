"""Validate SignalWire project credentials via Relay REST API.

Spec §Flow A step 4: web layer POSTs creds to agent; agent calls SignalWire
with HTTP Basic Auth (project_id:api_token); 200 => valid, 401/403 => invalid,
anything else => unreachable / retry later.
"""
from __future__ import annotations

import re
from typing import Any

import httpx

_HOST_RE = re.compile(r"^[A-Za-z0-9.-]+\.signalwire\.com$")
_TIMEOUT_SECS = 10.0


class SignalWireAuthError(RuntimeError):
    """Credentials rejected by SignalWire (401/403)."""


class SignalWireUnreachable(RuntimeError):
    """Transient failure — user should retry."""


async def validate_credentials(
    *, signalwire_project_id: str, api_token: str, space_url: str
) -> dict[str, Any]:
    """Returns {"display_name": str|None} on success; raises otherwise."""
    if not _HOST_RE.match(space_url):
        raise ValueError(f"space_url must match *.signalwire.com (got {space_url!r})")
    if not signalwire_project_id or not api_token:
        raise ValueError("signalwire_project_id and api_token must be non-empty")

    url = f"https://{space_url}/api/relay/rest/projects/{signalwire_project_id}"
    auth = httpx.BasicAuth(signalwire_project_id, api_token)
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECS) as client:
            resp = await client.get(url, auth=auth)
    except httpx.HTTPError as exc:
        raise SignalWireUnreachable(str(exc)) from exc

    if resp.status_code == 200:
        try:
            data = resp.json()
        except Exception:
            data = {}
        return {"display_name": data.get("name")}
    if resp.status_code in (401, 403):
        raise SignalWireAuthError(f"signalwire rejected credentials ({resp.status_code})")
    raise SignalWireUnreachable(f"unexpected status {resp.status_code}")
