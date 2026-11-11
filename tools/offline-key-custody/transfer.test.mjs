import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import { generate } from "./service-keys.mjs";
import { recipient, fingerprint, seal, unseal, ROLES } from "./transfer.mjs";
test("encrypted deployment transfer: exact roles, authenticated metadata/ciphertext, correct recipient", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yamc-transfer-")),
    dir = path.join(root, "keys");
  try {
    const registry = generate(dir),
      pair = recipient(),
      fp = fingerprint(pair.publicKey);
    const keys = Object.fromEntries(
      ROLES.map((r) => [
        r,
        JSON.parse(fs.readFileSync(path.join(dir, r + ".json"), "utf8")),
      ]),
    );
    const envelope = seal(keys, registry, pair.publicKey, fp);
    assert.deepEqual(unseal(envelope, registry, pair.privateKey), keys);
    assert.notEqual(
      seal(keys, registry, pair.publicKey, fp).ciphertext,
      envelope.ciphertext,
    );
    assert.throws(() =>
      seal({ ...keys, publisher: keys.payer }, registry, pair.publicKey, fp),
    );
    assert.throws(() =>
      seal({ ...keys, payer: keys.buffer }, registry, pair.publicKey, fp),
    );
    assert.throws(() => seal(keys, registry, pair.publicKey, "wrong"));
    for (const field of ["wrappedKey", "iv", "tag", "ciphertext"]) {
      const b = Buffer.from(envelope[field], "base64");
      b[0] ^= 1;
      assert.throws(() =>
        unseal(
          { ...envelope, [field]: b.toString("base64") },
          registry,
          pair.privateKey,
        ),
      );
    }
    assert.throws(() =>
      unseal(
        { ...envelope, registrySha256: "wrong" },
        registry,
        pair.privateKey,
      ),
    );
    assert.throws(() =>
      unseal(
        { ...envelope, recipientSha256: "wrong" },
        registry,
        pair.privateKey,
      ),
    );
    assert.throws(() =>
      unseal({ ...envelope, keys }, registry, pair.privateKey),
    );
    assert(!JSON.stringify(envelope).includes(JSON.stringify(keys.payer)));
  } finally {
    for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name));
    fs.rmdirSync(dir);
    fs.rmdirSync(root);
  }
});
