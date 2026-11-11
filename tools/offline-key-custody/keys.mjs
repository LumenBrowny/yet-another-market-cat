import * as fs from "node:fs";
import { Buffer } from "node:buffer";
import process from "node:process";
import console from "node:console";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";

const roles = ["admin", "program", "mint"];
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(bytes) {
  let value = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  let result = "";
  while (value > 0n) {
    result = alphabet[Number(value % 58n)] + result;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = "1" + result;
  }
  return result;
}
function message(role, address) {
  return Buffer.from(
    `YAMC key custody proof v1\nNOT A TRANSACTION\nmainnet-beta\n${role}\n${address}\n`,
  );
}
function fromSecret(bytes) {
  if (
    !Array.isArray(bytes) ||
    bytes.length !== 64 ||
    !bytes.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)
  )
    throw new Error("Invalid secret-key format");
  const secret = Buffer.from(bytes);
  const key = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      secret.subarray(0, 32),
    ]),
    format: "der",
    type: "pkcs8",
  });
  const pub = Buffer.from(
    createPublicKey(key).export({ format: "jwk" }).x,
    "base64url",
  );
  if (!pub.equals(secret.subarray(32)))
    throw new Error("Secret/public mismatch");
  return { key, pub };
}
export function generate(directory) {
  // Exclusive directory creation prevents mixing sets or overwriting existing keys.
  fs.mkdirSync(directory, { mode: 0o700 });
  const registry = {
    schema: "yamc-offline-public-identities-v1",
    cluster: "mainnet-beta",
    purpose:
      "Public identities only; no deployment or transaction authorization",
    roles: {},
  };
  for (const role of roles) {
    const { privateKey } = generateKeyPairSync("ed25519");
    const jwk = privateKey.export({ format: "jwk" });
    const seed = Buffer.from(jwk.d, "base64url");
    const pub = Buffer.from(jwk.x, "base64url");
    const address = base58(pub);
    fs.writeFileSync(
      path.join(directory, `${role}.json`),
      JSON.stringify([...seed, ...pub]) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    registry.roles[role] = {
      address,
      publicKeyBase64: pub.toString("base64"),
      proofBase64: sign(null, message(role, address), privateKey).toString(
        "base64",
      ),
    };
  }
  fs.writeFileSync(
    path.join(directory, "public-identities.json"),
    JSON.stringify(registry, null, 2) + "\n",
    { flag: "wx" },
  );
  return registry;
}
export function verifyPublic(registry) {
  if (
    registry.schema !== "yamc-offline-public-identities-v1" ||
    registry.cluster !== "mainnet-beta"
  )
    throw new Error("Unexpected registry");
  if (Object.keys(registry.roles).sort().join() !== [...roles].sort().join())
    throw new Error("Unexpected roles");
  const addresses = new Set();
  for (const role of roles) {
    const item = registry.roles[role];
    const pub = Buffer.from(item.publicKeyBase64, "base64");
    if (
      pub.length !== 32 ||
      base58(pub) !== item.address ||
      addresses.has(item.address)
    )
      throw new Error("Invalid/duplicate public identity");
    addresses.add(item.address);
    const key = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: pub.toString("base64url") },
      format: "jwk",
    });
    if (
      !verify(
        null,
        message(role, item.address),
        key,
        Buffer.from(item.proofBase64, "base64"),
      )
    )
      throw new Error("Invalid custody proof");
  }
}
export function verifyBackup(directory, registry) {
  verifyPublic(registry);
  for (const role of roles) {
    const { key, pub } = fromSecret(
      JSON.parse(fs.readFileSync(path.join(directory, `${role}.json`), "utf8")),
    );
    if (base58(pub) !== registry.roles[role].address)
      throw new Error(`Backup differs: ${role}`);
    const msg = message(role, registry.roles[role].address);
    if (!verify(null, msg, createPublicKey(key), sign(null, msg, key)))
      throw new Error("Backup signing check failed");
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [command, directory, registryFile] = process.argv.slice(2);
    if (command === "generate" && directory && !registryFile) {
      const registry = generate(path.resolve(directory));
      verifyBackup(directory, registry);
      console.log(
        "CREATED_AND_CHECKED. Return ONLY public-identities.json. Keep admin.json, program.json and mint.json offline.",
      );
    } else if (command === "verify-backup" && directory && registryFile) {
      verifyBackup(
        directory,
        JSON.parse(fs.readFileSync(registryFile, "utf8")),
      );
      console.log(
        "BACKUP_VERIFIED. All three keys match and can sign. No transaction created.",
      );
    } else if (command === "verify-public" && directory && !registryFile) {
      verifyPublic(JSON.parse(fs.readFileSync(directory, "utf8")));
      console.log(
        "PUBLIC_PROOFS_VERIFIED. This does not prove backup storage or machine security.",
      );
    } else
      throw new Error(
        "Usage: node keys.mjs generate NEW_DIRECTORY | verify-backup KEY_DIRECTORY PUBLIC_JSON | verify-public PUBLIC_JSON",
      );
  } catch (error) {
    console.error(error.code || error.message);
    process.exitCode = 1;
  }
}
