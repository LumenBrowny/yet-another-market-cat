# Mainnet deployment message policy — preparation only

`deployment-policy.ts` is a pure, unsigned message builder/reviewer. It has no RPC,
key loading, signing or sending entrypoint. Do not treat its successful result as
deployment approval. Existing rehearsal tools keep their local-network guards.

Before use, independently review and retain `DeploymentPins` on the offline machine.
Do not accept pins supplied by an incoming transaction request. Pins must contain
the verified program/admin identities, distinct payer/upload authority/buffer/nonce
identities, exact ELF hash/length and the reviewed rent for the 36-byte Program
account. All fields are required; generated drafts deliberately contain nulls.
The ProgramData PDA is derived, not accepted from a request.

Only two exact legacy messages are supported:

1. `accept-buffer`: advance durable nonce with admin, then loader checked authority
   transfer requiring old buffer authority and incoming admin signatures.
2. `deploy`: advance nonce, fixed compute-unit limit with no priority-price instruction,
   create the pinned Program account, deploy the pinned buffer with the offline admin
   as the initial upgrade authority. Payer and Program signatures are also required.

Messages with extra instructions, changed accounts/flags/data/fee payer or changed
nonce differ byte-for-byte and are rejected. The local ELF must match trusted pins.
The result is always `transactionAuthorization: false`.

## What an offline message cannot establish

- A Solana transaction does not carry a genesis hash. Verify mainnet genesis online
  against the pinned value; the policy label alone is not cryptographic chain binding.
- Buffer acceptance contains no destination program ID; deployment contains no old
  upload-authority account. Those facts cannot be inferred from these respective bytes.
- Buffer contents are not embedded in the transaction. Independently read finalized
  loader state, authority and exact executable bytes before accepting the buffer,
  then again after acceptance before constructing/signing deployment.
- Check finalized nonce owner, initialized state, authority and current value.
- Check Program/ProgramData absence, current rent, buffer balance, all required
  account funding and the full SOL/fee budget. `programRentLamports` bounds only the
  Program account creation; it is **not** a total deployment-spending cap.
- After signatures return, verify every signature and the exact message, simulate,
  obtain operation-specific approval, then submit. On timeout query status/nonce
  before preparing another transaction. Durable nonce does not imply replayability.
- After finalization verify executable, ProgramData, initial authority and ELF hash.

`deployment-state.ts` now reads genesis and one finalized atomic account snapshot
using read-only Connection methods. Its pure inspector checks nonce owner/version/
authority/value, buffer owner/authority/exact ELF, pre-deploy account absence and
post-deploy Program/ProgramData linkage, authority, bytes and nonce consumption.
It does not prove transaction success from state alone: a finalized successful
signature and post-send freshness must also be checked by the future submission
adapter. Balance checks only require a positive balance, not sufficient rent.
RPC is still a trust boundary; a snapshot is not an offline cryptographic proof.
Do not expose raw RPC exceptions containing private endpoint credentials.

Production orchestration, offline signing adapters, fresh rent/fee-budget enforcement,
signature confirmation and request-to-snapshot freshness remain to be implemented.
No mainnet signing package has
been issued by this module. Initialization, reward funding and activation need their
own policies; they are not accepted by this deployment reviewer.

## Configuration review bundle

```text
npx tsx scripts/release/prepare-mainnet-review.ts PROFILE CANDIDATE NEW_DIRECTORY
```

This verifies candidate ELF/IDL hashes against the reviewed profile and writes a
non-runnable configuration projection, incomplete deployment pins, public identities
and candidate IDL. It refuses overwriting an existing directory. It copies no private
keys, RPC credentials or live configuration and performs no network requests.
Mainnet client builds must use this candidate IDL in an isolated release checkout;
do not change the running devnet checkout to make the validation pass.

## Offline partial signing

`signing.ts` implements strict request review, role-bound signing and verification
of returned partial signatures. `offline.ts` is its CLI; it has no RPC/send entrypoint.
The trusted pins and exact ELF must be independently installed in
`trusted/deployment-pins.json` and `trusted/cat_shit_mining.so` relative to the
working directory. Never replace trusted files with attachments from a request.
Request JSON accepts only operation, nonceValue, messageBase64 and messageSha256.

Example commands for a future reviewed, complete packet:

```text
node offline.cjs review request.json
node offline.cjs sign request.json admin PATH_TO_ADMIN_JSON MESSAGE_SHA256 PINS_SHA256 result.admin.json
node offline.cjs sign request.json program PATH_TO_PROGRAM_JSON MESSAGE_SHA256 PINS_SHA256 result.program.json
```

`program` is permitted only for deploy. Accept-buffer requires the offline admin
plus online payer/upload-authority signatures. Deploy requires offline admin AND
offline program signatures, plus online payer. Never transfer private Program keys
to obtain the second signature online. Existing result files cannot be overwritten.
Keys must be 64-byte Solana JSON with matching seed/public bytes and role address.
Review mode does not read a key file. Both message and independent pins digest
must be explicitly supplied to sign. Pin digest is SHA256 of the canonical ordered
field array defined in `pinsDigest`, not the file's raw-byte SHA256.

`verifyResult` rejects changed request/pins/role/address, noncanonical signatures
and invalid Ed25519 signatures. It does NOT authorize broadcast or attest nonce,
RPC identity or buffer bytes. Successful review does not attest operator approval.
A partial signature can become executable after the other parties sign; it must
not be treated as harmless merely because the tool never sends transactions.
Durable nonce has no clock-based expiry. Do not sign replacements blindly on timeout.

Current validation uses disposable keys and a local bundled CLI. Mainnet preparation/
submission orchestration is still separate; no real signing request has been issued.

## Read-only online preparation and returned-signature checks

`online-review.ts` connects finalized state inspection to the offline request/result
format. `online.ts` exposes two commands (run with tsx or a reviewed bundled CLI):

```text
npx tsx tools/offline-mainnet/online.ts prepare OP PINS ELF LIMITS NEW_OUTPUT_DIRECTORY
npx tsx tools/offline-mainnet/online.ts check PREPARED_REVIEW PINS ELF LIMITS NEW_OUTPUT_DIRECTORY RESULT_ADMIN [RESULT_PROGRAM]
```

The private HTTPS endpoint is supplied through `YAMC_MAINNET_REVIEW_RPC`, never a
public profile. Do not put its value in shell history or shared logs. CLI errors
are redacted, redirects are refused and requests have 20-second timeouts.
Output directories are created exclusively; earlier artifacts are never overwritten.

LIMITS is independently reviewed JSON with integer lamport fields
`maxFeeLamports`, `maxPayerDebitLamports`, `payerReserveLamports`. There are no
default spending limits. These limits concern only the current acceptance/deploy
operation AFTER upload; they do not cover upload, initialization or service budgets.

Preparation validates genesis, finalized account state, nonce, exact ELF and current
rent. Program rent must match independently installed pins; a change requires review,
not automatic adjustment. Buffer and nonce must be rent-funded. A finalized non-null
fee quote and sufficiently recent payer balance must satisfy explicit caps/reserve.
Deploy debit includes Program rent plus any ProgramData shortfall after buffer
drainage. Even an overfunded buffer cannot cover Program create before it is drained.

Only request.json travels to the signer. Keep original review.json online for the
return check. `check` requires exactly the expected offline roles, verifies every
result against that original request/pins, and repeats live checks at a slot no older
than preparation. A changed nonce/message is rejected. It outputs a partially signed
transaction, not an executable transaction with every signature or send permission.

No online private keys are loaded. No signed simulation, payer/upload signature,
broadcast or signature-status reconciliation is implemented by these commands.
State may change after a read: use the separate ceremony below for signing and
submission. Do not manually broadcast the review artifact to bypass its gates.

## Explicit submission gate

`submission.ts` accepts an already fully signed transaction, never private keys.
`submitOnce` requires explicit message/pins digests, exact policy message and every
valid signature. It repeats state/rent/fee/balance checks, runs finalized simulation
with `sigVerify: true` and `replaceRecentBlockhash: false`, then rechecks state at
least as recent as the simulation. Network changes after a read remain possible.

Before send, an exclusive attempt file is written and fsynced. It binds the pins,
message, signed wire bytes, nonce, operation and the deterministic payer signature.
Keep the original fully signed transaction and prepared review for reconciliation.
Storage failure/existing attempt prevents send. File fsync is used; no claim of
directory-metadata durability under every OS/power-loss scenario is made.
Use one persistent attempt path per operation; never evade the guard by changing
paths or deleting the journal after an unknown outcome.

Sending uses preflight and `maxRetries: 0`; it is invoked at most once by this call.
Timeout/transport error/mismatching RPC signature returns UNKNOWN_DO_NOT_RESEND.
There is no automatic resend, replacement nonce or loop. `reconcileAttempt` validates
the journal against the original signed bytes and checks signature history and a
finalized account snapshot at/after the transaction slot. Finalized errors are kept
separate from unknown outcomes. Success requires nonce consumption and exact expected
authority/ProgramData/ELF state. A later legitimate state change can require manual
review rather than passing these immediate-post-state checks.

## Controlled online ceremony

`ceremony.ts` uses the same private HTTPS environment input and explicit limits.
It has no default key paths. These commands are documentation, not authorization
to execute a mainnet operation:

```text
npx tsx tools/offline-mainnet/ceremony.ts cosign NEW_OPERATION_DIR PINS ELF LIMITS REVIEW MSG_SHA PINS_SHA PAYER_KEY UPLOAD_KEY_OR_DASH ADMIN_RESULT [PROGRAM_RESULT]
npx tsx tools/offline-mainnet/ceremony.ts send OPERATION_DIR PINS ELF LIMITS MSG_SHA PINS_SHA
npx tsx tools/offline-mainnet/ceremony.ts status OPERATION_DIR PINS ELF LIMITS
```

For deploy use `-` instead of UPLOAD_KEY and supply both offline results. For
accept-buffer supply uploadAuthority and only the admin result. The co-signer
checks explicit approval and offline results/fresh state before loading keys;
each online key must match its pinned role. Admin/program keys stay offline.

Co-signing reserves a new directory and writes/fsyncs the original review and
fully signed `signed.bin`, then writes `ready.json` last. Failed/incomplete
directories are not reusable. Signed artifacts are broadcastable authorization:
store them securely alongside the persistent journal, never publish them.

`send` refuses an existing `attempt.json` before RPC submission checks. The library
persists that journal before calling send. Any failure after journal creation,
including failure to save a response, must be reconciled with `status`. Never
delete the journal or copy artifacts to a fresh directory to retry. `status` needs
no private keys and cannot send. Reports are saved to timestamped exclusive files.
File fsync does not guarantee directory metadata survival on every OS/power loss.

This CLI covers acceptance/deploy only, not buffer upload or token initialization.
All mainnet operation approvals and independent pin/artifact review remain required.

## Nonce and buffer preparation

`upload.ts` prepares two rent-funded accounts and writes the pinned ELF in 900-byte
chunks. `upload-cli.ts` performs at most ONE new transaction per invocation:

```text
npx tsx tools/offline-mainnet/upload-cli.ts JOURNAL_DIR PINS ELF UPLOAD_PLAN KEY_DIR PLAN_SHA256
```

Same HTTPS RPC environment and error redaction as the ceremony CLI. KEY_DIR must
contain the required online role files (payer, nonceAccount, buffer,
uploadAuthority); no admin/program key is loaded. There are no default key paths.

UPLOAD_PLAN fields: schema `yamc-upload-plan-v1`, pinsSha256 (canonical pins digest),
nonceRent, bufferRent, maxFeeLamports, maxTotalDebitLamports, payerReserveLamports.
All amounts are integer lamports. Approve `uploadPlanDigest(plan)` independently.
Rent must match fresh RPC quotes exactly. The conservative total is both account
rents plus (2 + ceil(ELF bytes / 900)) times the per-transaction fee cap. This
excludes later acceptance/deploy/initialization costs. Remaining payer funds must
cover every remaining capped fee, remaining rents and the reserve.

Each step requires the prior steps finalized, exact nonce authority, buffer owner,
authority, size and written prefix, with unwritten suffix zero. Existing accounts
without the corresponding journal are rejected, not adopted. Program/ProgramData
must remain absent. Signature statuses are batched up to 256 per RPC call.

Fee quotes can lag the finalized blockhash across RPC backends. Before signing,
the uploader makes at most four read-only quote attempts for the same message,
one second apart, accepting only a non-null quote at or after the blockhash slot.
Over-cap/invalid quotes and RPC exceptions stop immediately. This does not retry
transactions, change blockhashes or relax the fee cap.

Upload account snapshots pass the required slot to RPC as `minContextSlot`.
An older snapshot or explicit RPC minimum-slot-not-reached error (-32016) gets
at most four read attempts, one second apart. Freshness and all account/byte
checks remain mandatory; other errors stop immediately.

Before send: genesis, fee/balance, signed simulation, fresh account snapshot, then
exclusive fsynced journal containing signed wire and its blockhash validity height.
The initial setup uses recent blockhashes, not the durable nonce being created.
There is no automatic expired transaction replacement. Unknown or failed recorded
attempts block progress for manual review. Reinvoke with THE SAME journal to check
finalization and advance one step; never delete records or choose a fresh journal
to bypass a stop. Concurrency is unsupported; exclusive per-step records prevent
two callers from sending the same step through this tool.

This intentionally sequential implementation waits for finalization between writes;
large programs take longer than a pipelined uploader. Final success requires the
entire buffer to match the pinned ELF. Then use `online.ts prepare accept-buffer`
and the offline/online ceremony. The upload command cannot initialize or activate
the token program. Signed journal files are sensitive; keep them private.

## Unscheduled initialization policy (preparation only)

`initialization-policy.ts` builds exact `initialize` and `rewards` messages for
independently supplied mainnet pins. It does not import the rehearsal program ID.
Both use admin as fee/rent payer and nonce authority. Initialize additionally
requires the offline mint key. No schedule/activation operation is accepted.

Initialize atomically creates the 6-decimal SPL mint, mints 100M to the admin ATA,
revokes mint authority (freeze authority absent from creation), and calls
initializeLaunchConfig, which deposits 1M into the faucet vault. The intermediate
99M remain in admin ATA. A second, independently signed rewards request moves
99M to the reward vault with genesis=0, duration=86400, emission=250000 tokens/day.
Do not report setup complete after only the first transaction. Activation and
admission issuer assignment remain separate future operations.

`initialization-signing.ts` verifies exact message/pins/roles and produces detached
admin/mint signatures. `initialization-offline.ts` uses fixed paths
`trusted/initialization-pins.json` and `trusted/cat_shit_mining.so`:

```text
node initialization-offline.cjs review REQUEST
node initialization-offline.cjs sign REQUEST admin|mint KEY MESSAGE_HASH PINS_HASH NEW_RESULT
```

The existing deployment signer cannot sign initialization. The new signer must be
built and independently installed as a separate reviewed kit. Draft requests are
not instructions to sign or broadcast. Do not
use the local-only rehearsal sender on mainnet or route initialization into the
deployment submitter, whose policy correctly rejects these messages.

`initialization-online.ts` provides atomic finalized state inspection of deployed
ELF/authority/nonce and all mint/config/vault accounts, fresh rent/fee/admin budget
checks, exact offline-signature assembly, signed simulation and single-attempt
submission with an exclusive fsynced journal. Unknown send outcomes are reconciled
by signature history and expected post-state, never automatically resent. It has
no private-key loading and no activation capability. Post-state requires absent
mint/freeze authority, exact 100M supply, 1M faucet, 99M intermediate admin balance
or final reward vault balance, pinned publisher, and all schedule fields zero.

The CLI uses the same private `YAMC_MAINNET_REVIEW_RPC` HTTPS environment input:

```text
npx tsx tools/offline-mainnet/initialization-cli.ts prepare initialize|rewards PINS ELF LIMITS NEW_REVIEW_DIR
npx tsx tools/offline-mainnet/initialization-cli.ts assemble PREPARED_REVIEW PINS ELF LIMITS NEW_OPERATION_DIR RESULT_ADMIN [RESULT_MINT]
npx tsx tools/offline-mainnet/initialization-cli.ts send OPERATION_DIR PINS ELF LIMITS MESSAGE_HASH PINS_HASH
npx tsx tools/offline-mainnet/initialization-cli.ts status OPERATION_DIR PINS ELF LIMITS
```

Limits fields are integer lamports: maxFeeLamports, maxAdminDebitLamports,
adminReserveLamports. Admin must have its own SOL; deployment-payer funds cannot
implicitly pay admin-owned instruction costs. Initialize requires admin+mint
signatures; rewards requires only admin. After successful initialize, prepare a
NEW rewards request using the consumed nonce's new value. Reuse the same permanent
operation directory for status; never erase a journal or change paths to resend.
Fully signed artifacts authorize transactions and must be stored privately.

Connected local rehearsal with exact candidate ELF and disposable identities
passed both operations, including deliberate lost send responses, reconciliation,
and refusal of repeat submissions. This does not authorize any mainnet operation.
