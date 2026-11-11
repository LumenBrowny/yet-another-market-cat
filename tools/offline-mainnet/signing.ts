// No network, filesystem access or transaction submission in this module.
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  digest,
  inspectDeployment,
  type DeploymentPins,
  type DeploymentRequest,
} from "./deployment-policy";

export type OfflineRole = "admin" | "program";
export type SignatureResult = DeploymentRequest & {
  schema: "yamc-mainnet-partial-signature-v1";
  pinsSha256: string;
  role: OfflineRole;
  signer: string;
  signatureBase64: string;
};
export function pinsDigest(p: DeploymentPins) {
  // Stable field order, independent of JSON whitespace and property ordering.
  return digest(
    Buffer.from(
      JSON.stringify([
        p.schema,
        p.genesis,
        p.program,
        p.admin,
        p.payer,
        p.bufferAuthority,
        p.buffer,
        p.nonceAccount,
        p.binarySha256,
        p.binarySize,
        p.programRentLamports,
      ]),
    ),
  );
}
export function reviewRequest(
  p: DeploymentPins,
  r: DeploymentRequest,
  elf: Uint8Array,
) {
  if (
    Object.keys(r).sort().join() !==
    ["operation", "nonceValue", "messageBase64", "messageSha256"].sort().join()
  )
    throw Error(
      "Unexpected request fields; pins must be independently installed",
    );
  const policy = inspectDeployment(p, r, elf);
  return {
    ...policy,
    operation: r.operation,
    pinsSha256: pinsDigest(p),
    pins: p,
    nonceValue: r.nonceValue,
    effect:
      r.operation === "accept-buffer"
        ? "Admin accepts buffer authority. Program is not created."
        : "Create Program and deploy buffer under offline admin upgrade authority. No token initialization or activation.",
    warning:
      "A partial signature may authorize this operation once other signatures are added. No expiry timer with durable nonce. Offline review cannot attest RPC genesis or buffer contents.",
  };
}
function signerFor(p: DeploymentPins, r: DeploymentRequest, role: OfflineRole) {
  if (role === "admin") return p.admin;
  if (role === "program" && r.operation === "deploy") return p.program;
  throw Error("Offline role not allowed for operation");
}
export function signRequest(
  p: DeploymentPins,
  r: DeploymentRequest,
  elf: Uint8Array,
  role: OfflineRole,
  secret: unknown,
  confirmedMessageHash: string,
  confirmedPinsHash: string,
): SignatureResult {
  reviewRequest(p, r, elf);
  if (
    confirmedMessageHash !== r.messageSha256 ||
    confirmedPinsHash !== pinsDigest(p)
  )
    throw Error("Explicit message and independent pins confirmation required");
  const signer = signerFor(p, r, role);
  if (
    !Array.isArray(secret) ||
    secret.length !== 64 ||
    !secret.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
  )
    throw Error("Invalid key file");
  const bytes = Buffer.from(secret);
  const key = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      bytes.subarray(0, 32),
    ]),
    format: "der",
    type: "pkcs8",
  });
  const pub = createPublicKey(key),
    raw = Buffer.from(pub.export({ format: "jwk" }).x!, "base64url");
  if (
    !raw.equals(bytes.subarray(32)) ||
    new PublicKey(raw).toBase58() !== signer
  )
    throw Error("Wrong signing key");
  const signature = sign(null, Buffer.from(r.messageBase64, "base64"), key);
  const result: SignatureResult = {
    ...r,
    schema: "yamc-mainnet-partial-signature-v1",
    pinsSha256: pinsDigest(p),
    role,
    signer,
    signatureBase64: signature.toString("base64"),
  };
  verifyResult(p, r, elf, result);
  return result;
}
export function verifyResult(
  p: DeploymentPins,
  r: DeploymentRequest,
  elf: Uint8Array,
  result: SignatureResult,
) {
  reviewRequest(p, r, elf);
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
    throw Error("Unexpected result fields");
  for (const field of [
    "operation",
    "nonceValue",
    "messageBase64",
    "messageSha256",
  ] as const)
    if (result[field] !== r[field])
      throw Error("Result refers to different request");
  if (
    result.schema !== "yamc-mainnet-partial-signature-v1" ||
    result.pinsSha256 !== pinsDigest(p) ||
    result.signer !== signerFor(p, r, result.role)
  )
    throw Error("Result identity mismatch");
  const signature = Buffer.from(result.signatureBase64, "base64");
  if (
    signature.length !== 64 ||
    signature.toString("base64") !== result.signatureBase64
  )
    throw Error("Signature encoding");
  const key = createPublicKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      x: new PublicKey(result.signer).toBuffer().toString("base64url"),
    },
    format: "jwk",
  });
  if (!verify(null, Buffer.from(r.messageBase64, "base64"), key, signature))
    throw Error("Invalid signature");
  return {
    status: "VALID_PARTIAL_SIGNATURE" as const,
    signer: result.signer,
    broadcastAuthorization: false as const,
  };
}
