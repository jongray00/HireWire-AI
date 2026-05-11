"""One-shot encryption-key rotation.

USAGE:
    OLD_ENCRYPTION_KEY=<old-b64> NEW_ENCRYPTION_KEY=<new-b64> DATA_DIR=/path/to/data \
        python scripts/rotate_encryption_key.py [--dry-run]

Decrypts every BLOB column with the old key and re-encrypts with the new key,
all inside a single transaction. Run with --dry-run first.

After successful run: update ENCRYPTION_KEY in your deploy environment to NEW.
"""
import os
import sys
import base64
import argparse
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# Mirror agent.lib.crypto wire format
VERSION_BYTE = 0x01
NONCE_LEN = 12

# Every (table, column) pair that holds AES-GCM-256 encrypted bytes.
# Update this list whenever a new encrypted column is added.
# Cross-reference: agent/migrations/001_initial_schema.sql,
#                  agent/migrations/002_projects.sql (DROPs + recreates projects).
ENCRYPTED_COLUMNS = [
    ("projects", "signalwire_api_token_enc"),
    ("projects", "webhook_basic_auth_pwd_enc"),
    ("calls", "transcript_enc"),
    ("calls", "summary_enc"),
    ("customers", "name_enc"),
    ("customers", "email_enc"),
    ("customers", "notes_enc"),
]


def _decrypt(key: bytes, blob: bytes) -> bytes:
    if not blob:
        return blob
    aesgcm = AESGCM(key)
    nonce = blob[1 : 1 + NONCE_LEN]
    ct = blob[1 + NONCE_LEN :]
    return aesgcm.decrypt(nonce, ct, associated_data=None)


def _encrypt(key: bytes, plaintext: bytes) -> bytes:
    if not plaintext:
        return plaintext
    aesgcm = AESGCM(key)
    nonce = os.urandom(NONCE_LEN)
    return bytes([VERSION_BYTE]) + nonce + aesgcm.encrypt(nonce, plaintext, associated_data=None)


def rotate(db_path: Path, old_key: bytes, new_key: bytes, dry_run: bool) -> None:
    import sqlite3
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        conn.execute("BEGIN IMMEDIATE")
        for table, column in ENCRYPTED_COLUMNS:
            rows = conn.execute(f"SELECT rowid, {column} FROM {table} WHERE {column} IS NOT NULL").fetchall()
            print(f"  {table}.{column}: {len(rows)} rows")
            for rowid, blob in rows:
                if not blob:
                    continue
                plaintext = _decrypt(old_key, blob)
                new_blob = _encrypt(new_key, plaintext)
                if not dry_run:
                    conn.execute(f"UPDATE {table} SET {column} = ? WHERE rowid = ?", (new_blob, rowid))
        if dry_run:
            conn.execute("ROLLBACK")
            print("DRY RUN — rolled back.")
        else:
            conn.execute("COMMIT")
            print("Rotation committed.")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--db-path", type=Path, default=None,
                        help="Override DB path (defaults to $DATA_DIR/hirewire.db)")
    args = parser.parse_args()

    old_b64 = os.environ.get("OLD_ENCRYPTION_KEY")
    new_b64 = os.environ.get("NEW_ENCRYPTION_KEY")
    if not old_b64 or not new_b64:
        print("FATAL: OLD_ENCRYPTION_KEY and NEW_ENCRYPTION_KEY must be set", file=sys.stderr)
        sys.exit(78)

    old_key = base64.b64decode(old_b64, validate=True)
    new_key = base64.b64decode(new_b64, validate=True)
    if len(old_key) != 32 or len(new_key) != 32:
        print("FATAL: both keys must decode to exactly 32 bytes", file=sys.stderr)
        sys.exit(78)
    if old_key == new_key:
        print("FATAL: NEW key must differ from OLD key", file=sys.stderr)
        sys.exit(78)

    if args.db_path:
        db_path = args.db_path
    else:
        data_dir = os.environ.get("DATA_DIR")
        if not data_dir:
            print("FATAL: DATA_DIR (or --db-path) must be set", file=sys.stderr)
            sys.exit(78)
        db_path = Path(data_dir) / "hirewire.db"

    print(f"DB: {db_path}")
    print(f"Dry run: {args.dry_run}")
    rotate(db_path, old_key, new_key, args.dry_run)


if __name__ == "__main__":
    main()
