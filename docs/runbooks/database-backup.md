# SQLite Database Backup Runbook

How to back up, restore, and ship off-site copies of `hirewire.db`.

---

## Why SQLite needs special handling

You **cannot** safely back up an active SQLite database with a naive
`cp` or `rsync`. While the agent is running:

- SQLite is in WAL mode (`PRAGMA journal_mode=WAL`, see `agent/lib/db.py`).
- The "database" on disk is actually three files: `hirewire.db`,
  `hirewire.db-wal`, and `hirewire.db-shm`.
- A `cp` of just `hirewire.db` can capture a write-ahead-log state that
  is internally inconsistent with the main file → silent corruption on
  restore.

The safe primitive is SQLite's **online backup API**, exposed via the
`sqlite3` CLI as `.backup`. It uses the same locking the engine uses
for normal queries and produces a single, internally consistent
`.db` file that includes any WAL state.

`scripts/backup-db.sh` wraps this for you.

---

## Setup

### Install location

Recommended layout on a production host:

```
/opt/hirewire/
  app/                   # checkout of this repo
  data/                  # DATA_DIR — contains hirewire.db
  backups/               # BACKUP_DIR — where snapshots land
  scripts/
    backup-db.sh         # symlinked from /opt/hirewire/app/scripts/
```

### Required env vars

| Var           | Required | Example                  | Notes                       |
|---------------|----------|--------------------------|-----------------------------|
| `DATA_DIR`    | yes      | `/opt/hirewire/data`     | Must contain `hirewire.db`. |
| `BACKUP_DIR`  | yes      | `/opt/hirewire/backups`  | Created if missing.         |
| `RETAIN_DAYS` | no       | `30` (default)           | Local retention window.     |

The script will fail-fast with `FATAL: DATA_DIR not set` if either
required var is missing.

### Permissions

The script `chmod 600`s every snapshot it writes. The `BACKUP_DIR`
itself should be `0700` and owned by the same user that runs
`hirewire-agent`. **Snapshots contain encrypted BLOBs but the rest of
the schema (project IDs, employee names, audit log) is plaintext** —
treat backup files with the same care you treat the live DB.

---

## Recommended schedule

A reasonable starting cadence is hourly local snapshots plus a daily
off-site ship. The script already handles local pruning.

```cron
# /etc/cron.d/hirewire-backup
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin

# Hourly local snapshot, keep last 30 days locally
0 * * * * hirewire DATA_DIR=/opt/hirewire/data BACKUP_DIR=/opt/hirewire/backups /opt/hirewire/scripts/backup-db.sh >> /var/log/hirewire-backup.log 2>&1

# Nightly off-site ship at 02:15 UTC (separate script — see "Off-site replication" below)
15 2 * * * hirewire /opt/hirewire/scripts/ship-backups.sh >> /var/log/hirewire-backup.log 2>&1
```

Retention guidance:

| Tier   | Frequency | Retention                          | Where |
|--------|-----------|------------------------------------|-------|
| Hourly | Every hour | 24 most recent (1 day rolling)    | Local disk |
| Daily  | 02:00 UTC  | 30 most recent (1 month rolling)  | Off-site object store |
| Weekly | Sunday     | 12 most recent (3 months)         | Off-site object store, separate prefix |
| Monthly | 1st of month | Indefinite (cold storage)       | Off-site cold tier |

You can adjust the `RETAIN_DAYS` env var to change local retention
without modifying the script. The cron above keeps `RETAIN_DAYS` at the
default 30; for hourly-only retention you'd set `RETAIN_DAYS=1`.

---

## Manual one-shot backup

```bash
DATA_DIR=/opt/hirewire/data \
BACKUP_DIR=/opt/hirewire/backups \
  /opt/hirewire/scripts/backup-db.sh
```

Expected output:

```
OK /opt/hirewire/backups/hirewire-20260511T143000Z.db (4194304 bytes)
```

Exit codes:

| Code | Meaning |
|------|---------|
| 0    | Backup succeeded and passed `PRAGMA integrity_check`. |
| 1    | Source DB not found at `${DATA_DIR}/hirewire.db`. |
| 2    | Integrity check failed on the snapshot. |
| *    | Anything else: `set -euo pipefail` caught a step (env var missing, `sqlite3` not on `PATH`, etc.). |

---

## Restore procedure

> **Restoring from a backup is a destructive operation.** It replaces
> the live database. Always confirm you have a *current* backup of the
> live state (even if you're rolling back) before you start.

1. **Stop the agent.**

   ```bash
   sudo systemctl stop hirewire-agent
   ```

   Verify no process holds `hirewire.db`:

   ```bash
   sudo lsof /opt/hirewire/data/hirewire.db 2>/dev/null || echo "no holders"
   ```

2. **Move the existing DB aside** (don't delete; keep as a safety net).

   ```bash
   sudo -u hirewire mv /opt/hirewire/data/hirewire.db /opt/hirewire/data/hirewire.db.preroll.$(date -u +%Y%m%dT%H%M%SZ)
   sudo -u hirewire rm -f /opt/hirewire/data/hirewire.db-wal /opt/hirewire/data/hirewire.db-shm
   ```

   The `-wal` / `-shm` files must go too — if they survive, SQLite will
   try to apply them to the restored main file at startup and corrupt
   it.

3. **Copy the snapshot in.**

   ```bash
   sudo -u hirewire cp /opt/hirewire/backups/hirewire-20260510T080000Z.db /opt/hirewire/data/hirewire.db
   sudo -u hirewire chmod 600 /opt/hirewire/data/hirewire.db
   ```

4. **Verify integrity** before bringing the agent up:

   ```bash
   sqlite3 /opt/hirewire/data/hirewire.db "PRAGMA integrity_check;"
   # expect: ok
   ```

5. **Confirm the encryption key matches the snapshot.** A backup is
   only useful with the `ENCRYPTION_KEY` that was active at the time
   the snapshot was taken. If you've rotated keys since then, you must
   either:

   - Restore with the OLD `ENCRYPTION_KEY` (you kept it, right?), or
   - Run `scripts/rotate_encryption_key.py` against the restored DB to
     bring it forward to the current key (see
     `encryption-key-rotation.md`).

   Quick check — try to decrypt one row:

   ```bash
   DATA_DIR=/opt/hirewire/data ENCRYPTION_KEY='<key-from-snapshot-era>' \
     python -c "
   import sqlite3
   from agent.lib.crypto import decrypt
   row = sqlite3.connect('/opt/hirewire/data/hirewire.db').execute(
       'SELECT transcript_enc FROM calls WHERE transcript_enc IS NOT NULL LIMIT 1'
   ).fetchone()
   if row: print('decrypt OK,', len(decrypt(row[0])), 'bytes plaintext')
   else: print('no encrypted rows to test')
   "
   ```

6. **Start the agent.**

   ```bash
   sudo systemctl start hirewire-agent
   sudo journalctl -u hirewire-agent -f
   ```

7. **Smoke test.** Place a test call, hit the dashboard, confirm
   webhook auth still works.

8. **Once stable**, remove the `.preroll.*` file you set aside in
   step 2.

---

## Encryption note (READ THIS)

**The BLOB columns in `hirewire.db` are AES-GCM-encrypted using
`ENCRYPTION_KEY`.** A backup file by itself is useless without the key.
This is a feature, not a bug — but it has operational implications:

- **Store the key separately from the backups.** If your backups
  bucket and your secrets manager are both compromised together, the
  attacker has plaintext data. Put the key in a different trust domain
  (different KMS, different cloud account, different vendor).
- **Rotate the key independently of backups.** See
  `encryption-key-rotation.md`. After rotation, every existing backup
  is locked to the **OLD** key. Either:
  - Keep the OLD key archived for the lifetime of the OLD backups, or
  - Re-snapshot under the new key and let OLD backups expire.
- **Audit who can read the key.** Treat read-access to `ENCRYPTION_KEY`
  as equivalent to read-access to all encrypted columns in production.
- **Never log the key.** `agent/lib/log_redact.py` already redacts
  encrypted blobs from logs — don't loosen those rules.

Non-encrypted columns (project IDs, employee names, phone numbers,
audit log metadata) are stored in plaintext in `hirewire.db`. Backups
are sensitive even without the encryption key. Encrypt-at-rest on the
backup target is still required.

---

## Off-site replication

The included `scripts/backup-db.sh` is local-only. Ship snapshots
off-site with a second cron job. Two recommended patterns:

### Pattern 1: `aws s3 sync` to S3 with server-side encryption

```bash
#!/usr/bin/env bash
# /opt/hirewire/scripts/ship-backups.sh
set -euo pipefail
aws s3 sync /opt/hirewire/backups/ s3://hirewire-prod-backups/$(hostname)/ \
  --exclude '*' --include 'hirewire-*.db' \
  --sse aws:kms --sse-kms-key-id alias/hirewire-backups \
  --storage-class STANDARD_IA
```

Bucket should have:
- `BlockPublicAccess` fully enabled.
- A lifecycle policy: STANDARD_IA after 30 days → GLACIER after 90.
- Server-side KMS encryption with a CMK you control (so AWS account
  access alone doesn't grant data access).
- Versioning + MFA-delete if you're paranoid (recommended).

### Pattern 2: `rclone` to any object store

```bash
rclone copy /opt/hirewire/backups remote:hirewire-prod-backups/$(hostname) \
  --include 'hirewire-*.db' --transfers 4 --checksum
```

### Verifying off-site copies are healthy

Once a week, pull one random snapshot from the off-site store, run
`PRAGMA integrity_check`, and decrypt a sample row with the era-appropriate
key. A backup you've never tested is not a backup.

---

## Cross-references

- `encryption-key-rotation.md` — pairs with backups; you need a fresh
  backup before any rotation and you need the key to read any backup.
- `scripts/backup-db.sh` — the snapshot script.
- `scripts/rotate_encryption_key.py` — the rotation script.
- `agent/lib/db.py` — connection / WAL configuration.
- `agent/lib/crypto.py` — encryption wire format.
