import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Keypair } from "@solana/web3.js";
import { generate, verifyPublic, verifyBackup } from "./keys.mjs";

test("offline identities: Solana compatibility, no overwrite, backup and tamper checks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yamc-key-test-"));
  try {
    const dir = path.join(root, "keys");
    const registry = generate(dir);
    verifyPublic(registry);
    verifyBackup(dir, registry);
    for (const role of ["admin", "program", "mint"]) {
      const bytes = JSON.parse(
        fs.readFileSync(path.join(dir, `${role}.json`), "utf8"),
      );
      const key = Keypair.fromSecretKey(Uint8Array.from(bytes));
      assert.equal(key.publicKey.toBase58(), registry.roles[role].address);
      assert.equal(
        JSON.stringify(registry).includes(JSON.stringify(bytes)),
        false,
      );
    }
    assert.throws(() => generate(dir), /EEXIST/);
    const tampered = JSON.parse(JSON.stringify(registry));
    tampered.roles.admin.proofBase64 = registry.roles.mint.proofBase64;
    assert.throws(() => verifyPublic(tampered), /custody proof/);
    const corrupt = JSON.parse(
      fs.readFileSync(path.join(dir, "admin.json"), "utf8"),
    );
    corrupt[0] ^= 1;
    fs.writeFileSync(path.join(dir, "admin.json"), JSON.stringify(corrupt));
    assert.throws(() => verifyBackup(dir, registry), /mismatch/);
  } finally {
    // Only the exact temporary directory created by this test, never user keys.
    fs.rmSync(root, { recursive: true, force: true });
  }
});
