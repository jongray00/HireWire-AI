"""Per-project HTTP Basic Auth verification for SignalWire webhooks.

Spec §Flow C: SignalWire stores (user, password) per address resource.
On every webhook fire, we receive `Authorization: Basic base64(user:password)`,
look up the project by `webhook_basic_auth_user`, decrypt the stored password,
and constant-time-compare. On mismatch: 401 with
`WWW-Authenticate: Basic realm="HireWire"`.

Unified error message ("invalid_credentials") for unknown-user vs wrong-password
to avoid username enumeration.
"""
from __future__ import annotations

import base64
import hmac
import sqlite3
from dataclasses import dataclass

from agent.lib import crypto

WEBHOOK_REALM = "HireWire"


class WebhookAuthError(RuntimeError):
    """Auth failure — caller should respond 401 with WWW-Authenticate."""


@dataclass(frozen=True)
class WebhookScope:
    project_id: str
    signalwire_project_id: str
    space_url: str


def parse_basic_auth_header(authorization: str) -> tuple[str, str]:
    if not authorization.startswith("Basic "):
        raise WebhookAuthError("unsupported auth scheme")
    try:
        decoded = base64.b64decode(
            authorization[len("Basic "):].strip(), validate=True
        ).decode("utf-8")
    except Exception as exc:
        raise WebhookAuthError(f"malformed basic auth: {exc}") from exc
    if ":" not in decoded:
        raise WebhookAuthError("malformed basic auth payload")
    user, _, password = decoded.partition(":")
    return user, password


def verify_webhook_basic_auth(
    conn: sqlite3.Connection,
    *,
    authorization: str | None,
) -> WebhookScope:
    if not authorization:
        raise WebhookAuthError("missing Authorization header")

    user, presented = parse_basic_auth_header(authorization)
    row = conn.execute(
        "SELECT id, signalwire_project_id, space_url, webhook_basic_auth_pwd_enc "
        "FROM projects WHERE webhook_basic_auth_user = ?",
        (user,),
    ).fetchone()
    if row is None:
        # Constant-time-ish: still do a dummy compare to avoid user enumeration via timing
        hmac.compare_digest("aaaaaaaa", "bbbbbbbb")
        raise WebhookAuthError("invalid_credentials")

    expected = crypto.decrypt(row["webhook_basic_auth_pwd_enc"]).decode("utf-8")
    if not hmac.compare_digest(expected, presented):
        raise WebhookAuthError("invalid_credentials")

    return WebhookScope(
        project_id=row["id"],
        signalwire_project_id=row["signalwire_project_id"],
        space_url=row["space_url"],
    )
