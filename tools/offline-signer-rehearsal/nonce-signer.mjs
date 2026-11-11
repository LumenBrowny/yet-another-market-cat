// Durable nonce local rehearsal. Same disposable v1 keys; no network calls.
import { Buffer } from "node:buffer";
import console from "node:console";
import process from "node:process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { base58, publicBytes, sha256 } from "./signer.mjs";
import { inspectNonce } from "./nonce-message.mjs";
function json(path) {
  const b = readFileSync(path);
  if (b.length > 16384) throw Error("Input too large");
  return JSON.parse(b.toString("utf8"));
}
export function verifyNonce(result, identity, policy) {
  const message = inspectNonce(result, identity, policy);
  if (!Array.isArray(result.signatures) || result.signatures.length !== 2)
    throw Error("Wrong signatures");
  const sigs = [identity.admin, identity.newIssuer].map((address, i) => {
    const s = result.signatures[i];
    if (s.publicKey !== address || typeof s.signature !== "string")
      throw Error("Wrong signer");
    const signature = Buffer.from(s.signature, "base64");
    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        publicBytes(address),
      ]),
      format: "der",
      type: "spki",
    });
    if (
      signature.length !== 64 ||
      signature.toString("base64") !== s.signature ||
      !verify(null, message, key, signature)
    )
      throw Error("Bad signature");
    return signature;
  });
  const wire = Buffer.concat([Buffer.from([2]), ...sigs, message]);
  if (result.transactionBase64 !== wire.toString("base64"))
    throw Error("Wire mismatch");
  return {
    status: "LOCAL_NONCE_SIGNATURES_VALID",
    messageSha256: sha256(message),
  };
}
function main(args) {
  const identity = json("work/identity.public.json"),
    policy = json("nonce-policy.json"),
    request = json("work/request.nonce.json");
  const message = inspectNonce(request, identity, policy);
  const review = {
    warning: "LOCAL VALIDATOR TEST ONLY; NOT MAINNET",
    instructions: ["advanceNonceAccount", "rotateFaucetIssuer"],
    programId: policy.programId,
    config: policy.config,
    genesis: policy.genesis,
    admin: policy.admin,
    oldIssuer: policy.oldIssuer,
    newIssuer: policy.newIssuer,
    nonceAccount: policy.nonceAccount,
    nonceAuthority: policy.nonceAuthority,
    nonceValue: policy.nonceValue,
    messageSha256: sha256(message),
    note: "Offline machine cannot verify current nonce/chain state. No network calls. Validity ends when nonce advances, not after a short blockhash window.",
  };
  if (args.length === 1 && args[0] === "review") {
    console.log(JSON.stringify(review, null, 2));
    return;
  }
  if (args.length === 1 && args[0] === "verify") {
    console.log(
      JSON.stringify(
        verifyNonce(json("work/result.nonce.json"), identity, policy),
        null,
        2,
      ),
    );
    return;
  }
  if (
    args.length !== 2 ||
    args[0] !== "sign" ||
    args[1] !== "--confirm-local-test"
  )
    throw Error("Bad command");
  const secrets = json("work/TEST-ONLY-PRIVATE-KEYS.json");
  if (
    secrets.kind !== identity.kind ||
    !Array.isArray(secrets.keys) ||
    secrets.keys.length !== 2
  )
    throw Error("Wrong test keys");
  const signatures = secrets.keys.map((data, i) => {
    const key = createPrivateKey({
      key: Buffer.from(data, "base64"),
      format: "der",
      type: "pkcs8",
    });
    const address = base58(
      createPublicKey(key)
        .export({ format: "der", type: "spki" })
        .subarray(-32),
    );
    if (
      key.asymmetricKeyType !== "ed25519" ||
      address !== [identity.admin, identity.newIssuer][i]
    )
      throw Error("Wrong signer");
    return {
      publicKey: address,
      signature: sign(null, message, key).toString("base64"),
    };
  });
  const result = {
    ...request,
    signatures,
    transactionBase64: Buffer.concat([
      Buffer.from([2]),
      ...signatures.map((s) => Buffer.from(s.signature, "base64")),
      message,
    ]).toString("base64"),
  };
  const checked = verifyNonce(result, identity, policy);
  writeFileSync(
    "work/result.nonce.json",
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  console.log(JSON.stringify({ ...review, ...checked }, null, 2));
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main(process.argv.slice(2));
  } catch {
    console.error(
      "FAILED: input/policy/signature mismatch or result.nonce.json already exists. Nothing sent. Never share private keys.",
    );
    process.exitCode = 1;
  }
}
