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

Android **0.13.6 (28)**, signed devnet demo, verified as an update on a physical phone. Visual demo controls do not alter funds/PP. The public APK and source use the current CC0-based Nine Lives loop. [Release notes](release.md).

[Download APK](https://yetanothermarket.cat/downloads/yet-another-cat-0.13.6.apk) · [Release metadata](https://yetanothermarket.cat/downloads/release.json)

118,640,313 bytes. SHA-256:

```text
0f9cf1c8de2479ed0085b816a9a562465b23a38e3c2261af1db45f6bf9e0d797
```

## Endpoints

- [Website](https://yetanothermarket.cat) — complete English and Catalan.
- [Health](https://yetanothermarket.cat/api/health) — 503 may contain meaningful degraded status.
- [Explorer](https://yetanothermarket.cat/cycles) — choose a cycle for its immutable manifest/report.
- [Free devnet SOL](https://faucet.solana.com) — transaction fees and account rent still apply.
- [Source](https://github.com/LumenBrowny/yet-another-market-cat) — public release source and CI.

Manifests use the canonical program/network namespace and are linked by the explorer. No private RPC address, operator token or signing key belongs in public metadata. CATSHIT is not launched on mainnet; mainnet SKR lookup is a separate cosmetic feature.
