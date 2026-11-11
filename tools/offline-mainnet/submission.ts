// Library only: no default endpoint, key loading or automatic retries.
import {
  NonceAccount,
  Transaction,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import {
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  readFileSync,
} from "node:fs";
import { inspectDeployment, type DeploymentPins } from "./deployment-policy";
import { pinsDigest } from "./signing";
import {
  prepareReview,
  type ReviewRpc,
  type PreparedReview,
  type BudgetLimits,
} from "./online-review";
import {
  readDeploymentSnapshot,
  inspectDeploymentState,
} from "./deployment-state";
export type SubmitRpc = ReviewRpc &
  Pick<
    Connection,
    "simulateTransaction" | "sendRawTransaction" | "getSignatureStatuses"
  >;
export type Attempt = {
  schema: "yamc-deployment-attempt-v1";
  pinsSha256: string;
  messageSha256: string;
  wireSha256: string;
  signature: string;
  nonce: string;
  operation: string;
  preparedSlot: number;
};
export interface AttemptStore {
  create(attempt: Attempt): void;
  read(): Attempt;
}
export function fileAttemptStore(file: string): AttemptStore {
  return {
    create(attempt) {
      const fd = openSync(file, "wx", 0o600);
      try {
        writeFileSync(fd, JSON.stringify(attempt, null, 2) + "\n");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    },
    read() {
      return JSON.parse(readFileSync(file, "utf8"));
    },
  };
}
function base58(bytes: Buffer) {
  let n = BigInt("0x" + bytes.toString("hex")),
    out = "";
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  while (n) {
    out = alphabet[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b) break;
    out = "1" + out;
  }
  return out;
}
function inspectSigned(
  p: DeploymentPins,
  elf: Buffer,
  prepared: PreparedReview,
  raw: Buffer,
): Attempt {
  if (
    prepared.schema !== "yamc-mainnet-prepared-review-v1" ||
    prepared.pinsSha256 !== pinsDigest(p) ||
    prepared.broadcastAuthorization !== false
  )
    throw Error("Prepared record mismatch");
  const tx = Transaction.from(raw);
  inspectDeployment(p, prepared.request, elf);
  if (
    raw.length > 1232 ||
    !tx
      .serializeMessage()
      .equals(Buffer.from(prepared.request.messageBase64, "base64")) ||
    !tx.verifySignatures() ||
    !tx.serialize().equals(raw) ||
    !tx.signature
  )
    throw Error("Fully signed exact transaction required");
  return {
    schema: "yamc-deployment-attempt-v1",
    pinsSha256: pinsDigest(p),
    messageSha256: prepared.request.messageSha256,
    wireSha256: createHash("sha256").update(raw).digest("hex"),
    signature: base58(tx.signature),
    nonce: prepared.request.nonceValue,
    operation: prepared.request.operation,
    preparedSlot: prepared.observedSlot,
  };
}
async function fresh(
  rpc: ReviewRpc,
  p: DeploymentPins,
  elf: Buffer,
  prepared: PreparedReview,
  limits: BudgetLimits,
  minSlot: number,
) {
  const review = await prepareReview(
    rpc,
    p,
    elf,
    prepared.request.operation,
    limits,
    minSlot,
  );
  if (
    review.request.messageBase64 !== prepared.request.messageBase64 ||
    review.request.messageSha256 !== prepared.request.messageSha256
  )
    throw Error("State changed; do not send");
  return review;
}
export async function submitOnce(
  rpc: SubmitRpc,
  p: DeploymentPins,
  elf: Buffer,
  prepared: PreparedReview,
  raw: Buffer,
  limits: BudgetLimits,
  store: AttemptStore,
  approval: { messageSha256: string; pinsSha256: string },
) {
  const attempt = inspectSigned(p, elf, prepared, raw);
  if (
    approval.messageSha256 !== attempt.messageSha256 ||
    approval.pinsSha256 !== attempt.pinsSha256
  )
    throw Error("Explicit operation approval required");
  const before = await fresh(
    rpc,
    p,
    elf,
    prepared,
    limits,
    prepared.observedSlot,
  );
  const simulation = await rpc.simulateTransaction(
    VersionedTransaction.deserialize(raw),
    {
      sigVerify: true,
      replaceRecentBlockhash: false,
      commitment: "finalized",
      minContextSlot: before.observedSlot,
    },
  );
  if (
    simulation.context.slot < before.observedSlot ||
    simulation.value.err !== null
  )
    throw Error("Signed simulation failed or stale");
  const checked = await fresh(
    rpc,
    p,
    elf,
    prepared,
    limits,
    simulation.context.slot,
  );
  // Must persist before any network send. Existing file or storage failure aborts.
  store.create(attempt);
  try {
    const signature = await rpc.sendRawTransaction(raw, {
      skipPreflight: false,
      preflightCommitment: "finalized",
      minContextSlot: checked.observedSlot,
      maxRetries: 0,
    });
    if (signature !== attempt.signature)
      return {
        status: "UNKNOWN_DO_NOT_RESEND" as const,
        signature: attempt.signature,
      };
    return { status: "SUBMITTED_NOT_FINALIZED" as const, signature };
  } catch {
    return {
      status: "UNKNOWN_DO_NOT_RESEND" as const,
      signature: attempt.signature,
    };
  }
}
export async function reconcileAttempt(
  rpc: SubmitRpc,
  p: DeploymentPins,
  elf: Buffer,
  prepared: PreparedReview,
  raw: Buffer,
  store: AttemptStore,
) {
  const expected = inspectSigned(p, elf, prepared, raw),
    saved = store.read();
  for (const field of Object.keys(expected) as (keyof Attempt)[])
    if (saved[field] !== expected[field])
      throw Error("Attempt record mismatch");
  let snapshot = await readDeploymentSnapshot(rpc, p); // Also rejects wrong network before status lookup.
  const status = (
    await rpc.getSignatureStatuses([expected.signature], {
      searchTransactionHistory: true,
    })
  ).value[0];
  if (status?.confirmationStatus !== "finalized")
    return { status: "PENDING_OR_UNKNOWN_DO_NOT_RESEND" as const };
  if (status.err !== null)
    return {
      status: "FINALIZED_FAILURE_REVIEW_NONCE" as const,
      signature: expected.signature,
    };
  if (snapshot.slot < status.slot)
    snapshot = await readDeploymentSnapshot(rpc, p);
  if (snapshot.slot < status.slot)
    return { status: "FINALIZED_AWAITING_FRESH_STATE" as const };
  const nonce = NonceAccount.fromAccountData(snapshot.accounts[0]!.data).nonce;
  if (nonce === expected.nonce)
    throw Error("Finalized signature but nonce unchanged");
  inspectDeploymentState(
    p,
    elf,
    snapshot,
    prepared.request.operation === "deploy" ? "deployed" : "deploy",
    prepared.request.operation === "deploy" ? expected.nonce : nonce,
  );
  return {
    status: "FINALIZED_AND_STATE_VERIFIED" as const,
    signature: expected.signature,
    slot: status.slot,
  };
}
