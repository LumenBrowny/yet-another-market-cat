# Encrypted recovery tools

These tools require explicit host installation and private configuration. They do not
configure credentials or Telegram alerts automatically. The legacy VPS adapter below
exports an already completed backup; it does not copy live database files.
Python 3, age and rsync/OpenSSH are required on Linux. WSL is sufficient for rehearsal.

## Data flow

1. Main server prepares a consistent staging snapshot: pg_dump, immutable manifests,
   deployment identity and separately snapshotted admission DB. Verify references
   against chain; never copy an active SQLite .db without its backup API.
2. `backup_bundle.py pack --snapshot STAGING --export EXPORT --recipient AGE_PUBLIC_KEY`
   streams a tar into age without persisting a plaintext tar. The snapshot itself is
   plaintext and needs restricted access and a deliberate cleanup policy. The final
   `.ready.json` marker is published only after encryption completes.
3. Backup host pulls exports over SSH using a dedicated read-only account/key and a
   pinned host key, then ingests into its own store. Main server has no credentials
   for this store. Use a separate OS account and permissions to enforce this boundary;
   directory separation in the WSL rehearsal alone is not privilege separation.
4. A receiver checks size/hash and refuses to replace different bytes under an existing
   name. No automatic deletion. Interrupted receiver copies are unacknowledged and
   require investigation; do not blindly delete conflicting local files.
5. Manual restore: `backup_bundle.py restore --bundle FILE --identity AGE_PRIVATE_KEY
   --destination NEW_DIRECTORY`. Decryption completes successfully before extraction;
   only ordinary files with safe relative paths are accepted, then per-file hashes
   are checked. Existing restore destinations are refused.

Age recipient public key belongs on main server. Keep private recovery key offline,
with a separate secure backup; receiver need not possess it for routine copying.
The WSL-generated identity is TEST ONLY and must not become the only production key.
Age encryption/checksums do not authenticate who created a backup; pinned SSH transport
and a protected version history remain important. A compromised main server can supply
bad new snapshots but should not be able to erase older protected receiver copies.

## SSH pull configuration

Save private configuration outside git and invoke `python3 pull_backups.py --config FILE`:

```json
{
  "source": "yac_backup_reader@MAIN_HOST",
  "exportPath": "/",
  "sshIdentity": "/home/backup/.ssh/yac_reader",
  "knownHosts": "/home/backup/.ssh/known_hosts",
  "store": "/home/backup/yac-store",
  "minimumFreeBytes": 2147483648,
  "maxBundleBytes": 21474836480
}
```

Configure the server-side SSH account to read only the export directory, without shell
write privileges, forwarding or access to deployment keys. Verify host fingerprint out
of band. The helper never disables host-key verification and never uses `--delete`.
With `rrsync -ro /srv/yac-backup-export` as the forced command, `/` in this config is
relative to that restricted directory, not the server filesystem root. Use an authorized
key with `restrict,command="/usr/bin/rrsync -ro /srv/yac-backup-export"`. The reader must
not own or have write access to the export directory. Do not enable rsync `--protect-args`:
rrsync rejects it because it needs to inspect the server arguments. The client validates
the host and remote path against restricted shell-safe character sets instead.
It does not yet implement retention pruning or a total transfer quota; monitor disk
usage and choose a bounded export set on the source before scheduling it.

## Telegram

`telegram_notify.py --credentials PRIVATE_FILE` validates format without network sends.
`--send-test` sends exactly one fixed test message. No retry on uncertain delivery;
errors deliberately omit URL, credentials and response payload. The credential file
accepts `token=...` and `chat_id=...` (also `chatId`). Keep permissions restricted.
No bot token belongs in repository files, command-line arguments or backup manifests.

The user must Start the bot before private-chat notifications. Automated monitoring,
deduplication, recovery notifications and systemd timers remain a separate integration;
no background sender is enabled by that one-shot tool. A monitor on the backup host should
check the public API as well as successful backup age to detect primary-host failure.

## Backup monitor and retention review

`export_health.py` publishes only backup service status, completion time, export usage
and disk headroom to the SSH-restricted `status.json`. No credentials or endpoint tokens.
Its timer refreshes every 15 minutes. `backup_monitor.py` on the receiver checks this
telemetry, pull age, newest archive timestamp and SHA-256, and receiver free space.
Fresh pulls of old archives do not hide source staleness. Thresholds: 30-hour backup
age, 1-hour telemetry age, 3 GiB source headroom, 10 GiB receiver headroom, 400 MiB source
export warning ahead of the export cap. Result is stored in `health.json`.

Default CLI operation is check-only; unhealthy checks exit nonzero. `--send` permits
fixed Telegram messages for incident changes/recovery and one daily reminder of an
unchanged incident. Persisted attempt-before-send state avoids immediate retry after
uncertain delivery; this trades possible lost notifications for duplicate prevention.
`--send --test` records a single test attempt and refuses automatic repetition.

The home collector stays in check-only mode through `check-only.conf`: Telegram HTTPS
is unavailable from the host network. Delivery now runs separately through the existing
`wgmina` VPN container's network namespace. The owner confirmed receipt of the authorized
VPN delivery test. Both checks and notifications run every 15 minutes. A powered-off
home receiver cannot alert on its own failure; independent heartbeat monitoring is still
a separate requirement.
This monitor covers backups, not all application/RPC/publisher safety alerts.

### VPN notifier on Docker Snap

`compose.notifier.yaml` and `yamc-notifier.service/timer` are configured for the current
home Docker Snap installation. Installed directory: `/var/snap/docker/common/yamc-notifier`.
The collector projects its result to `health/health.json`; the notifier reads this
directory only. It has no archive, SSH key, Docker socket or recovery identity mount.
Only `/state` is writable; `/app`, `/health`, and the Telegram credential file are
read-only. The container uses the backup user's numeric UID, drops all capabilities,
has a read-only root filesystem and resource limits. Python image is digest-pinned.

`network_mode: container:wgmina` is required. Each systemd run creates a fresh temporary
container so a recreated wgmina is resolved on the next run. Missing/stopped VPN causes
delivery failure, not a configured host-network fallback. This does not establish the
VPN container's kill-switch behavior: the existing VPN routes/firewall are not modified
or tested by stopping a VPN that other services share. No ports are published.

On this Docker Snap host `no-new-privileges` prevented Python from starting in both
Alpine and Debian images (`operation not permitted`), even with a non-root UID. It is
therefore not set; non-root, cap-drop, read-only rootfs and mount isolation remain.
Do not copy Snap-specific paths/service dependencies unchanged to Docker Engine hosts.

`notify_status.py` validates health-report age and issue names; stale/missing reports
produce a collector-unavailable alert. Deduplication state is independent from the
collector and stored outside ephemeral containers. Delivery attempts are persisted
before sending; uncertain acknowledgements do not trigger immediate retries.
Disable only notifications with `systemctl disable --now yamc-notifier.timer`.
The existing backup pull and collector timers are independent and remain enabled.

`retention_plan.py --store DIR` is report-only. It preserves all sets from the last
seven days, the newest seven sets even for sparse history, and the newest representatives
of seven daily, four weekly and twelve monthly buckets. It verifies ciphertext before
listing candidates; any invalid archive blocks candidates. It never deletes anything,
including partial or unknown files. Review the list and off-host durability before any
future cleanup implementation; old plaintext VPS backups are outside this policy.

## Rehearsal evidence

Local age encryption → rsync between WSL directories → ingest → restore passed.
Wrong key, tampered ciphertext, partial set and conflicting overwrite were rejected.
See ignored `local-notes/mainnet/20261110-encrypted-backup-report.json`.
WSL stops when the PC is off: it is a test target, not an always-on production backup.

Remote rehearsal subsequently passed: VPS completed backup → age encryption → home
Ubuntu restricted SSH pull → ciphertext roundtrip → authenticated restore of 1961 files
→ isolated PostgreSQL restore. All 991 published cycle rows had matching manifest files.
Shell execution, uploads and parent-directory traversal were rejected by the reader key.
This checks stored data consistency, not a fresh independent chain replay.

## Legacy VPS adapter and receiver schedule

`export_completed_backup.py` runs as `ExecStartPost` of the existing `yac-backup.service`.
It checks backup freshness, encrypts the latest PostgreSQL dump, configuration archive,
manifest mirror and deployment description, then removes its private plaintext staging
directory. Existing on-VPS legacy backup files remain unchanged. It fails when export
storage exceeds 512 MiB or disk headroom falls below 2 GiB; no history is auto-deleted.
Review retention before that cap is reached. This adapter is for the current devnet
deployment and the mainnet preparation. When mainnet secrets/admission.json exists,
the exporter requires a successful online SQLite backup from the fixed
yamc-mainnet-admission-data volume; missing/corrupt DB fails the whole export.
The snapshot is mainnet/admission/admission.db, encrypted with the configuration
archive containing its stable salt and issuer recovery material. Restore using
infra/admission/restore.mjs into a fresh DB, invalidating old challenges before
service startup. Do not restore/enable over a running issuer. The sequential DB
and object backups still require reconciliation on restore.

The receiver unit runs as `yamc-backup`, with a restricted writable directory and no
privilege escalation. Its timer pulls daily at 04:00 UTC (up to five minutes jitter),
after the source's 03:20 UTC backup, and after boot. `last-pull-success` records transport
success, not source snapshot freshness; monitoring must check both. Persistent timers
catch up after downtime. No inbound Internet port is required on the home receiver.

Before `pg_restore --exit-on-error` into a fresh isolated PostgreSQL 17 database, create
the original owner role `yac` (NOLOGIN is sufficient for the restore check). Production
credentials and grants must be restored separately from the encrypted configuration.
Keep publishers and issuers disabled until DB, object storage and on-chain state are
reconciled. Do not print the configuration archive or restored secret files in logs.

References: https://github.com/FiloSottile/age and https://core.telegram.org/bots/api#sendmessage.
