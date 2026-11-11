# Mobile RPC — prelaunch gateway

Public URL: `https://yetanothermarket.cat/mobile-rpc`.
The private upstream is supplied via VPS `secrets/mobile-rpc.env`; never include it
in EXPO_PUBLIC variables or image layers. Container has no signing keys or volumes,
runs unprivileged/read-only with no published port, behind existing Caddy.

Allowed: genesis, balance, bounded base64 account reads (8 accounts max, 2048-byte
slice), token accounts filtered to CATSHIT or SKR mint. No JSON-RPC batches,
arbitrary upstreams, scans/history, simulation, transaction submission or WebSockets.
These are the default read-only settings. The deployed compose explicitly opts into
the transaction methods described below (2026-11-11).
Keep the on-chain schedule unset. The preparing release is not a complete launch
approval: before activation, finish admission integration and exercise the complete
application flow, including withdrawal fallback.

Limits: 16 KiB request, 256 KiB upstream response, 10-second upstream timeout,
8 concurrent upstream calls, 120 requests/minute per IP, 600/minute total, 512-entry
bounded cache (2 seconds reads, 15 seconds SKR token reads, one hour genesis).
Rate windows are in memory; these are preparation limits, not durable billing caps
or a claim of Sybil protection. Shared-IP clients can share limits; review capacity
and upstream/provider budget before real launch. No hidden retries of RPC requests.
Caddy overwrites forwarded client IP; gateway trusts it only from 172.29.6.254.

The RPC error text is generic; upstream URLs, headers and errors are never reflected.
SKR cosmetic mainnet reads use the same gateway in mainnet builds. Devnet builds
retain their existing cosmetic RPC configuration.

## Opt-in submission transport (deployed after local rehearsal)

`RPC_TRANSACTIONS_ENABLED=true` additionally permits getLatestBlockhash,
getBlockHeight, getSignatureStatuses (up to 8 signatures, recent cache only) and
sendTransaction. Submission requires canonical base64, 100–1232 decoded bytes,
preflight enabled at confirmed, and at most 2 upstream retries. Transaction/status/
height/blockhash responses are never cached. Sends have a separate budget of 6/min
per IP and 60/min globally, within the ordinary request/concurrency limits.
Before submission the gateway verifies upstream mainnet genesis (60-second cache).
No signing keys or fee sponsorship are involved. The gateway relays signed bytes;
the validator verifies signatures and transaction validity. This is not a YAMC-only
instruction firewall or authentication mechanism: other signed transactions can use
the bounded submission budget. Assess abuse/shared-IP capacity before public enablement.

The mobile HTTP transport polls every 3 seconds for up to 120 seconds, with a
15-second per-fetch abort and no SDK rate-limit retry loop. It records the signed
transaction ID before submission and never automatically re-signs or resends after
an ambiguous response. Recent-blockhash expiry is checked against finalized height;
already-landed transactions continue waiting for requested confirmation. Unknown
outcomes tell the user to check status before retrying. Durable nonce transactions
are outside this mobile transport's scope. Standalone Admission Lab is unchanged.

Run all transport checks: `npm run test:mobile-rpc` (also included in `npm test`).
With a local validator at 127.0.0.1:8899, run
`npx tsx scripts/release/mobile-rpc-local-rehearsal.mts` for a real signed transfer
through an ephemeral loopback gateway and HTTP finalization. It generates disposable
test keys, obtains local airdrop and never loads production credentials. The library
factory's explicit localTest option exists for this harness; the production CLI does
not expose an HTTP-upstream or alternate-genesis environment override.
