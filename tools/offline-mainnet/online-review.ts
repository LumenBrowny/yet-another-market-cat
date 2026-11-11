// Read-only orchestration. No private keys, online signatures or broadcast.
import { NonceAccount, PublicKey, type Connection } from "@solana/web3.js";
import {
  digest,
  expectedDeploymentMessage,
  type DeploymentPins,
  type DeploymentRequest,
} from "./deployment-policy";
import {
  readDeploymentSnapshot,
  inspectDeploymentState,
} from "./deployment-state";
import { pinsDigest, verifyResult, type SignatureResult } from "./signing";

export type ReviewRpc = Pick<
  Connection,
  | "getGenesisHash"
  | "getMultipleAccountsInfoAndContext"
  | "getMinimumBalanceForRentExemption"
  | "getFeeForMessage"
  | "getBalanceAndContext"
>;
export type BudgetLimits = {
  maxFeeLamports: number;
  maxPayerDebitLamports: number;
  payerReserveLamports: number;
};
export type PreparedReview = {
  schema: "yamc-mainnet-prepared-review-v1";
  pinsSha256: string;
  request: DeploymentRequest;
  observedSlot: number;
  feeLamports: number;
  payerDebitLamports: number;
  payerBalanceLamports: number;
  broadcastAuthorization: false;
};
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
export async function prepareReview(
  rpc: ReviewRpc,
  p: DeploymentPins,
  elf: Buffer,
  operation: DeploymentRequest["operation"],
  limits: BudgetLimits,
  minimumSlot = 0,
): Promise<PreparedReview> {
  if (
    !integer(minimumSlot) ||
    ![
      limits.maxFeeLamports,
      limits.maxPayerDebitLamports,
      limits.payerReserveLamports,
    ].every(integer)
  )
    throw Error("Invalid review limits");
  const snapshot = await readDeploymentSnapshot(rpc, p);
  if (snapshot.slot < minimumSlot)
    throw Error("RPC state is older than prepared request");
  const n = snapshot.accounts[0];
  if (!n) throw Error("Nonce missing");
  const nonceValue = NonceAccount.fromAccountData(n.data).nonce;
  inspectDeploymentState(p, elf, snapshot, operation, nonceValue);
  const [programRent, dataRent, bufferRent, nonceRent] = await Promise.all(
    [36, 45 + elf.length, 37 + elf.length, 80].map((size) =>
      rpc.getMinimumBalanceForRentExemption(size, "finalized"),
    ),
  );
  if (
    ![programRent, dataRent, bufferRent, nonceRent].every(
      (v) => integer(v) && v > 0,
    ) ||
    programRent !== p.programRentLamports
  )
    throw Error("Rent changed or invalid; review pins again");
  const bufferBalance = snapshot.accounts[1]!.lamports;
  if (bufferBalance < bufferRent || n.lamports < nonceRent)
    throw Error("Buffer/nonce underfunded");
  const tx = expectedDeploymentMessage(p, operation, nonceValue);
  const fee = await rpc.getFeeForMessage(tx.compileMessage(), "finalized");
  if (
    fee.context.slot < snapshot.slot ||
    fee.value === null ||
    !integer(fee.value) ||
    fee.value > limits.maxFeeLamports
  )
    throw Error("Unavailable, stale or excessive fee quote");
  // Program create precedes buffer drainage: payer needs Program rent + fee even
  // if excess buffer lamports eventually reimburse more than ProgramData rent.
  const debit =
    fee.value +
    (operation === "deploy"
      ? programRent + Math.max(0, dataRent - bufferBalance)
      : 0);
  if (!integer(debit) || debit > limits.maxPayerDebitLamports)
    throw Error("Operation exceeds payer debit cap");
  const balance = await rpc.getBalanceAndContext(new PublicKey(p.payer), {
    commitment: "finalized",
    minContextSlot: fee.context.slot,
  });
  if (
    balance.context.slot < fee.context.slot ||
    !integer(balance.value) ||
    !integer(debit + limits.payerReserveLamports) ||
    balance.value < debit + limits.payerReserveLamports
  )
    throw Error("Payer balance stale or insufficient");
  const bytes = tx.serializeMessage();
  return {
    schema: "yamc-mainnet-prepared-review-v1",
    pinsSha256: pinsDigest(p),
    request: {
      operation,
      nonceValue,
      messageBase64: bytes.toString("base64"),
      messageSha256: digest(bytes),
    },
    observedSlot: snapshot.slot,
    feeLamports: fee.value,
    payerDebitLamports: debit,
    payerBalanceLamports: balance.value,
    broadcastAuthorization: false,
  };
}
export async function checkReturnedSignatures(
  rpc: ReviewRpc,
  p: DeploymentPins,
  elf: Buffer,
  prepared: PreparedReview,
  results: SignatureResult[],
  limits: BudgetLimits,
) {
  if (
    prepared.schema !== "yamc-mainnet-prepared-review-v1" ||
    prepared.pinsSha256 !== pinsDigest(p) ||
    prepared.broadcastAuthorization !== false
  )
    throw Error("Prepared review identity mismatch");
  const required =
    prepared.request.operation === "deploy" ? ["admin", "program"] : ["admin"];
  if (
    results.length !== required.length ||
    new Set(results.map((r) => r.role)).size !== required.length ||
    !required.every((role) => results.some((r) => r.role === role))
  )
    throw Error("Missing, duplicate or unexpected offline signatures");
  for (const result of results) verifyResult(p, prepared.request, elf, result);
  const fresh = await prepareReview(
    rpc,
    p,
    elf,
    prepared.request.operation,
    limits,
    prepared.observedSlot,
  );
  for (const field of [
    "operation",
    "nonceValue",
    "messageBase64",
    "messageSha256",
  ] as const)
    if (fresh.request[field] !== prepared.request[field])
      throw Error("State changed since signing; do not submit");
  const tx = expectedDeploymentMessage(
    p,
    prepared.request.operation,
    prepared.request.nonceValue,
  );
  for (const result of results)
    tx.addSignature(
      new PublicKey(result.signer),
      Buffer.from(result.signatureBase64, "base64"),
    );
  if (!tx.verifySignatures(false))
    throw Error("Partial transaction signature failure");
  return {
    status: "OFFLINE_SIGNATURES_AND_FRESH_STATE_MATCH" as const,
    freshReview: fresh,
    partialTransactionBase64: tx
      .serialize({ requireAllSignatures: false, verifySignatures: true })
      .toString("base64"),
    missingOnlineSigners:
      prepared.request.operation === "deploy"
        ? [p.payer]
        : [p.payer, p.bufferAuthority],
    broadcastAuthorization: false as const,
  };
}
