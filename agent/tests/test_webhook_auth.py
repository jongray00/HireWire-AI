import base64
import sqlite3
import time

import pytest

from agent.lib import crypto
from agent.lib.db import open_connection
from agent.lib.migrate import run_migrations
from agent.lib.webhook_auth import (
    WebhookAuthError,
    verify_webhook_basic_auth,
    parse_basic_auth_header,
)


def _seed(db_path):
    conn = open_connection(db_path)
    run_migrations(conn)
    now = int(time.time())
    conn.execute(
        "INSERT INTO projects (id, space_url, signalwire_project_id, "
        "signalwire_api_token_enc, webhook_basic_auth_user, "
        "webhook_basic_auth_pwd_enc, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "uuid-1",
            "acme.signalwire.com",
            "sw-proj-1",
            crypto.encrypt("api-token"),
            "proj_abcd1234",
            crypto.encrypt("webhook-secret-pw"),
            now,
            now,
        ),
    )
    conn.commit()
    return conn


def _header(user, pw):
    return "Basic " + base64.b64encode(f"{user}:{pw}".encode()).decode()


def test_parse_basic_auth_header():
    user, pw = parse_basic_auth_header(_header("u", "p"))
    assert user == "u" and pw == "p"


def test_parse_rejects_non_basic_scheme():
    with pytest.raises(WebhookAuthError, match="scheme"):
        parse_basic_auth_header("Bearer xyz")


def test_parse_rejects_malformed_base64():
    with pytest.raises(WebhookAuthError):
        parse_basic_auth_header("Basic !!!not-base64!!!")


def test_valid_basic_auth_passes(tmp_path):
    conn = _seed(tmp_path / "hirewire.db")
    scope = verify_webhook_basic_auth(
        conn, authorization=_header("proj_abcd1234", "webhook-secret-pw")
    )
    assert scope.project_id == "uuid-1"
    assert scope.signalwire_project_id == "sw-proj-1"


def test_bad_password_raises(tmp_path):
    conn = _seed(tmp_path / "hirewire.db")
    with pytest.raises(WebhookAuthError, match="credentials"):
        verify_webhook_basic_auth(
            conn, authorization=_header("proj_abcd1234", "wrong-pw")
        )


def test_unknown_username_raises(tmp_path):
    conn = _seed(tmp_path / "hirewire.db")
    with pytest.raises(WebhookAuthError, match="credentials"):
        verify_webhook_basic_auth(
            conn, authorization=_header("proj_unknown_x", "webhook-secret-pw")
        )


def test_missing_authorization_raises(tmp_path):
    conn = _seed(tmp_path / "hirewire.db")
    with pytest.raises(WebhookAuthError, match="missing"):
        verify_webhook_basic_auth(conn, authorization=None)
