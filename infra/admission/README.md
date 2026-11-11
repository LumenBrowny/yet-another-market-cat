# Admission container preparation

Local preparation, not a deployed mainnet stack. Default Docker target `production`
contains the real issuer entrypoint and is disabled unless `YAC_ADMISSION_ENABLED=true`.
It must receive private JSON config at `/run/secrets/admission.json`. The image contains
no signer, provider secrets or app credentials. Node image is digest-pinned; npm uses a
separate lockfile. No dependency migration was performed.

The `rehearsal` target adds an explicitly isolated chain fixture: it can issue SIWS
challenges but cannot authorize grants or call RPC/SGT/CAPTCHA. It is absent from the
production target. This stage verifies HTTP/container/storage wiring, not on-chain flows.

## Local Compose rehearsal

`compose.rehearsal.yaml` uses the actual .NET API and admission HTTP implementation.
Only `127.0.0.1:5191` is published. Admission uses `network_mode: service:api`, listens
on loopback 5091 and has its own SQLite volume. No issuer keys are mounted into API.
Read-only admission rootfs needs a bounded `/tmp` tmpfs for tsx. Keep runtime module mode
consistent with the existing shared package (do not add root `type: module` here).

Before running, prepare ignored `.dev/admission-compose/api.env` with a random
`YAC_ADMISSION_PROXY_SECRET` (at least 32 characters), and `admission.json` with the same
`proxySecret` and an independent stable random `rateSalt`. These are synthetic local
credentials, not copies of production secrets. Regenerating the salt resets hashed rate
identities; keep it stable across service restarts and restore.

```
docker compose -f infra/admission/compose.rehearsal.yaml build
docker compose -f infra/admission/compose.rehearsal.yaml up -d
docker compose -f infra/admission/compose.rehearsal.yaml stop
```

API RPC intentionally points at closed loopback port 1; indexer/RPC health is not expected
to pass. Settlement and signing are disabled. `/api/live` is process liveness only.
If API is recreated, recreate admission too to rejoin its network namespace. Admission
startup ordering is not readiness; allow it to finish loading before proxy requests.

## Consistent SQLite backup and safe restore

```
node infra/admission/snapshot.mjs /data/admission.db /data/snapshots/UNIQUE.db
node infra/admission/restore.mjs /data/snapshots/UNIQUE.db /data/new-admission.db
node --test infra/admission/snapshot.test.mjs
```

Snapshot uses Node SQLite backup API with a live read-only source connection: committed
WAL is included. Parent output directory must exist. A fresh separate destination is
required; existing output is never overwritten. Integrity is checked before publication.
No filesystem copy of an active SQLite main file alone is an acceptable substitute.

Restore publishes only after invalidating all old challenge/CAPTCHA authorizations.
Rate-limit counters remain. Keep the restored issuer stopped until deployment identity,
current on-chain issuer, wave schedule and finalized wallet/subject receipts are
reconciled. Chain receipts, not this SQLite DB, determine prior faucet allocations.
Changing issuer key requires its own admin-authorized on-chain rotation.

The snapshot is plaintext and sensitive. Next production integration must stage it with
the matching stable rate salt/config, encrypt using the existing recovery bundle, then
remove the private staging copy. Private signing-key recovery is a separate custody
decision. This helper does not modify the existing VPS backup adapter or schedule and
does not make mainnet admission backups enabled.

## Verified scope

Clean API and admission Docker builds; production import of SGT adapter without network;
production startup refuses missing opt-in; no fixture in production target. Actual API
proxy challenge, wrong-wallet rejection, direct internal request without secret rejection,
admission restart persistence, live SQLite snapshot/restore, old authorizations invalidated,
limits preserved and original live DB unchanged passed. Existing TS tests/typecheck/lint
passed; .NET API release build passed. No program/accounting logic changed.

The runtime audit still reports transitive advisories (including Anchor/toml and
bigint-buffer). Do not apply `npm audit fix --force`; production release needs the
existing reachability triage refreshed for the final lockfile. Container wiring checks
do not constitute an independent security audit or final full-chain acceptance.
