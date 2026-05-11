"""Test that /api/post-prompt requires per-project Basic Auth."""
import base64
import time

import pytest
from fastapi.testclient import TestClient

from agent.lib import crypto
from agent.lib.db import open_connection
from agent.lib.migrate import run_migrations


def _basic(user, pw):
    return "Basic " + base64.b64encode(f"{user}:{pw}".encode()).decode()


def _seed(db_path):
    conn = open_connection(db_path)
    run_migrations(conn)
    now = int(time.time())
    conn.execute(
        "INSERT INTO projects (id, space_url, signalwire_project_id, "
        "signalwire_api_token_enc, webhook_basic_auth_user, "
        "webhook_basic_auth_pwd_enc, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ("p1", "acme.signalwire.com", "sw-1",
         crypto.encrypt("t"), "proj_wh_user", crypto.encrypt("wh-pw"),
         now, now),
    )
    conn.commit()
    conn.close()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    _seed(tmp_path / "hirewire.db")
    # Import after env is set so Config.load picks up DATA_DIR
    import importlib
    import agent.main as m
    importlib.reload(m)
    return TestClient(m.app)


def test_post_prompt_rejects_missing_auth(client):
    resp = client.post("/api/post-prompt/something", json={})
    assert resp.status_code == 401
    assert "WWW-Authenticate" in resp.headers
    assert 'realm="HireWire"' in resp.headers["WWW-Authenticate"]


def test_post_prompt_rejects_bad_password(client):
    resp = client.post(
        "/api/post-prompt/something",
        headers={"Authorization": _basic("proj_wh_user", "wrong-pw")},
        json={},
    )
    assert resp.status_code == 401


def test_post_prompt_rejects_unknown_user(client):
    resp = client.post(
        "/api/post-prompt/something",
        headers={"Authorization": _basic("proj_unknown", "any-pw")},
        json={},
    )
    assert resp.status_code == 401
