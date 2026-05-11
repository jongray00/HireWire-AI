"""Migration runner. Applies all unapplied SQL files in `migrations/` in order."""
from __future__ import annotations

import re
import sqlite3
import time
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"
_FILENAME_RE = re.compile(r"^(\d{3,})_[a-z0-9_]+\.sql$")


def _ensure_tracker_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
        )
        """
    )


def _applied_versions(conn: sqlite3.Connection) -> set[int]:
    rows = conn.execute("SELECT version FROM schema_migrations").fetchall()
    return {r["version"] for r in rows}


def _discover_migrations(directory: Path = MIGRATIONS_DIR) -> list[tuple[int, Path]]:
    out: list[tuple[int, Path]] = []
    for path in sorted(directory.glob("*.sql")):
        match = _FILENAME_RE.match(path.name)
        if not match:
            raise RuntimeError(f"migration filename does not match NNN_name.sql: {path.name}")
        out.append((int(match.group(1)), path))
    return out


def run_migrations(conn: sqlite3.Connection, *, directory: Path = MIGRATIONS_DIR) -> list[int]:
    """Apply all unapplied migrations. Returns the list of versions applied."""
    _ensure_tracker_table(conn)
    applied = _applied_versions(conn)
    newly_applied: list[int] = []
    for version, path in _discover_migrations(directory):
        if version in applied:
            continue
        sql = path.read_text(encoding="utf-8")
        # Run as a single batch; SQLite executescript implicitly commits.
        conn.executescript(sql)
        conn.execute(
            "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
            (version, int(time.time())),
        )
        newly_applied.append(version)
    return newly_applied
