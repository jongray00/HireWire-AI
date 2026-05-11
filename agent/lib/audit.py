"""Audit log writer.

The INSERT does not commit; it relies on the caller having an open
transaction (use ``db.transaction(conn)`` as the outer context). On bare
autocommit connections the row commits immediately, which defeats the
atomicity guarantee — wrap the surrounding operation in a transaction.
"""
from __future__ import annotations

import enum
import json
import sqlite3
import time
from typing import Any

_REDACT_KEYS = {
    "auth_token",
    "password",
    "bearer",
    "api_key",
    "secret",
    "token",
    "client_secret",
    "private_key",
    "refresh_token",
    "access_token",
    "authorization",
}
_MAX_METADATA_BYTES = 16 * 1024


class AuditAction(str, enum.Enum):
    LOGIN_SUCCESS = "login.success"
    LOGIN_FAIL = "login.fail"
    EMPLOYEE_CREATE = "employee.create"
    EMPLOYEE_UPDATE = "employee.update"
    EMPLOYEE_DELETE = "employee.delete"
    CREDS_DECRYPT = "creds.decrypt"
    SECRET_ACCESS = "secret.access"
    WEBHOOK_BAD_SIGNATURE = "webhook.bad_signature"
    WEBHOOK_STALE_TIMESTAMP = "webhook.stale_timestamp"
    AUTH_INVALID_TOKEN = "auth.invalid_token"
    PROJECT_DISABLED = "project.disabled"


def _safe_default(value: Any) -> str:
    if isinstance(value, (bytes, bytearray, memoryview)):
        return f"<binary len={len(value)}>"
    return str(value)


def _redact(metadata: dict[str, Any] | None) -> dict[str, Any]:
    if not metadata:
        return {}
    out: dict[str, Any] = {}
    for k, v in metadata.items():
        if k.lower() in _REDACT_KEYS:
            out[k] = "<redacted>"
        else:
            out[k] = v
    return out


def write_audit(
    conn: sqlite3.Connection,
    *,
    actor: str,
    action: AuditAction | str,
    project_id: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    redacted = _redact(metadata)
    payload = json.dumps(redacted, default=_safe_default)
    if len(payload) > _MAX_METADATA_BYTES:
        payload = json.dumps({"_truncated": True, "size": len(payload)})
    conn.execute(
        """
        INSERT INTO audit_log
          (project_id, actor, action, target_type, target_id, ip_address, user_agent, metadata_json, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            project_id,
            actor,
            action.value if isinstance(action, AuditAction) else action,
            target_type,
            target_id,
            ip_address,
            user_agent,
            payload,
            int(time.time()),
        ),
    )
