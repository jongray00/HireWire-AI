"""SQLite connection management. WAL mode, foreign keys on, busy timeout."""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


def open_connection(db_path: Path, *, read_only: bool = False) -> sqlite3.Connection:
    """Open a SQLite connection with hardened pragmas applied."""
    db_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if read_only:
        uri = f"file:{db_path}?mode=ro"
        conn = sqlite3.connect(uri, uri=True, isolation_level=None, check_same_thread=False)
    else:
        # Create file with 0o600 if new; chmod existing
        if not db_path.exists():
            db_path.touch(mode=0o600)
        else:
            os.chmod(db_path, 0o600)
        conn = sqlite3.connect(str(db_path), isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """Single-statement transaction with auto-rollback on exception."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
