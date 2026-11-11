// Local-validator-only second stage. The two disposable v1 keys are reused.
import { Buffer } from "node:buffer";
import console from "node:console";
import process from "node:process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { base58, publicBytes, expectedMessage, sha256 } from "./signer.mjs";
const KIND = "YAMC_LOCAL_LIVE_ROTATION_V1";
function json(path) {
  const b = readFileSync(path);
  if (b.length > 16384) throw Error("Input too large");
  return JSON.parse(b.toString("utf8"));
}
export function inspectLive(request, identity, policy) {
  const message = Buffer.from(expectedMessage(identity));
  if (
    policy.kind !== KIND ||
    policy.admin !== identity.admin ||
    policy.newIssuer !== identity.newIssuer ||
    policy.programId !== identity.programId ||
    policy.config !== identity.config ||
    policy.rpc !== "http://127.0.0.1:8993" ||
    [
      "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
      "EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    ].includes(policy.genesis)
  )
    throw Error("Wrong local policy");
  publicBytes(policy.genesis);
  publicBytes(policy.oldIssuer);
  if (
    request.kind !== KIND ||
    request.genesis !== policy.genesis ||
    request.oldIssuer !== policy.oldIssuer ||
    !Number.isSafeInteger(request.lastValidBlockHeight) ||
    request.lastValidBlockHeight <= 0 ||
    !Number.isSafeInteger(request.preparedAtMs) ||
    request.preparedAtMs <= 0 ||
    request.blockhash === "11111111111111111111111111111111"
  )
    throw Error("Wrong request");
  publicBytes(request.blockhash).copy(message, 132);
  if (
    request.messageBase64 !== message.toString("base64") ||
    request.messageSha256 !== sha256(message)
  )
    throw Error("Message mismatch");
  return message;
}
export function verifyLive(result, identity, policy) {
  const message = inspectLive(result, identity, policy);
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
    status: "LOCAL_TEST_SIGNATURES_VALID",
    messageSha256: sha256(message),
  };
}
function main(args) {
  const identity = json("work/identity.public.json"),
    policy = json("live-policy.json"),
    request = json("work/request.live.json");
  const message = inspectLive(request, identity, policy);
  const review = {
    warning: "LOCAL VALIDATOR TEST ONLY; NOT MAINNET",
    instruction: "rotateFaucetIssuer",
    programId: policy.programId,
    config: policy.config,
    genesis: policy.genesis,
    admin: policy.admin,
    oldIssuer: policy.oldIssuer,
    newIssuer: policy.newIssuer,
    blockhash: request.blockhash,
    lastValidBlockHeight: request.lastValidBlockHeight,
    messageSha256: sha256(message),
    note: "Offline machine cannot verify live chain state or blockhash expiry. No network calls.",
  };
  if (args.length === 1 && args[0] === "review") {
    console.log(JSON.stringify(review, null, 2));
    return;
  }
  if (args.length === 1 && args[0] === "verify") {
    console.log(
      JSON.stringify(
        verifyLive(json("work/result.live.json"), identity, policy),
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
  const checked = verifyLive(result, identity, policy);
  writeFileSync(
    "work/result.live.json",
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
      "FAILED: input/policy/signature mismatch or result.live.json already exists. Nothing sent. Never share private keys.",
    );
    process.exitCode = 1;
  }
}
