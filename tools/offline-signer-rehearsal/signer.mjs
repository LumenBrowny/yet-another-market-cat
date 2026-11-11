// Dependency-free, deliberately non-broadcastable rehearsal. NOT a mainnet signer.
import { Buffer } from "node:buffer";
import console from "node:console";
import process from "node:process";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PROGRAM = "BfNiASrYNqmARu2TQ1eBa1PJ6KgVHTNn44ATk5rJe6zW";
const CONFIG = "8npimHwcND7YyrmSgoXet7MUAUfg2oCSpZp7uV8L4ASD";
const KIND = "YAMC_NON_BROADCASTABLE_REHEARSAL_V1";
const discriminator = Buffer.from([250, 161, 183, 175, 25, 25, 172, 192]);
export function base58(bytes) {
  let value = BigInt("0x" + Buffer.from(bytes).toString("hex")),
    out = "";
  while (value) {
    out = alphabet[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte) break;
    out = "1" + out;
  }
  return out;
}
export function publicBytes(text) {
  if (typeof text !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text))
    throw new Error("Invalid public key");
  let value = 0n;
  for (const c of text) value = value * 58n + BigInt(alphabet.indexOf(c));
  let hex = value.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const bytes = value === 0n ? Buffer.alloc(0) : Buffer.from(hex, "hex");
  const leading = text.match(/^1*/)[0].length;
  const out = Buffer.concat([Buffer.alloc(leading), bytes]);
  if (out.length !== 32 || base58(out) !== text)
    throw new Error("Noncanonical public key");
  return out;
}
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
function publicObject(bytes) {
  return createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), bytes]),
    format: "der",
    type: "spki",
  });
}
function rawPublic(privateKey) {
  return createPublicKey(privateKey)
    .export({ format: "der", type: "spki" })
    .subarray(-32);
}
function json(path) {
  const data = readFileSync(path);
  if (data.length > 16384) throw new Error("Input too large");
  return JSON.parse(data.toString("utf8"));
}
function writeNew(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
}
function validateIdentity(identity) {
  if (
    identity.kind !== KIND ||
    identity.programId !== PROGRAM ||
    identity.config !== CONFIG ||
    identity.admin === identity.newIssuer
  )
    throw new Error("Wrong rehearsal identity");
  publicBytes(identity.admin);
  publicBytes(identity.newIssuer);
}
// A legacy Solana message with exactly one rotateFaucetIssuer instruction.
// Fee payer = admin; newIssuer read-only signer; Config writable; program read-only.
// Zero recent blockhash is intentionally fixed and cannot be overridden by CLI/input.
export function expectedMessage(identity) {
  validateIdentity(identity);
  return Buffer.concat([
    Buffer.from([2, 1, 1, 4]),
    publicBytes(identity.admin),
    publicBytes(identity.newIssuer),
    publicBytes(CONFIG),
    publicBytes(PROGRAM),
    Buffer.alloc(32),
    Buffer.from([1, 3, 3, 0, 1, 2, 8]),
    discriminator,
  ]);
}
export function inspect(request, identity) {
  const expected = expectedMessage(identity);
  if (
    request.kind !== KIND ||
    request.messageBase64 !== expected.toString("base64") ||
    request.messageSha256 !== sha256(expected)
  )
    throw new Error(
      "Transaction differs from the exact allowed rehearsal message",
    );
  return expected;
}
export function verifySigned(result, identity) {
  const message = inspect(result, identity);
  if (!Array.isArray(result.signatures) || result.signatures.length !== 2)
    throw new Error("Exactly two signatures required");
  const signatures = [identity.admin, identity.newIssuer].map((address, i) => {
    const entry = result.signatures[i];
    if (entry.publicKey !== address || typeof entry.signature !== "string")
      throw new Error("Wrong signer/order");
    const bytes = Buffer.from(entry.signature, "base64");
    if (
      bytes.length !== 64 ||
      bytes.toString("base64") !== entry.signature ||
      !verify(null, message, publicObject(publicBytes(address)), bytes)
    )
      throw new Error("Signature verification failed");
    return bytes;
  });
  const wire = Buffer.concat([Buffer.from([2]), ...signatures, message]);
  if (result.transactionBase64 !== wire.toString("base64"))
    throw new Error("Serialized transaction mismatch");
  return {
    status: "SIGNATURES_VALID_TEST_ONLY",
    messageSha256: sha256(message),
    transactionSha256: sha256(wire),
  };
}
function init(dir) {
  if (existsSync(dir))
    throw new Error(
      "work directory already exists; refusing to overwrite keys",
    );
  mkdirSync(dir);
  const pairs = [
    generateKeyPairSync("ed25519"),
    generateKeyPairSync("ed25519"),
  ];
  const identity = {
    kind: KIND,
    programId: PROGRAM,
    config: CONFIG,
    admin: base58(rawPublic(pairs[0].privateKey)),
    newIssuer: base58(rawPublic(pairs[1].privateKey)),
  };
  // Only generated inside init; never imports a Solana wallet/seed or real key file.
  writeNew(join(dir, "TEST-ONLY-PRIVATE-KEYS.json"), {
    kind: KIND,
    keys: pairs.map((p) =>
      p.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    ),
  });
  writeNew(join(dir, "identity.public.json"), identity);
  const message = expectedMessage(identity);
  writeNew(join(dir, "request.unsigned.json"), {
    kind: KIND,
    messageBase64: message.toString("base64"),
    messageSha256: sha256(message),
  });
  console.log(
    "Created disposable test keys and request in work/. Keep TEST-ONLY-PRIVATE-KEYS.json on this computer.",
  );
}
function review(dir) {
  const identity = json(join(dir, "identity.public.json"));
  const message = inspect(json(join(dir, "request.unsigned.json")), identity);
  console.log(
    JSON.stringify(
      {
        warning:
          "TEST ONLY / INVALID ZERO BLOCKHASH / NO NETWORK / NO REAL FUNDS",
        instruction: "rotateFaucetIssuer",
        instructionCount: 1,
        programId: PROGRAM,
        config: CONFIG,
        feePayer: identity.admin,
        admin: identity.admin,
        incomingIssuer: identity.newIssuer,
        requiredSignatures: 2,
        messageSha256: sha256(message),
        recentBlockhash: "11111111111111111111111111111111",
        limitation:
          "No RPC consulted; no claim about deployment, current authority, fees or simulation success.",
      },
      null,
      2,
    ),
  );
}
function signRequest(dir) {
  review(dir);
  const identity = json(join(dir, "identity.public.json")),
    request = json(join(dir, "request.unsigned.json"));
  const message = inspect(request, identity),
    secret = json(join(dir, "TEST-ONLY-PRIVATE-KEYS.json"));
  if (
    secret.kind !== KIND ||
    !Array.isArray(secret.keys) ||
    secret.keys.length !== 2
  )
    throw new Error("Invalid test key file");
  const signatures = secret.keys.map((data, i) => {
    const key = createPrivateKey({
      key: Buffer.from(data, "base64"),
      format: "der",
      type: "pkcs8",
    });
    const address = base58(rawPublic(key));
    if (
      key.asymmetricKeyType !== "ed25519" ||
      address !== [identity.admin, identity.newIssuer][i]
    )
      throw new Error("Private key does not match approved signer");
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
  const verification = verifySigned(result, identity);
  writeNew(join(dir, "result.signed.json"), result);
  console.log(JSON.stringify(verification, null, 2));
}
export function main(args) {
  const dir = resolve("work");
  if (args.length === 1 && args[0] === "init") return init(dir);
  if (args.length === 1 && args[0] === "review") return review(dir);
  if (
    args.length === 2 &&
    args[0] === "sign" &&
    args[1] === "--confirm-test-only"
  )
    return signRequest(dir);
  if (args.length === 1 && args[0] === "verify")
    return console.log(
      JSON.stringify(
        verifySigned(
          json(join(dir, "result.signed.json")),
          json(join(dir, "identity.public.json")),
        ),
        null,
        2,
      ),
    );
  throw new Error(
    "Usage: node signer.mjs init | review | sign --confirm-test-only | verify",
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main(process.argv.slice(2));
  } catch {
    // Never print key contents or an OpenSSL error containing input material.
    console.error(
      "FAILED: invalid input, wrong command, or existing work/output. Nothing was sent. See README-RU.md; do not share the private-key file.",
    );
    process.exitCode = 1;
  }
}
