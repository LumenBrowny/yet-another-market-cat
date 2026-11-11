// Node built-ins only. Publisher role only; never exports any other role.
import * as fs from "node:fs";
import * as path from "node:path";
import process from "node:process";
import console from "node:console";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import {
  generateKeyPairSync,
  createHash,
  createPublicKey,
  createPrivateKey,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  publicEncrypt,
  privateDecrypt,
  constants,
} from "node:crypto";
import { verifyPublic, base58 } from "./service-keys.mjs";
export const ROLES = ["publisher"];
const SCHEMA = "yamc-publisher-transfer-v1";
const sha = (b) => createHash("sha256").update(b).digest("hex");
export function fingerprint(pem) {
  return sha(createPublicKey(pem).export({ type: "spki", format: "der" }));
}
export function recipient() {
  return generateKeyPairSync("rsa", {
    modulusLength: 4096,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}
function publicIdentity(secret) {
  if (
    !Array.isArray(secret) ||
    secret.length !== 64 ||
    !secret.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
  )
    throw Error("Invalid key");
  const b = Buffer.from(secret),
    k = createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        b.subarray(0, 32),
      ]),
      format: "der",
      type: "pkcs8",
    });
  const pub = Buffer.from(
    createPublicKey(k).export({ format: "jwk" }).x,
    "base64url",
  );
  if (!pub.equals(b.subarray(32))) throw Error("Key mismatch");
  return base58(pub);
}
function validatePayload(payload, registry) {
  verifyPublic(registry);
  if (
    payload.schema !== SCHEMA ||
    Object.keys(payload).sort().join() !== ["schema", "keys"].sort().join() ||
    Object.keys(payload.keys).sort().join() !== [...ROLES].sort().join()
  )
    throw Error("Unexpected transfer roles");
  for (const role of ROLES)
    if (publicIdentity(payload.keys[role]) !== registry.roles[role].address)
      throw Error("Registry/key mismatch");
}
function registryDigest(registry) {
  verifyPublic(registry);
  return sha(
    Buffer.from(
      JSON.stringify(ROLES.map((r) => [r, registry.roles[r].address])),
    ),
  );
}
export function seal(keys, registry, publicPem, expectedFingerprint) {
  const recipientSha256 = fingerprint(publicPem);
  if (recipientSha256 !== expectedFingerprint)
    throw Error("Recipient fingerprint mismatch");
  const pub = createPublicKey(publicPem);
  if (
    pub.asymmetricKeyType !== "rsa" ||
    pub.asymmetricKeyDetails.modulusLength !== 4096
  )
    throw Error("RSA-4096 recipient required");
  const payload = { schema: SCHEMA, keys };
  validatePayload(payload, registry);
  const header = {
    schema: SCHEMA,
    recipientSha256,
    registrySha256: registryDigest(registry),
  };
  const aes = randomBytes(32),
    iv = randomBytes(12),
    plain = Buffer.from(JSON.stringify(payload));
  try {
    const cipher = createCipheriv("aes-256-gcm", aes, iv);
    cipher.setAAD(Buffer.from(JSON.stringify(header)));
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    return {
      ...header,
      wrappedKey: publicEncrypt(
        {
          key: pub,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256",
        },
        aes,
      ).toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: encrypted.toString("base64"),
    };
  } finally {
    aes.fill(0);
    plain.fill(0);
  }
}
function decode(s, size) {
  if (typeof s !== "string") throw Error("Invalid encoding");
  const b = Buffer.from(s, "base64");
  if (b.toString("base64") !== s || (size && b.length !== size))
    throw Error("Invalid encoding");
  return b;
}
export function unseal(envelope, registry, privatePem) {
  if (
    Object.keys(envelope).sort().join() !==
      [
        "schema",
        "recipientSha256",
        "registrySha256",
        "wrappedKey",
        "iv",
        "tag",
        "ciphertext",
      ]
        .sort()
        .join() ||
    envelope.schema !== SCHEMA ||
    envelope.registrySha256 !== registryDigest(registry)
  )
    throw Error("Envelope identity mismatch");
  if (
    envelope.recipientSha256 !==
    fingerprint(
      createPublicKey(privatePem).export({ type: "spki", format: "pem" }),
    )
  )
    throw Error("Wrong recipient");
  const ciphertext = decode(envelope.ciphertext);
  if (ciphertext.length > 16384) throw Error("Oversize transfer");
  const aes = privateDecrypt(
    {
      key: privatePem,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    decode(envelope.wrappedKey, 512),
  );
  let plain;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      aes,
      decode(envelope.iv, 12),
    );
    decipher.setAAD(
      Buffer.from(
        JSON.stringify({
          schema: envelope.schema,
          recipientSha256: envelope.recipientSha256,
          registrySha256: envelope.registrySha256,
        }),
      ),
    );
    decipher.setAuthTag(decode(envelope.tag, 16));
    plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const payload = JSON.parse(plain.toString());
    validatePayload(payload, registry);
    return payload.keys;
  } finally {
    aes.fill(0);
    plain?.fill(0);
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [
      mode,
      keyDirectory,
      registryFile,
      publicFile,
      expected,
      output,
      ...extra
    ] = process.argv.slice(2);
    if (mode !== "seal-publisher" || !output || extra.length)
      throw Error("Arguments");
    const registry = JSON.parse(fs.readFileSync(registryFile, "utf8"));
    verifyPublic(registry);
    const keys = Object.fromEntries(
      ROLES.map((role) => [
        role,
        JSON.parse(
          fs.readFileSync(path.join(keyDirectory, role + ".json"), "utf8"),
        ),
      ]),
    );
    const envelope = seal(
      keys,
      registry,
      fs.readFileSync(publicFile, "utf8"),
      expected,
    );
    fs.writeFileSync(output, JSON.stringify(envelope, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log(
      "ENCRYPTED_PUBLISHER_ONLY. Return only the encrypted output. No transaction or key provisioning performed.",
    );
  } catch {
    console.error(
      "TRANSFER_FAILED: invalid inputs, mismatching identities/recipient or existing output. Do not share secret files.",
    );
    process.exitCode = 1;
  }
}
