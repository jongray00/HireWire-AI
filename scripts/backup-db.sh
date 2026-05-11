#!/usr/bin/env bash
# Snapshot hirewire.db safely using sqlite3 .backup (online backup API).
# Output: timestamped .db file alongside any existing snapshots.
#
# USAGE:
#   DATA_DIR=/path/to/data BACKUP_DIR=/path/to/backups ./scripts/backup-db.sh
#
# Recommended cron entry: every hour, retain 24 hourly + 7 daily + 4 weekly
#   0 * * * * /opt/hirewire/scripts/backup-db.sh >> /var/log/hirewire-backup.log 2>&1
set -euo pipefail

DATA_DIR="${DATA_DIR:?DATA_DIR not set}"
BACKUP_DIR="${BACKUP_DIR:?BACKUP_DIR not set}"
SOURCE="${DATA_DIR}/hirewire.db"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${BACKUP_DIR}/hirewire-${TS}.db"

if [[ ! -f "$SOURCE" ]]; then
  echo "FATAL: source DB not found at $SOURCE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# .backup is atomic and survives concurrent writers (uses SQLite's online backup API)
sqlite3 "$SOURCE" ".backup '$DEST'"

# Verify integrity
if ! sqlite3 "$DEST" "PRAGMA integrity_check;" | grep -q "^ok$"; then
  echo "FATAL: integrity check failed on $DEST" >&2
  exit 2
fi

chmod 600 "$DEST"

# Optional: prune anything older than RETAIN_DAYS (default 30 days)
RETAIN_DAYS="${RETAIN_DAYS:-30}"
find "$BACKUP_DIR" -maxdepth 1 -name "hirewire-*.db" -type f -mtime "+${RETAIN_DAYS}" -delete || true

echo "OK $DEST ($(stat -f%z "$DEST" 2>/dev/null || stat -c%s "$DEST") bytes)"
