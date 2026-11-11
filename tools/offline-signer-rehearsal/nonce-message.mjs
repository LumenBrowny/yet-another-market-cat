import { Buffer } from "node:buffer";
import { expectedMessage, publicBytes, sha256 } from "./signer.mjs";
export const NONCE_KIND = "YAMC_LOCAL_NONCE_ROTATION_V1";
const SYSTEM = "11111111111111111111111111111111";
const RECENT = "SysvarRecentB1ockHashes11111111111111111111";
export function nonceMessage(identity, policy) {
  expectedMessage(identity); // Keep the fixed v1 program/config and identity guards.
  if (
    policy.kind !== NONCE_KIND ||
    policy.rpc !== "http://127.0.0.1:8993" ||
    policy.admin !== identity.admin ||
    policy.newIssuer !== identity.newIssuer ||
    policy.programId !== identity.programId ||
    policy.config !== identity.config ||
    policy.nonceAuthority !== identity.admin ||
    policy.nonceValue === SYSTEM ||
    policy.genesis === "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
  )
    throw Error("Wrong local nonce policy");
  publicBytes(policy.genesis);
  publicBytes(policy.oldIssuer);
  const addresses = [
    identity.admin,
    identity.newIssuer,
    identity.config,
    policy.nonceAccount,
    RECENT,
    SYSTEM,
    identity.programId,
  ];
  if (new Set(addresses).size !== 7) throw Error("Accounts must be distinct");
  return Buffer.concat([
    Buffer.from([2, 1, 3, 7]),
    ...addresses.map(publicBytes),
    publicBytes(policy.nonceValue),
    Buffer.from([2]),
    // AdvanceNonceAccount MUST be first: System program, nonce/recent-hashes/admin.
    Buffer.from([5, 3, 3, 4, 0, 4, 4, 0, 0, 0]),
    // Exactly one application instruction: rotateFaucetIssuer(admin,newIssuer,config).
    Buffer.from([6, 3, 0, 1, 2, 8, 250, 161, 183, 175, 25, 25, 172, 192]),
  ]);
}
export function inspectNonce(request, identity, policy) {
  const message = nonceMessage(identity, policy);
  for (const key of [
    "kind",
    "genesis",
    "oldIssuer",
    "nonceAccount",
    "nonceAuthority",
    "nonceValue",
  ])
    if (request[key] !== policy[key]) throw Error("Request/policy mismatch");
  if (
    !Number.isSafeInteger(request.preparedAtMs) ||
    request.preparedAtMs <= 0 ||
    request.messageBase64 !== message.toString("base64") ||
    request.messageSha256 !== sha256(message)
  )
    throw Error("Message mismatch");
  return message;
}
