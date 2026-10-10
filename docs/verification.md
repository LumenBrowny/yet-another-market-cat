# Verify The Shit

[Public explorer](https://yetanothermarket.cat/cycles) → choose a published cycle → inspect the manifest, SHA-256, Merkle root, on-chain commitment and cached report. A public wallet address reveals its allocation and claim status without wallet connection. Actual claims happen in the Android app.

The independent TypeScript verifier (`scripts/cycle-verifier.ts`) replays finalized Solana events without reading the accounting database. It recomputes effective-stake intervals, PP, deterministic largest-remainder allocations, canonical manifest hash and Merkle root, and compares them with the on-chain cycle. VALID requires both internal consistency and chain recomputation; a pending candidate is distinguished from a published cycle.

## Run locally

After `npm ci`, download a manifest from a cycle page to a local file. For full replay, use an RPC with complete required devnet history and start slot 504431875 for the canonical deployment:

```sh
node --import tsx scripts/verify-cycle.ts manifest.json --rpc https://YOUR_DEVNET_ARCHIVE_RPC --start-slot 504431875
```

Replace the example endpoint locally; do not commit credentials. The public devnet RPC may lack retained history or rate-limit replay. Running without `--rpc` checks internal manifest consistency only; it is **not** independent chain verification. Read `chainRecomputation` and the individual checks, not just the CLI’s compatibility `valid` field.

`YAC_FINALIZED_BLOCK_CACHE` optionally points to a local cache directory. Only immutable finalized block responses are cached, namespaced by RPC identity/network/encoding. Corruption and misses require refetch; failures are not cached as valid blocks. **Cache accelerates replay; it does not replace fresh RPC identity/history-coverage checks.** Tests cover missing history, corrupt cache, failed invocations and allocation tampering.

## Publication and maintenance

The configured publisher refuses publication unless its independent prepublication report returns VALID. Historical-data loss means unavailable verification, not guessed success. Public GET `/api/cycles/{id}/verification` returns a cached timestamped report and does not trigger expensive replay on each visit.

Generic supported backend commands remain: `verify-cycle`, `verify-pending`, `catch-up-cycles`, `audit-manifest-storage`, `regenerate-manifest` and `upload-existing-manifests`. Use operator configuration and avoid concurrent manual/automatic publication. `YAC_RECOVERY_MODE=true` isolates controlled maintenance. These are supported safety capabilities, not a promise that unavailable chain history can be reconstructed from nowhere.

[Architecture and trust](architecture.md): centralized publisher, upgradeable program, no on-chain challenge or fraud-proof mechanism.
