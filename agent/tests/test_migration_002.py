import sqlite3

import pytest

from agent.lib.db import open_connection
from agent.lib.migrate import run_migrations


def test_projects_table_created(tmp_path):
    conn = open_connection(tmp_path / "hirewire.db")
    run_migrations(conn)
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(projects)")}
    assert cols == {
        "id",
        "space_url",
        "signalwire_project_id",
        "signalwire_api_token_enc",
        "wizard_resource_id",
        "agent_resource_id",
        "webhook_basic_auth_user",
        "webhook_basic_auth_pwd_enc",
        "created_at",
        "updated_at",
    }


def test_projects_natural_key_unique(tmp_path):
    conn = open_connection(tmp_path / "hirewire.db")
    run_migrations(conn)
    conn.execute(
        "INSERT INTO projects (id, space_url, signalwire_project_id, "
        "signalwire_api_token_enc, webhook_basic_auth_user, webhook_basic_auth_pwd_enc, "
        "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ("uuid-a", "acme.signalwire.com", "sw-proj-1", b"\x00\x01", "proj_abcd1234", b"\x00\x02", 1, 1),
    )
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO projects (id, space_url, signalwire_project_id, "
            "signalwire_api_token_enc, webhook_basic_auth_user, webhook_basic_auth_pwd_enc, "
            "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ("uuid-b", "acme.signalwire.com", "sw-proj-1", b"\x00\x03", "proj_efgh5678", b"\x00\x04", 1, 1),
        )
