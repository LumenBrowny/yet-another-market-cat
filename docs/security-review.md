# Scoped security review — 12 October 2026

This is an internal, assistant-assisted source and configuration review for Android **0.13.7 (29)**. It is not an independent audit, a penetration test or a security certification. The submission platform's one-shot audit has not been used. Review baseline: `c62a4a1`, plus the wallet identity, demo-panel and release changes in the commit containing this document. The on-chain program and backend executable were not changed by this release.

No owner-check bypass, duplicate-claim bypass or user-input-to-shell execution was confirmed in the paths examined. This is a scoped negative finding, not proof that the application has no vulnerabilities. Dependency findings below remain open; do not describe this release as having a clean audit.

## Scope and evidence

Reviewed the Anchor entry points and account constraints; immutable cycle publication and claims; finalized-history and verifier boundaries; API authorization and input validation; process invocation and manifest storage; wallet authorization and transaction construction; merged release Android manifest and dependency graph; website rendering; public deployment configuration and repository secret patterns.

| Area              | Observed control and evidence                                                                                                                                                                                                                | Limit                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Custody           | [Owner signer, owner-derived position PDA, `has_one`, mint/ATA/vault constraints](../programs/cat_shit_mining/src/lib.rs); checked arithmetic and withdrawal cooldown                                                                        | Upgrade authority can replace program logic                                                     |
| Claims            | [Wallet/cycle/amount-bound leaf, bounded proof depth, permanent receipt PDA, allocation and reserve checks](../programs/cat_shit_mining/src/settlement.rs)                                                                                   | Merkle inclusion does not establish a fair allocation                                           |
| Publisher         | [Require a VALID independent pre-publication report](../server/YetAnotherCat.Infrastructure/CycleService.cs); post-publication check and recovery policy                                                                                     | Centralized key can bypass this off-chain workflow and publish a dishonest root                 |
| Verifier          | [Independent chain replay](../scripts/cycle-verifier.ts); unavailable history is not VALID                                                                                                                                                   | Depends on RPC completeness; public UI serves a saved report, not a fresh replay on every visit |
| API               | [Constant-time bearer comparison, operator namespace guard, bounded IDs/pagination, rate limiting](../server/YetAnotherCat.Api/ProductApi.cs)                                                                                                | No distributed-load or sustained denial-of-service testing performed                            |
| Processes / files | [ArgumentList, no shell, JSON stdin, timeout/child termination](../server/YetAnotherCat.Infrastructure/SettlementBridge.cs); [canonical storage keys, hashes, conditional writes](../server/YetAnotherCat.Infrastructure/ManifestStorage.cs) | Publisher and storage credentials remain trusted server secrets                                 |
| Android           | SecureStore session, account-change check before submission, HTTPS identity/icon, release cleartext disabled, OTA disabled, no debuggable flag                                                                                               | Wallet and device OS remain trusted; not a native-code or reverse-engineering audit             |
| Exposure          | Live operator status returned 401 without bearer; malformed cycle/wallet returned 400; API lives as UID 1654; database and MinIO not published as host ports                                                                                 | Single VPS, SSH administration and infrastructure supply chain remain trusted                   |

The Android launcher is intentionally exported. Custom Expo schemes are present, but no application handler dispatches wallet transactions from incoming URI data. The exported ProfileInstaller receiver requires `android.permission.DUMP`; file providers are non-exported. `allowBackup=true` is inherited, with SecureStore explicitly excluded from cloud backup/device transfer rules. This is not equivalent to exporting wallet signing keys: the app does not hold those keys. Disabling all backup is an optional hardening step, not a confirmed credential-exfiltration finding.

## Dependency findings — open

Counts describe affected dependency graph entries, including propagated parent entries; they are not counts of distinct exploitable defects in YAMC.

| Graph                              | Result on review date                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Root npm lock                      | **48**: 1 critical, 28 high, 19 moderate                                                                              |
| Backend runtime npm lock, omit dev | **12**: 5 high, 7 moderate                                                                                            |
| NuGet, including transitive        | Command returned no vulnerable packages for the four solution projects                                                |
| Cargo.lock via OSV                 | 266 registry package versions queried; 4 affected package versions, 5 advisory IDs (including a duplicate alias pair) |
| Android native runtime             | Gradle release dependency graph inspected; no comprehensive Maven/native advisory scan performed                      |

The critical npm entry is [shell-quote GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv), in the React Native development tooling graph. No route from YAMC API input or Android user input to that shell-quoting API was identified. It remains a build-tool supply-chain risk; update the affected tooling before using untrusted build inputs. A patch being available does not make the current lock fixed.

[bigint-buffer GHSA-3gc7-fjrx-p6mg](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg) is also present through Solana dependencies. The advisory concerns its native conversion implementation. The inspected token layout adapters pass fixed-width blobs (8/16/24/32 bytes), and the backend Dockerfile installs dependencies with `--ignore-scripts`. Those reduce the examined attack surface, but do not establish all call paths or all deployment builds as safe. No native-overflow exploit was attempted. Do not blindly apply npm's suggested SPL-token downgrade as a security fix.

Other direct advisory packages in the root graph include brace-expansion, braces, node-forge, source-map-js, sprintf-js, stream-json, toml and uuid. Backend runtime findings include bigint-buffer, stream-json, toml and uuid. Their complete reachability was not established. A scoped dependency-upgrade pass with fresh builds and regression tests is still required before production; no forced ecosystem downgrade or lockfile-only cosmetic suppression was applied.

Rust findings:

- `bincode 1.3.3`: [RUSTSEC-2025-0141](https://rustsec.org/advisories/RUSTSEC-2025-0141.html), unmaintained.
- `libsecp256k1 0.6.0`: [RUSTSEC-2025-0161](https://rustsec.org/advisories/RUSTSEC-2025-0161.html), unmaintained.
- `borsh 0.10.4`: [GHSA-fjx5-qpf4-xjf2](https://osv.dev/vulnerability/GHSA-fjx5-qpf4-xjf2), unsound parsing involving non-copy/clone zero-sized types.
- `rand 0.7.3`: [RUSTSEC-2026-0097](https://rustsec.org/advisories/RUSTSEC-2026-0097.html) / GHSA-cq8v-f236-94qc, custom-logger interaction. These are two IDs for the same finding.

These are lock-graph observations, not proof that the affected paths are present or reachable in deployed SBF. A complete linked-binary reachability analysis was not performed. Maintenance advisories are distinguished from a demonstrated exploit.

## Validation completed

- 91 JS/TS tests passed; TypeScript and ESLint passed.
- 20 SBF/bankrun tests passed using Linux Node in WSL, including custody, unauthorized actions, immutable cycles, reserve and atomic claims. The initial Windows Node attempt could not load the native binding; the Linux rerun passed.
- Backend: 63 passed, 2 skipped (isolated Postgres integration and Linux process-tree timeout prerequisites on the Windows run). Skips are not passes.
- Signed Android build succeeded; physical-device acceptance confirmed full name, icon and site in Solflare and the four demo controls. No security certification is inferred from UI acceptance.
- Narrow secret-pattern scan of 206 tracked text files found no candidate private-key blocks, GitHub tokens, AWS access-key patterns or 64-byte Solana keypair arrays. This was not an entropy-based scan of all Git history and does not establish absence of every credential type.
- Live configuration inspection found secret directory/file permissions 700/600 and no host-published PostgreSQL/MinIO ports. Only small read-only API probes were used; no production load or destructive tests.

Raw test logs and scanner outputs are kept in the local, Git-ignored `local-notes/security/20261012/`. This public summary supplies review scope and durable code links without publishing machine paths, operational credentials or internal submission drafts.

## Remaining trust and hardening work

The centralized publisher can control availability and allocation; an upgrade authority can change custody/claim rules. Independent verification detects discrepancies but cannot veto or reverse an already published claim. Devnet tokens, fixed supply and test success do not remove these trust assumptions.

Public aggregate endpoints can scan historical rows/manifests. Per-IP limits reduce casual abuse but do not make that work bounded independently of history size; caching/precomputed aggregates and measured load limits are recommended. There was no production stress test.

Before production: remediate and re-evaluate dependency advisories; independently review program and backend; establish archival history availability, governance/key custody, deployment image pinning and broader device/network coverage. The hackathon reviewer may report the same dependency or heuristic findings; respond with their actual reachability and evidence rather than treating this document as a waiver.
