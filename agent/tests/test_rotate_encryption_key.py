"""Tests for scripts/rotate_encryption_key.py.

Seeds a fresh SQLite DB with rows encrypted under key A, runs the rotation
helpers with old=A, new=B, and asserts every column re-encrypts cleanly.
"""
from __future__ import annotations

import importlib.util
import os
import sqlite3
import sys
from pathlib import Path

import pytest
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


# --------- Load the rotation script as a module ---------

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "rotate_encryption_key.py"


def _load_rotation_module():
    spec = importlib.util.spec_from_file_location("rotate_encryption_key", SCRIPT_PATH)
    assert spec and spec.loader, f"cannot load {SCRIPT_PATH}"
    module = importlib.util.module_from_spec(spec)
    sys.modules["rotate_encryption_key"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def rotation():
    return _load_rotation_module()


# --------- Helpers ---------

VERSION_BYTE = 0x01
NONCE_LEN = 12


def _seed_encrypt(key: bytes, plaintext: bytes) -> bytes:
    """Encrypt a value with key, mirroring agent.lib.crypto wire format."""
    aesgcm = AESGCM(key)
    nonce = os.urandom(NONCE_LEN)
    return bytes([VERSION_BYTE]) + nonce + aesgcm.encrypt(nonce, plaintext, associated_data=None)


def _seed_decrypt(key: bytes, blob: bytes) -> bytes:
    aesgcm = AESGCM(key)
    nonce = blob[1 : 1 + NONCE_LEN]
    ct = blob[1 + NONCE_LEN :]
    return aesgcm.decrypt(nonce, ct, associated_data=None)


def _create_schema(conn: sqlite3.Connection) -> None:
    """Create just enough schema for the encrypted columns the rotation touches.

    Mirrors agent/migrations/001 + 002 for the columns ENCRYPTED_COLUMNS covers.
    """
    conn.executescript(
        """
        CREATE TABLE projects (
          id                          TEXT PRIMARY KEY,
          space_url                   TEXT NOT NULL,
          signalwire_project_id       TEXT NOT NULL,
          signalwire_api_token_enc    BLOB NOT NULL,
          webhook_basic_auth_user     TEXT NOT NULL,
          webhook_basic_auth_pwd_enc  BLOB NOT NULL,
          created_at                  INTEGER NOT NULL,
          updated_at                  INTEGER NOT NULL
        );
        CREATE TABLE calls (
          id              TEXT PRIMARY KEY,
          project_id      TEXT NOT NULL,
          started_at      INTEGER NOT NULL,
          status          TEXT NOT NULL,
          transcript_enc  BLOB,
          summary_enc     BLOB
        );
        CREATE TABLE customers (
          id           TEXT PRIMARY KEY,
          project_id   TEXT NOT NULL,
          phone_number TEXT,
          name_enc     BLOB,
          email_enc    BLOB,
          notes_enc    BLOB,
          created_at   INTEGER NOT NULL,
          updated_at   INTEGER NOT NULL
        );
        """
    )


# A representative plaintext per encrypted column. Includes empty/None cases.
SEED_DATA = {
    ("projects", "signalwire_api_token_enc"): b"PT-token-abcdef",
    ("projects", "webhook_basic_auth_pwd_enc"): b"hunter2-the-sequel",
    ("calls", "transcript_enc"): b"caller: hello\nagent: how can I help?",
    ("calls", "summary_enc"): b"caller asked about pricing",
    ("customers", "name_enc"): b"Jane Doe",
    ("customers", "email_enc"): b"jane@example.com",
    ("customers", "notes_enc"): b"VIP -- escalate if unhappy",
}


def _seed_rows(conn: sqlite3.Connection, key: bytes) -> None:
    # projects: one row with both encrypted columns
    conn.execute(
        "INSERT INTO projects (id, space_url, signalwire_project_id, "
        "signalwire_api_token_enc, webhook_basic_auth_user, webhook_basic_auth_pwd_enc, "
        "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "proj-1",
            "acme.signalwire.com",
            "sw-proj-1",
            _seed_encrypt(key, SEED_DATA[("projects", "signalwire_api_token_enc")]),
            "proj_abcd1234",
            _seed_encrypt(key, SEED_DATA[("projects", "webhook_basic_auth_pwd_enc")]),
            1000,
            1000,
        ),
    )
    # calls: one row with both encrypted columns, one with only transcript, one with no encrypted data
    conn.execute(
        "INSERT INTO calls (id, project_id, started_at, status, transcript_enc, summary_enc) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (
            "call-1",
            "proj-1",
            1000,
            "completed",
            _seed_encrypt(key, SEED_DATA[("calls", "transcript_enc")]),
            _seed_encrypt(key, SEED_DATA[("calls", "summary_enc")]),
        ),
    )
    conn.execute(
        "INSERT INTO calls (id, project_id, started_at, status, transcript_enc, summary_enc) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (
            "call-2",
            "proj-1",
            1001,
            "completed",
            _seed_encrypt(key, SEED_DATA[("calls", "transcript_enc")]),
            None,
        ),
    )
    conn.execute(
        "INSERT INTO calls (id, project_id, started_at, status, transcript_enc, summary_enc) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        ("call-3", "proj-1", 1002, "no-answer", None, None),
    )
    # customers: one fully populated row
    conn.execute(
        "INSERT INTO customers (id, project_id, phone_number, name_enc, email_enc, notes_enc, "
        "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "cust-1",
            "proj-1",
            "+15551234567",
            _seed_encrypt(key, SEED_DATA[("customers", "name_enc")]),
            _seed_encrypt(key, SEED_DATA[("customers", "email_enc")]),
            _seed_encrypt(key, SEED_DATA[("customers", "notes_enc")]),
            1000,
            1000,
        ),
    )
    conn.commit()


@pytest.fixture
def keys():
    """Two distinct 32-byte keys."""
    return AESGCM.generate_key(bit_length=256), AESGCM.generate_key(bit_length=256)


@pytest.fixture
def seeded_db(tmp_path, keys):
    """A fresh SQLite DB with rows encrypted under key A (keys[0])."""
    key_a, _key_b = keys
    db_path = tmp_path / "hirewire.db"
    conn = sqlite3.connect(str(db_path))
    try:
        _create_schema(conn)
        _seed_rows(conn, key_a)
    finally:
        conn.close()
    return db_path


# --------- Tests ---------

def test_encrypted_columns_list_matches_runbook(rotation):
    """The script's ENCRYPTED_COLUMNS must match the documented set."""
    assert set(rotation.ENCRYPTED_COLUMNS) == {
        ("projects", "signalwire_api_token_enc"),
        ("projects", "webhook_basic_auth_pwd_enc"),
        ("calls", "transcript_enc"),
        ("calls", "summary_enc"),
        ("customers", "name_enc"),
        ("customers", "email_enc"),
        ("customers", "notes_enc"),
    }


def test_dry_run_leaves_db_unchanged(rotation, seeded_db, keys):
    key_a, key_b = keys

    conn = sqlite3.connect(str(seeded_db))
    before = {}
    for table, column in rotation.ENCRYPTED_COLUMNS:
        before[(table, column)] = conn.execute(
            f"SELECT rowid, {column} FROM {table} ORDER BY rowid"
        ).fetchall()
    conn.close()

    rotation.rotate(seeded_db, key_a, key_b, dry_run=True)

    conn = sqlite3.connect(str(seeded_db))
    try:
        for table, column in rotation.ENCRYPTED_COLUMNS:
            after = conn.execute(
                f"SELECT rowid, {column} FROM {table} ORDER BY rowid"
            ).fetchall()
            assert after == before[(table, column)], f"{table}.{column} changed during dry run"
    finally:
        conn.close()


def test_rotation_rewrites_every_blob_under_new_key(rotation, seeded_db, keys):
    key_a, key_b = keys

    rotation.rotate(seeded_db, key_a, key_b, dry_run=False)

    conn = sqlite3.connect(str(seeded_db))
    try:
        for table, column in rotation.ENCRYPTED_COLUMNS:
            rows = conn.execute(
                f"SELECT rowid, {column} FROM {table} WHERE {column} IS NOT NULL"
            ).fetchall()
            assert rows, f"expected at least one encrypted row in {table}.{column}"
            for rowid, blob in rows:
                # Decrypts under new key
                plaintext = _seed_decrypt(key_b, blob)
                assert plaintext == SEED_DATA[(table, column)], (
                    f"{table}.{column} rowid={rowid} plaintext mismatch"
                )
                # Decrypts under old key now fail
                with pytest.raises(InvalidTag):
                    _seed_decrypt(key_a, blob)
    finally:
        conn.close()


def test_rotation_preserves_null_rows(rotation, seeded_db, keys):
    """Rows with NULL encrypted columns must remain NULL after rotation."""
    key_a, key_b = keys
    rotation.rotate(seeded_db, key_a, key_b, dry_run=False)

    conn = sqlite3.connect(str(seeded_db))
    try:
        # call-3 had no encrypted data
        row = conn.execute(
            "SELECT transcript_enc, summary_enc FROM calls WHERE id = 'call-3'"
        ).fetchone()
        assert row == (None, None)
        # call-2 had only transcript
        row = conn.execute(
            "SELECT summary_enc FROM calls WHERE id = 'call-2'"
        ).fetchone()
        assert row[0] is None
    finally:
        conn.close()


def test_rotation_rollback_on_bad_key(rotation, seeded_db, keys):
    """If the OLD key is wrong, the transaction rolls back and the DB is unchanged."""
    _key_a, key_b = keys
    bad_old = AESGCM.generate_key(bit_length=256)  # not the one used to seed

    conn = sqlite3.connect(str(seeded_db))
    before = conn.execute(
        "SELECT rowid, signalwire_api_token_enc FROM projects ORDER BY rowid"
    ).fetchall()
    conn.close()

    with pytest.raises(InvalidTag):
        rotation.rotate(seeded_db, bad_old, key_b, dry_run=False)

    conn = sqlite3.connect(str(seeded_db))
    try:
        after = conn.execute(
            "SELECT rowid, signalwire_api_token_enc FROM projects ORDER BY rowid"
        ).fetchall()
        assert after == before, "DB was modified despite rotation failure"
    finally:
        conn.close()


def test_encrypt_then_decrypt_module_helpers_roundtrip(rotation):
    key = AESGCM.generate_key(bit_length=256)
    blob = rotation._encrypt(key, b"hello")
    assert blob[0] == VERSION_BYTE
    assert rotation._decrypt(key, blob) == b"hello"


def test_encrypt_empty_returns_empty(rotation):
    """Matches the script's contract: empty plaintext short-circuits."""
    key = AESGCM.generate_key(bit_length=256)
    assert rotation._encrypt(key, b"") == b""
