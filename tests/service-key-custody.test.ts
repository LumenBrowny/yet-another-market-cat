import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// Standalone offline tool deliberately uses only Node built-ins.
// @ts-expect-error standalone JS package has no declaration file
import * as custody from "../tools/offline-key-custody/service-keys.mjs";
const { generate, verifyPublic, verifyBackup } = custody;
test("service custody: role-bound proofs, backup consistency and exclusive generation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yamc-service-custody-"));
  const directory = path.join(root, "keys");
  try {
    const registry = generate(directory);
    verifyPublic(registry);
    verifyBackup(directory, registry);
    assert.equal(Object.keys(registry.roles).length, 6);
    assert.throws(() => generate(directory));
    const swapped = structuredClone(registry);
    [swapped.roles.issuer, swapped.roles.publisher] = [
      swapped.roles.publisher,
      swapped.roles.issuer,
    ];
    assert.throws(() => verifyPublic(swapped));
    const duplicate = structuredClone(registry);
    duplicate.roles.payer = duplicate.roles.issuer;
    assert.throws(() => verifyPublic(duplicate));
    const wrongSchema = {
      ...registry,
      schema: "yamc-offline-public-identities-v1",
    };
    assert.throws(() => verifyPublic(wrongSchema));
    const corrupt = structuredClone(registry);
    corrupt.roles.issuer.proofBase64 = Buffer.alloc(64).toString("base64");
    assert.throws(() => verifyPublic(corrupt));
    const secret = JSON.parse(
      fs.readFileSync(path.join(directory, "issuer.json"), "utf8"),
    );
    secret[0] ^= 1;
    fs.writeFileSync(
      path.join(directory, "issuer.json"),
      JSON.stringify(secret),
    );
    assert.throws(() => verifyBackup(directory, registry));
    assert(!JSON.stringify(registry).includes("secretKey"));
  } finally {
    // Exact newly allocated test directory, no user-provided path.
    fs.rmSync(root, { recursive: true, force: true });
  }
});
