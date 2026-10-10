# Canonical devnet deployment

Public metadata was checked against `/api/config` and `/api/cycles` on 2026-10-10.

| Field                        | Value                                          |
| ---------------------------- | ---------------------------------------------- |
| Network                      | Solana devnet                                  |
| Program                      | `BfNiASrYNqmARu2TQ1eBa1PJ6KgVHTNn44ATk5rJe6zW` |
| CATSHIT mint                 | `A8viyp5aA6Pw59HzzVWPd5tkgS2gup2cZyd7TPmyAupZ` |
| Replay start slot            | `504431875`                                    |
| Cycle genesis (Unix seconds) | `1790431527`                                   |
| Cycle duration               | `3600` seconds                                 |
| Nonempty cycle budget        | `100000000000` base units = 100,000 CATSHIT    |

[Program on Solana Explorer](https://explorer.solana.com/address/BfNiASrYNqmARu2TQ1eBa1PJ6KgVHTNn44ATk5rJe6zW?cluster=devnet) · [Mint](https://explorer.solana.com/address/A8viyp5aA6Pw59HzzVWPd5tkgS2gup2cZyd7TPmyAupZ?cluster=devnet)

## Public release

Hosted Android release: **0.13.3 (25)**, signed devnet demo, tested on a physical phone. Visual demo controls do not alter funds/PP. Source is now **0.13.4 (26)** because the maintainer requested replacement of the Nine Lives music with a CC0-based loop during cleanup. The hosted APK remains unchanged until a separate release is deployed.

[Download APK](https://yetanothermarket.cat/downloads/yet-another-cat-0.13.3.apk) · [Release metadata](https://yetanothermarket.cat/downloads/release.json)

132,489,509 bytes. SHA-256:

```text
e5432a9ab5f0fa91e37a53df16739b48f74d82be9e3e054b4cd12967e6095a61
```

## Endpoints

- [Website](https://yetanothermarket.cat) — complete English and Catalan.
- [Health](https://yetanothermarket.cat/api/health) — 503 may contain meaningful degraded status.
- [Explorer](https://yetanothermarket.cat/cycles) — choose a cycle for its immutable manifest/report.
- [Free devnet SOL](https://faucet.solana.com) — transaction fees and account rent still apply.
- [Source](https://github.com/LumenBrowny/yet-another-market-cat) — may require authorization while release hygiene is in progress.

Manifests use the canonical program/network namespace and are linked by the explorer. No private RPC address, operator token or signing key belongs in public metadata. CATSHIT is not launched on mainnet; mainnet SKR lookup is a separate cosmetic feature.
