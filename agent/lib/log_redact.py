"""Redact sensitive fields from structured-log event dicts."""
from __future__ import annotations

import re
from typing import Any

_REDACT_KEYS = {"auth_token", "password", "bearer", "api_key", "secret", "token", "authorization"}
_PHONE_KEYS = {"caller_number", "phone_number", "from_number", "to_number"}
_BLOB_KEYS = {"transcript", "summary", "notes", "auth_token_enc", "config_json"}
_EMAIL_KEYS = {"email", "from_email", "to_email"}

_EMAIL_RE = re.compile(r"^([^@])[^@]*(@)[^.]*(\..+)$")


def _mask_phone(value: Any) -> str:
    s = str(value or "")
    if len(s) <= 4:
        return "+****"
    return "+****" + s[-4:]


def _mask_email(value: Any) -> str:
    m = _EMAIL_RE.match(str(value or ""))
    if not m:
        return "<redacted>"
    return f"{m.group(1)}****{m.group(2)}****{m.group(3)}"


def _redact_value(key: str, value: Any) -> Any:
    key_l = key.lower()
    if key_l in _REDACT_KEYS:
        return "<redacted>"
    if key_l in _PHONE_KEYS:
        return _mask_phone(value)
    if key_l in _EMAIL_KEYS:
        return _mask_email(value)
    if key_l in _BLOB_KEYS:
        try:
            n = len(value) if value is not None else 0
        except TypeError:
            n = 0
        return f"<encrypted, {n} bytes>"
    if isinstance(value, dict):
        return {k: _redact_value(k, v) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact_value(key, v) for v in value]
    return value


def redact_event_dict(_logger, _name, event_dict: dict[str, Any]) -> dict[str, Any]:
    """structlog processor signature."""
    return {k: _redact_value(k, v) for k, v in event_dict.items()}
