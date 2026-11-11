# Mainnet admission provisioning gate

Prepared overlay only; the default public API remains admission-disabled. Do not
start with the staged false flag or treat the staged file as production readiness.
Image uses mainnet IDL via EXPO_PUBLIC_BUILD_PROFILE=mainnet. Node-only secret signer,
no admin/program/mint/publisher keys. No published ports: loopback 5091 inside API
network namespace. Recreate admission when API's network namespace changes.

Before enabling:

1. Receive issuer-only encrypted envelope from independently backed-up offline key set.
   Decrypt on VPS with its dedicated recipient key; verify full public registry proofs
   and issuer address `FH3NMC6GnywaDgBKMQZCv3yGwvTdvJ1WgFkSjyQafrqw` before writing
   `/opt/yamc-mainnet/secrets/issuer.json` (uid 1000, mode 0600). Never mount into API.
2. Initial issuer assignment is part of the one-time admin-authorized activateRewards
   instruction, which also sets faucetOpensAt, waveTwoAt and miningStartsAt. It cannot
   be separated from scheduling in the deployed program. rotateFaucetIssuer requires
   activatedAt > 0 and is only a later recovery operation. Do not schedule merely to
   bring up admission. Keep secrets staged and service off until launch dates and
   all readiness gates have been explicitly reviewed, then prepare the exact offline
   activation request. No activation request is currently prepared or authorized.
3. Create private admission.json with matching issuerKeyFile, mainnet mint/genesis,
   private grantRpc and sgtRpc, exact HTTPS origin https://yetanothermarket.cat,
   publicApiPath `/mainnet/api/faucet`, database `/data/admission.db`, persistent random
   rateSalt and proxySecret (>=32 chars), and actual Turnstile siteKey/secretKey.
   Store matching proxySecret in API private env. Do not set localRehearsal.
4. Integrate live SQLite snapshot.mjs backup into encrypted exporter, including stable
   salt/config. Do not copy an active SQLite main file alone. Verify off-host receipt
   and restore invalidation of old challenge/CAPTCHA state before public enablement.
5. Run issuer privately with opt-in; startup must verify genesis, mint and on-chain
   issuer. Verify private proxy authentication, database health and closed-wave denial.
6. Only then enable API proxy and verify both CAPTCHA paths and CSP at public edge.
   Before agreed faucet opening, challenge must reject with faucet-not-open. Do not
   weaken startup issuer matching or the wave gate to test live SIWS before scheduling.
7. Next APK must include app/src/admission.ts mainnet CAPTCHA-path correction.
   APK 1.0.2 includes that correction; 1.0.1 predates it.

The transfer kit is ignored local output. Issuer was received and verified directly
on VPS on 2026-11-11; no secret was decrypted on the workstation.
The staged overlay is not referenced by the running compose. Current production
entrypoint correctly refuses startup if issuer is unset/mismatched on-chain.

Prepared on VPS on 2026-11-11: admission.json with stable salt/proxy secret and
Turnstile configuration, empty database in named volume yamc-mainnet-admission-data,
compose.admission.yaml (disabled), matching proxy secret staged in backend.env.
API was not recreated and admission remains disabled. Encrypted backup exporter
now uses SQLite backup API for mainnet/admission/admission.db and includes the
overlay plus private configuration. Empty-DB snapshot/restore passed on VPS;
separate WAL fixture verifies committed writes and restored-authorization invalidation.
Before launch, still verify actual public CAPTCHA/CSP and running-service health.
