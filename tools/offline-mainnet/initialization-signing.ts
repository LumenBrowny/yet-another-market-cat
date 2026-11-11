import { createPublicKey, verify } from "node:crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  buildInitialization,
  reviewInitialization,
  initializationPinsDigest,
  type InitializationPins,
  type InitializationRequest,
} from "./initialization-policy";
export type InitializationRole = "admin" | "mint";
export type InitializationSignature = InitializationRequest & {
  schema: "yamc-mainnet-initialization-signature-v1";
  pinsSha256: string;
  role: InitializationRole;
  signer: string;
  signatureBase64: string;
};
function signer(
  p: InitializationPins,
  r: InitializationRequest,
  role: InitializationRole,
) {
  if (role === "admin") return p.deployment.admin;
  if (role === "mint" && r.operation === "initialize") return p.mint;
  throw Error("Role not allowed");
}
export function verifyInitializationSignature(
  p: InitializationPins,
  r: InitializationRequest,
  elf: Uint8Array,
  result: InitializationSignature,
) {
  reviewInitialization(p, r, elf);
  if (
    Object.keys(result).sort().join() !==
    [
      "operation",
      "nonceValue",
      "messageBase64",
      "messageSha256",
      "schema",
      "pinsSha256",
      "role",
      "signer",
      "signatureBase64",
    ]
      .sort()
      .join()
  )
    throw Error("Unexpected signature fields");
  for (const f of [
    "operation",
    "nonceValue",
    "messageBase64",
    "messageSha256",
  ] as const)
    if (result[f] !== r[f]) throw Error("Different request");
  if (
    result.schema !== "yamc-mainnet-initialization-signature-v1" ||
    result.pinsSha256 !== initializationPinsDigest(p) ||
    result.signer !== signer(p, r, result.role)
  )
    throw Error("Signature identity mismatch");
  const sig = Buffer.from(result.signatureBase64, "base64");
  if (sig.length !== 64 || sig.toString("base64") !== result.signatureBase64)
    throw Error("Signature encoding");
  const key = createPublicKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      x: new PublicKey(result.signer).toBuffer().toString("base64url"),
    },
    format: "jwk",
  });
  if (!verify(null, Buffer.from(r.messageBase64, "base64"), key, sig))
    throw Error("Invalid signature");
  return {
    status: "VALID_INITIALIZATION_PARTIAL_SIGNATURE",
    transactionAuthorization: false,
  };
}
export function signInitialization(
  p: InitializationPins,
  r: InitializationRequest,
  elf: Uint8Array,
  role: InitializationRole,
  secret: unknown,
  messageHash: string,
  pinsHash: string,
): InitializationSignature {
  reviewInitialization(p, r, elf);
  if (
    messageHash !== r.messageSha256 ||
    pinsHash !== initializationPinsDigest(p)
  )
    throw Error("Explicit hash confirmation required");
  const expected = signer(p, r, role);
  if (
    !Array.isArray(secret) ||
    secret.length !== 64 ||
    !secret.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
  )
    throw Error("Invalid key");
  const key = Keypair.fromSecretKey(Uint8Array.from(secret));
  if (key.publicKey.toBase58() !== expected) throw Error("Wrong role key");
  const tx = buildInitialization(p, r.operation, r.nonceValue);
  tx.partialSign(key);
  const sig = tx.signatures.find((x) =>
    x.publicKey.equals(key.publicKey),
  )!.signature!;
  const result: InitializationSignature = {
    ...r,
    schema: "yamc-mainnet-initialization-signature-v1",
    pinsSha256: initializationPinsDigest(p),
    role,
    signer: expected,
    signatureBase64: sig.toString("base64"),
  };
  verifyInitializationSignature(p, r, elf, result);
  return result;
}
