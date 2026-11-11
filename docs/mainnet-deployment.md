# Mainnet — PRE-LAUNCH

Status as of 11 November 2026: program deployed and reserves initialized; activation has not been scheduled. No mainnet distribution cycles are published. Admission and publication services are disabled. This document is a dated snapshot, not continuous monitoring.

| Identity | Address |
| --- | --- |
| Network | Solana mainnet-beta |
| Program | `GUyqmcRPYWxjdM3mXZDT89JAtxBtEWs31BNEKQ6KUT5H` |
| CATSHIT mint | `BcExYqanw2XzVAAsos1FdMCMX952FmaU7v7sqKm3QxAT` |
| Rewards account | `ETrMGtFy53xQ4y3Atq2EUQp9rkFHc7UN4s48Ez3peyFF` |
| Faucet vault | `5jbcATvjWxsLLYtFazEWZvBkoQuJhyxQozNqwsqRwB53` |
| Reward vault | `EWffvm6Uyo157BV5ZX5VPqYscNGTsFebQethjKFJQJQq` |

[Program explorer](https://explorer.solana.com/address/GUyqmcRPYWxjdM3mXZDT89JAtxBtEWs31BNEKQ6KUT5H) · [Mint explorer](https://explorer.solana.com/address/BcExYqanw2XzVAAsos1FdMCMX952FmaU7v7sqKm3QxAT) · [Public status and transparency](https://yetanothermarket.cat/verify)

## Economics and lifecycle

100,000,000 CATSHIT, six decimals. Mint and freeze authorities disabled. Initial allocation: 1,000,000 faucet / 99,000,000 rewards; no separate team/treasury allocation. The upgrade authority remains in place.

- Faucet: 1,000 per eligible allocation, at most 1,000 allocations across both waves. Wave 1 uses SGT ownership; Wave 2 uses sign-in and CAPTCHA for remaining grants. Server authorization does not reserve tokens.
- One-time on-chain activation sets faucet opening, second-wave opening and mining start, and assigns the initial issuer. No dates are currently set.
- Pre-lock begins with faucet opening; PP remain zero before mining start.
- Daily cycles (86,400 seconds), 250,000 tokens per nonempty funded cycle. Empty cycles consume no reward allocation. 396 funded cycles are not a guaranteed calendar end date.
- At emission exhaustion, new PP stop; historical claims and withdrawals remain available under the program rules. Withdrawals require a 24-hour cooldown.

## Verification and release

Initialization history begins at slot `467943217`. Full replay requires retained finalized history from that point, the mainnet IDL and canonical manifests. No mainnet cycle exists to replay yet. The historical devnet deployment has different identities and parameters; its tokens do not migrate automatically.

Candidate program ELF SHA256: `1a537b23914e1e3bf08957bbd00d04c31b06453b742c7fe913863b2a03c5385d`.

Runtime IDL: `packages/shared/src/idl.mainnet.json` (mainnet build profile), mirrored by `infra/mainnet/runtime-idl.json` for the server image. See [release status](release.md), [protocol](protocol.md), and [mainnet infrastructure](../infra/mainnet/PREPARING.md).

The publisher and upgrade authority are trusted roles. Independent replay can detect an incorrect allocation but cannot veto or reverse it on-chain. No price, liquidity, return or Store publication date is promised.
