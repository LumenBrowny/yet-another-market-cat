# External audit triage — 12 October 2026

This follow-up reviews the submission platform's automated findings against source baseline `00f98f9`. It is a scoped maintainer analysis, not independent certification. The platform reported partial coverage and unverified source-code leads. Affected dependency versions are real observations; exploitability requires a reachable affected function and input. No confirmed externally exploitable defect was established in the examined findings. This does not establish absence of vulnerabilities.

`C` refers to the audit's **Your code** IDs; `P` refers to **Packages** IDs. Repeated source/sink locations and repeated lockfile observations are grouped below.

## Disposition and changes

| IDs / baseline locations | Classification | Reachability and decision |
| --- | --- | --- |
| C1–8, `operator.js:106,127,164,170,181` | NOT REACHABLE | Legacy public-page renderers are not selected by the shipped router. `index.html` loads `product.js`, which imports `operator.js` only for `/operator`; that route dispatches the dashboard. These legacy functions must not be enabled without revisiting their escaping. |
| C10–15,20–22,25–38; operator errors, product shell/verification/proof/about/errors, release rendering | FALSE POSITIVE | These templates use static locale content, escaped dynamic text/attributes, numeric formatting or allowlisted result values. `innerHTML` alone does not establish attacker-controlled markup. Browser regression coverage exercises hostile verification/proof data without CSP. |
| C9,16–19,23–24; `operator.js:210`, `product.js:146,189,236` | DEFENSE-IN-DEPTH / EASY FIX | Counts/IDs/public keys come from typed or validated API responses, so no public exploit was established. Remaining API text/attributes are now escaped, path segments encoded, and dynamic manifest/explorer URLs restricted to HTTPS or same-origin development HTTP. This also protects against future response-contract changes. |
| C39, `.github/workflows/ci.yml:17` | DEFENSE-IN-DEPTH / EASY FIX | All four Actions are now pinned to full commit SHAs resolved from their existing v4/stable refs. CI keeps `contents: read`. This pins action code, not the moving runner or downloaded stable toolchain versions. |
| C40–42 and P10–12, `infra/public/Dockerfile:1,2,7/8` | PRODUCTION HARDENING | Three mutable base tags, reported twice. Real reproducibility/supply-chain concern, not proof of a compromised image. Deferred to a tested image rebuild with recorded multiarch digests and an update policy; choosing today's digest would not identify the historical deployed build. APT resolution also remains mutable. |
| C43–45, `lib.rs:114,173,207` | FALSE POSITIVE | Classic SPL Token CPI cannot mutate YAMC-owned position/config data. Deposit does not pass position to the CPI; other uses are transfer authorities. No post-CPI decision reads a modified token balance from stale cached state. Blind reload is not a fix. |
| C46–48, `lib.rs:263,284`, `settlement.rs:311` | FALSE POSITIVE | Fixed vault PDA/token authority and signing-owner ATA constraints preclude source/destination aliasing. Added concrete alias rejection cases for faucet, deposit and claims; failed transactions preserve balances/accounting/receipts. |
| C57, `settlement.rs:97` | FALSE POSITIVE | Admin-constrained rewards initialization uses `init` at fixed PDAs, with no close/reset path. Existing bankrun coverage rejects a second initialization. |
| C49–50, `RelaunchTests.cs:113,121` | FALSE POSITIVE | Dummy HTTP URLs use an injected in-memory HttpMessageHandler or an overridden history reader. No network request is made to `test.invalid`/`unused.invalid`. |
| C51–56,58–64, web3.js imports | PRODUCTION HARDENING | One SDK maintenance recommendation repeated across 13 imports. `@solana/web3.js 1.98.4` is pinned; migration to Kit affects Anchor/MWA/transaction compatibility. Not an emergency patch or a separate vulnerability per import. |
| P1, `toml 3.0.0`, both npm locks | NOT REACHABLE in examined runtime input paths | Anchor's lazy Node workspace helper parses a local `Anchor.toml`; YAMC uses explicit IDLs/clients and does not invoke that helper or accept untrusted TOML. A patched major exists. The package remains affected; no forced 3→4 override or Anchor migration was made. |
| P2, `bigint-buffer 1.1.5`, both npm locks | DEPENDENCY ADVISORY / NO SAFE PATCH | Native overflow advisory remains open. The live backend directly reported that its native binding cannot load and it uses JS fallback; Docker disables install scripts. Inspected SPL adapters pass fixed-width blobs. Neither observation proves every possible installation/call path safe. No forced SPL downgrade. |
| P3, `rand 0.7.3`, Cargo.lock | NOT REACHABLE under examined features | Locked feature tree does not enable rand `log`; no reentrant custom RNG logger exists in YAMC. Required advisory conditions are absent. Recheck if features/logging change. |
| P5, `borsh 0.10.4`, Cargo.lock | NOT REACHABLE in examined schemas | Affected parsing involves non-Copy/non-Clone zero-sized types. YAMC instruction/account schemas use concrete fields and non-ZST ProofNode. No matching input path found; this is not a complete linked-binary analysis. |
| P4/P6, `bincode 1.3.3` / `libsecp256k1 0.6.0` | DEPENDENCY ADVISORY / NO SAFE PATCH | Transitive maintenance advisories, not a demonstrated YAMC exploit. No supported drop-in maintenance fix was established without changing the Solana graph. |
| P7/P9, uuid 8.3.2 / 7.0.3 | NOT REACHABLE for affected APIs | Jayson and Xcode use v4 without a caller-provided output buffer; the advisory concerns other generation APIs with such a buffer. P9's cited backend location is additionally incorrect: it contains rpc-websockets' uuid 14.0.2, not 7.0.3. Affected 7.0.3 is in root Xcode build tooling. |
| P8, `stream-json 1.9.1` | NOT REACHABLE for affected filters | No YAMC usage of pick/ignore/filter/replace. Jayson imports StreamValues/Verifier; the inspected Solana HTTP client uses JSON parsing. This does not remove general JSON/RPC denial-of-service risks. |
| Four informational Cargo notes | PRODUCTION HARDENING | Missing license metadata and duplicate crate versions are not execution vulnerabilities. License selection needs the owner's decision; manual dependency deduplication is not a safe fix. |

No application, Anchor, Solana, npm or Cargo dependency versions were changed. The custody program, deployed backend executable and Android APK remain unchanged by these fixes. The new browser test is included in CI; the SBF suite is run separately with the documented Solana/native toolchain.

## Reproducible checks

```sh
npm ci
npm test
npm run typecheck
npm run lint
# Linux CI (local Windows test uses installed Edge):
npx playwright-core install --with-deps chromium
CI=true node scripts/test-web-security.cjs
dotnet test server/YetAnotherCat.Tests -m:1
dotnet publish server/YetAnotherCat.Api -c Release -o /tmp/yac-publish -m:1
cargo fmt --all -- --check
cargo check --workspace --locked
cargo test --workspace --locked
# Configured Linux Node + SBF artifact, as documented in docs/build-and-run.md:
bash scripts/test-program.sh
```

The security browser test uses mocked hostile API responses and URL parameters in EN/CA, verifies literal text rendering, inert executable URLs, valid normal links, operator routing and API errors, with no CSP or live RPC. It demonstrates output-boundary behavior; it does not imply attackers can control the real API's typed fields.

Local validation: 91 JS/TS tests and 22 SBF/bankrun tests passed; TypeScript, ESLint, the browser security test, existing EN/CA website regression suite (320/390/768/1440 widths), .NET Release publish, Rust formatting/check and 2 Rust tests passed. The backend suite passed 63 tests with 2 default optional skips. Both skipped tests were then enabled separately and passed: real Node process-tree timeout and isolated PostgreSQL migration/restart/projection recovery (65 distinct backend tests exercised). The disposable local PostgreSQL container was removed afterward. Raw outputs and the submission feedback drafts stay in local ignored notes.

## Remaining devnet and production boundaries

The centralized publisher can publish a dishonest allocation; an upgrade authority can replace program rules. Verification detects discrepancies but is not an on-chain veto, fraud proof or rollback. These remain **ACCEPTED DEVNET RISK**, not findings fixed by HTML escaping.

Archival RPC availability, publisher key controls, upgrade governance, supported dependency upgrades, reproducible image updates and a fuller independent review remain **PRODUCTION HARDENING**. The public verifier UI displays a saved report. A fresh replay demonstration would add evidence, but is not supplied by changing a timestamp or making every public GET trigger expensive work. No retention/beta metrics have been fabricated. The auditor's lack of physical-device execution is distinct from creator-reported device acceptance in [mobile.md](mobile.md).

## Advisory sources

- [toml prototype pollution](https://github.com/advisories/GHSA-v5mp-jgw5-2x6j) and [recursion](https://github.com/advisories/GHSA-82x6-q7mm-w9cf).
- [bigint-buffer native overflow; no patched version listed](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg).
- [rand logger interaction](https://rustsec.org/advisories/RUSTSEC-2026-0097.html), [Borsh ZST parsing](https://rustsec.org/advisories/RUSTSEC-2023-0033.html).
- [bincode maintenance](https://rustsec.org/advisories/RUSTSEC-2025-0141.html), [libsecp256k1 maintenance](https://rustsec.org/advisories/RUSTSEC-2025-0161.html).
- [uuid buffer bounds](https://github.com/advisories/GHSA-w5hq-g745-h8pq), [stream-json nested filters](https://github.com/advisories/GHSA-528h-pc64-c93x).
- [web3.js v1 maintenance documentation](https://solana-foundation.github.io/solana-web3.js/).

See also the preceding [scoped security review](security-review.md), whose broader dependency scan remains relevant and is not superseded by dismissing individual external heuristics.
