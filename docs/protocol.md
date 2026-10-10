# Protocol

The [canonical deployment](devnet-deployment.md) uses Solana devnet and one-hour cycles. Compatibility package/YAC identifiers remain unchanged.

## Custody and Poop Points

`MiningPosition` records a wallet’s locked CATSHIT and withdrawal state under program custody. MWA signs user lock, withdrawal and claim instructions. The indexer folds successful finalized events in canonical order. Withdrawal requests affect eligibility at their finalized event time; execution must not count that change twice.

PP use integer milli-points (1 PP = 1,000 units). Each effective-stake interval earns its tier rate multiplied by elapsed finalized block time. The current interval ends at the indexed finalized watermark, not the device clock or a newer unindexed RPC tip. Closing the app has no effect.

| Minimum locked CATSHIT | PP/sec | State        |
| ---------------------: | -----: | ------------ |
|            Below 1,000 |      0 | DEAD_INSIDE  |
|                  1,000 |      1 | CALM         |
|                  2,500 |    1.5 | SUSPICIOUS   |
|                  5,000 |      2 | ACTIVE       |
|                 10,000 |      3 | CONCERNED    |
|                 25,000 |      5 | DISTRESSED   |
|                 50,000 |      8 | AIRBORNE     |
|                100,000 |     12 | PANIC        |
|                250,000 |     20 | OVERDRIVE    |
|                500,000 |     25 | TRANSCENDENT |

## Supply and settlement

Fixed total supply: 100,000,000 CATSHIT (six decimals). Mint and freeze authorities are disabled. Initial faucet reserve: 1,000,000; allowance: 2,000 per wallet once. Initial reward reserve: 99,000,000.

Each nonempty hourly Shit Cycle allocates 100,000 existing CATSHIT. Empty cycles allocate zero and advance the sequence. Each wallet’s ideal share is cycle budget × its PP / total PP. Integer largest-remainder allocation resolves rounding deterministically; raw wallet bytes break ties. See `protocol/settlement-vectors.json` and `packages/shared/src/settlement.ts` for exact encoding/vectors.

The canonical JSON manifest commits cycle inputs, PP and allocations. SHA-256 manifest hash and Merkle root are independently checked before the configured publisher commits a cycle on chain. Publication is sequential and must fit the available finite reserve after existing unclaimed commitments.

## Claims

A claim requires the wallet signature, its own associated token account, a valid allocation proof and a fresh permanent `ClaimReceipt`. It transfers existing vault tokens and cannot exceed the cycle allocation. The receipt prevents double claims. No claim expiry, receipt closure or reserve sweep is implemented.

A valid Merkle membership proof does not prove that historical PP were correctly calculated. Independent replay supplies that evidence; it is not an on-chain fraud proof. See [verification](verification.md).
