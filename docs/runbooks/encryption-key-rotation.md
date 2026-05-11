# ENCRYPTION_KEY Rotation Runbook

Production runbook for rotating the `ENCRYPTION_KEY` used by HireWire-AI to
encrypt sensitive BLOB columns at rest in SQLite.

---

## Background

HireWire-AI uses **AES-GCM-256** for field-level encryption of sensitive
columns. The on-disk wire format (see `agent/lib/crypto.py`) is:

```
+---------+---------------+----------------+---------+
| version |    nonce      |   ciphertext   |   tag   |
| 1 byte  |   12 bytes    |   N bytes      | 16 bytes|
+---------+---------------+----------------+---------+
   0x01
```

- The single `ENCRYPTION_KEY` is loaded from the environment by
  `agent.lib.config.Config.load()` (see `agent/lib/config.py`).
- It must be a **base64-encoded value that decodes to exactly 32 raw bytes**
  (256 bits).
- There is currently **no key-id rotation built into the wire format**:
  the version byte (`0x01`) is the only handle. A future version `0x02`
  could mean "this row was encrypted with the second key" but the current
  code only knows about `0x01`.
- `AESGCM` is cached for the process lifetime via `@lru_cache(maxsize=1)`;
  changing `ENCRYPTION_KEY` requires a process restart (or
  `crypto._reset_cache_for_tests()` in tests).

### Encrypted columns

These are the BLOB columns the rotation script must rewrite. The list is
mirrored in `scripts/rotate_encryption_key.py` as `ENCRYPTED_COLUMNS`.

| Table       | Column                       | Source migration |
|-------------|------------------------------|------------------|
| `projects`  | `signalwire_api_token_enc`   | 002              |
| `projects`  | `webhook_basic_auth_pwd_enc` | 002              |
| `calls`     | `transcript_enc`             | 001              |
| `calls`     | `summary_enc`                | 001              |
| `customers` | `name_enc`                   | 001              |
| `customers` | `email_enc`                  | 001              |
| `customers` | `notes_enc`                  | 001              |

> Note: migration `002_projects.sql` **drops and recreates** the `projects`
> table, replacing the Phase-1 `auth_token_enc` / `webhook_password_enc`
> columns with the Phase-2 names above. The Phase-1 columns do not exist
> in any production database.

If you add a new encrypted column, **also update `ENCRYPTED_COLUMNS`** in
`scripts/rotate_encryption_key.py` and add a corresponding case to the
rotation pytest.

---

## When to rotate

| Trigger              | Urgency  | Strategy |
|----------------------|----------|----------|
| Annual policy review | Planned  | A (big-bang) |
| Key compromise       | Critical | A (big-bang), immediate maintenance window |
| Personnel offboarding (had key access) | Planned | A (big-bang) |
| Infra migration / KMS swap | Planned | A (big-bang) |

---

## Strategy A: Big-bang re-encrypt (CURRENT BEST OPTION)

This is the only strategy currently supported end-to-end. It requires a
brief maintenance window but is simple and atomic.

### Prerequisites

- Access to the host (or container) running HireWire-AI.
- Both `OLD_ENCRYPTION_KEY` (currently in production) and a freshly
  generated `NEW_ENCRYPTION_KEY`.
- A fresh DB backup (see `database-backup.md`) taken **immediately**
  before rotation.

Generate a new key (32 random bytes, base64-encoded):

```bash
python -c "import base64, secrets; print(base64.b64encode(secrets.token_bytes(32)).decode())"
```

### Procedure

1. **Take a backup.** Run `scripts/backup-db.sh` (see `database-backup.md`).
   Copy the resulting `.db` file to a secure off-host location. **Verify
   you can decrypt at least one row** of the backup using `OLD_ENCRYPTION_KEY`
   before proceeding.

2. **Enter maintenance mode.** Drain traffic. Stop the agent process and
   any worker writing to `hirewire.db`:

   ```bash
   sudo systemctl stop hirewire-agent  # or docker stop / k8s scale-to-0
   ```

   Confirm no process holds the SQLite WAL by running `lsof` on
   `hirewire.db` (no output = safe to proceed).

3. **Dry run.** Verify the script reads every row cleanly without
   committing:

   ```bash
   OLD_ENCRYPTION_KEY='<old-b64>' \
   NEW_ENCRYPTION_KEY='<new-b64>' \
   DATA_DIR=/opt/hirewire/data \
     python scripts/rotate_encryption_key.py --dry-run
   ```

   You should see one line per encrypted column with a row count and
   `DRY RUN — rolled back.` at the end. Any error → STOP and investigate.

4. **Real rotation.** Re-run without `--dry-run`:

   ```bash
   OLD_ENCRYPTION_KEY='<old-b64>' \
   NEW_ENCRYPTION_KEY='<new-b64>' \
   DATA_DIR=/opt/hirewire/data \
     python scripts/rotate_encryption_key.py
   ```

   Expected output: per-column row counts followed by
   `Rotation committed.` The whole rewrite runs inside a single
   `BEGIN IMMEDIATE … COMMIT` transaction — partial writes are
   impossible.

5. **Update deploy secret.** Replace `ENCRYPTION_KEY` in your secrets
   manager / `.env` / k8s Secret / systemd EnvironmentFile with the
   **new** base64 value. Verify with a deploy preview that the new value
   has been propagated.

6. **Restart the app.**

   ```bash
   sudo systemctl start hirewire-agent
   ```

   Tail logs and watch for the startup banner. The first incoming call
   or webhook will exercise decrypt — if it fails, see **Rollback**.

7. **Verify.** Run the post-rotation checks in **Verification** below.

8. **Resume traffic.** Re-attach the load balancer / scale workers back up.

9. **Destroy the OLD key.** Once you have confidence the new key works
   (24h is a reasonable soak), securely destroy all copies of the OLD
   key. Anyone holding the OLD key can no longer read prod data, but if
   that copy plus a *pre-rotation backup* leaks together, the old data
   is compromised. Treat OLD key + OLD backups as a unit.

### Expected duration

For a DB with ~10 k calls + ~5 k customers + a handful of projects:
re-encryption is a few seconds. Maintenance window is dominated by
graceful drain + restart, typically **2–5 minutes**.

---

## Strategy B: Versioned-byte gradual rotation (FUTURE WORK)

Not currently supported. Documented here for design context.

### Sketch

1. Extend `agent/lib/crypto.py` so `Config` carries two keys
   (`encryption_key_current` and `encryption_key_previous`).
2. Add support for **version byte `0x02`** = "encrypted with current key".
   Existing `0x01` = "encrypted with previous key".
3. `encrypt()` always writes `0x02` using the current key.
4. `decrypt()` branches on the version byte and picks the appropriate
   `AESGCM` instance.
5. Background re-encrypt job walks every encrypted column and rewrites
   any `0x01` rows as `0x02` using the current key.
6. Once a row count of zero is observed for `0x01` rows across all
   tables, remove the previous key from config; the wire format
   permanently advances to `0x02`.

### Why this isn't built yet

- Operational complexity: requires a long-running rewrite worker,
  observability into progress, and a "are we done?" detector.
- The `lru_cache(maxsize=1)` in `crypto._get_aesgcm` would need to
  become a two-key cache keyed by version byte.
- The current dataset is small enough that Strategy A's window is
  acceptable. Re-evaluate when DB exceeds ~10 GB.

If you implement this: also extend `scripts/rotate_encryption_key.py`'s
test suite to cover the mixed-version-byte case and the "all rows now
0x02" cutover detection.

---

## Strategy C: Per-column re-encryption with feature flags

**Not recommended** unless Strategy A's maintenance window is genuinely
unacceptable.

The idea: rotate one column at a time, guarding each call site with a
feature flag that points encrypt/decrypt at the right key for that
column. Operationally messy because every code path that reads or
writes an encrypted column needs the flag, and the flag must be wired
through the connection cache + crypto module.

If you're considering this path, build Strategy B instead — versioned
wire format is strictly more general and roughly the same effort.

---

## Verification after rotation

Run these against the production DB **after restart with the new key**.
A successful response on any one of them confirms the new key works
for that table.

```bash
# 1. Agent process startup did not blow up
sudo systemctl status hirewire-agent | grep -E 'Active|FATAL'

# 2. Decrypt a sample project (uses webhook_auth.py path)
sqlite3 /opt/hirewire/data/hirewire.db \
  "SELECT id, length(signalwire_api_token_enc), length(webhook_basic_auth_pwd_enc) FROM projects LIMIT 5;"

# 3. Decrypt a sample call transcript via a Python one-liner
DATA_DIR=/opt/hirewire/data ENCRYPTION_KEY='<new-b64>' \
  python -c "
import sqlite3
from agent.lib.crypto import decrypt
conn = sqlite3.connect('/opt/hirewire/data/hirewire.db')
for row in conn.execute('SELECT id, transcript_enc FROM calls WHERE transcript_enc IS NOT NULL LIMIT 3'):
    plaintext = decrypt(row[1])
    print(row[0], len(plaintext), 'bytes plaintext')
"

# 4. Decrypt a sample customer record
DATA_DIR=/opt/hirewire/data ENCRYPTION_KEY='<new-b64>' \
  python -c "
import sqlite3
from agent.lib.crypto import decrypt
conn = sqlite3.connect('/opt/hirewire/data/hirewire.db')
for row in conn.execute('SELECT id, name_enc, email_enc FROM customers WHERE name_enc IS NOT NULL LIMIT 3'):
    print(row[0], decrypt(row[1]).decode(), decrypt(row[2]).decode() if row[2] else None)
"
```

End-to-end smoke: place a real test call against the agent and confirm
the resulting `transcript_enc` row decrypts cleanly with the new key.

---

## Rollback

### Mid-script failure

The rotation script wraps the entire rewrite in a single SQLite
`BEGIN IMMEDIATE` transaction. If `_decrypt()` raises (e.g. wrong OLD
key, corrupt blob), the script automatically `ROLLBACK`s before
exiting non-zero. The DB is byte-identical to its pre-script state.
Investigate the failing column, fix, retry.

### Script succeeded but app fails to start with NEW key

This usually means the deploy secret wasn't actually updated (the
process is still reading the old `ENCRYPTION_KEY`) or the new value
is malformed.

1. Check the running config: `ps eww $(pgrep -f hirewire-agent) | tr ' ' '\n' | grep ENCRYPTION_KEY`
2. Confirm the secrets manager / `.env` actually contains the new value.
3. Confirm the value decodes to 32 bytes:
   `echo "<value>" | base64 -d | wc -c` should print `32`.

### Script succeeded but production decrypts fail at runtime

Symptom: `CryptoError: decryption failed (tag mismatch or corrupted
ciphertext)` in logs on every call.

This means **the data is now encrypted with NEW but the app is reading
OLD** (or vice versa). Recovery:

1. **Stop the agent.**
2. **Revert `ENCRYPTION_KEY` to the OLD value** in your secrets manager.
3. **Restore the pre-rotation backup** (see `database-backup.md`)
   — this is why step 1 of the procedure is "take a backup".
4. Restart the agent. You are now back to the pre-rotation state.
5. Diagnose what went wrong before retrying.

### Lost the NEW key entirely

If you committed the rotation but no longer have the NEW key,
**the data is unrecoverable** unless you have a pre-rotation backup.
This is why you keep the OLD key + a pre-rotation backup together for
at least one soak period.

---

## Tests

The rotation script has a pytest at
`agent/tests/test_rotate_encryption_key.py`. To run:

```bash
uv run pytest agent/tests/test_rotate_encryption_key.py -v --no-cov
```

The test seeds a fresh DB with rows encrypted under key A, runs the
rotation script's `rotate()` function with `old=A, new=B`, and asserts:

- Every row decrypts cleanly under key B after rotation.
- Decrypts under key A now fail (with `InvalidTag`).
- The `--dry-run` path leaves the DB unchanged.
