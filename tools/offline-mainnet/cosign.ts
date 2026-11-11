import { Keypair, Transaction } from "@solana/web3.js";
import type { DeploymentPins } from "./deployment-policy";
import { pinsDigest, type SignatureResult } from "./signing";
import {
  checkReturnedSignatures,
  type ReviewRpc,
  type PreparedReview,
  type BudgetLimits,
} from "./online-review";

// Key loading is deliberately deferred until approval, offline signatures and
// fresh chain state have passed. No send capability in this function.
export async function cosignReviewed(
  rpc: ReviewRpc,
  pins: DeploymentPins,
  elf: Buffer,
  prepared: PreparedReview,
  results: SignatureResult[],
  limits: BudgetLimits,
  approval: { messageSha256: string; pinsSha256: string },
  loadKey: (role: "payer" | "bufferAuthority") => unknown,
) {
  if (
    approval.messageSha256 !== prepared.request.messageSha256 ||
    approval.pinsSha256 !== pinsDigest(pins)
  )
    throw Error("Explicit approval required");
  const checked = await checkReturnedSignatures(
    rpc,
    pins,
    elf,
    prepared,
    results,
    limits,
  );
  const roles =
    prepared.request.operation === "accept-buffer"
      ? (["payer", "bufferAuthority"] as const)
      : (["payer"] as const);
  const tx = Transaction.from(
    Buffer.from(checked.partialTransactionBase64, "base64"),
  );
  for (const role of roles) {
    const secret = loadKey(role);
    if (
      !Array.isArray(secret) ||
      secret.length !== 64 ||
      !secret.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    )
      throw Error("Invalid key");
    const key = Keypair.fromSecretKey(Uint8Array.from(secret));
    if (key.publicKey.toBase58() !== pins[role])
      throw Error("Wrong online role");
    tx.partialSign(key);
  }
  const raw = tx.serialize();
  if (
    !tx.verifySignatures() ||
    raw.length > 1232 ||
    !tx
      .serializeMessage()
      .equals(Buffer.from(prepared.request.messageBase64, "base64"))
  )
    throw Error("Signed transaction mismatch");
  return raw;
}
