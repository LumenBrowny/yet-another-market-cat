import { test } from "node:test";
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  base58,
  expectedMessage,
  inspect,
  sha256,
  verifySigned,
} from "./signer.mjs";

function fixture() {
  const pairs = [
    generateKeyPairSync("ed25519"),
    generateKeyPairSync("ed25519"),
  ];
  const publicKeys = pairs.map((p) =>
    base58(p.publicKey.export({ format: "der", type: "spki" }).subarray(-32)),
  );
  const identity = {
    kind: "YAMC_NON_BROADCASTABLE_REHEARSAL_V1",
    programId: "BfNiASrYNqmARu2TQ1eBa1PJ6KgVHTNn44ATk5rJe6zW",
    config: "8npimHwcND7YyrmSgoXet7MUAUfg2oCSpZp7uV8L4ASD",
    admin: publicKeys[0],
    newIssuer: publicKeys[1],
  };
  const message = expectedMessage(identity);
  const signatures = pairs.map((p, i) => ({
    publicKey: publicKeys[i],
    signature: sign(null, message, p.privateKey).toString("base64"),
  }));
  const result = {
    kind: identity.kind,
    messageBase64: message.toString("base64"),
    messageSha256: sha256(message),
    signatures,
    transactionBase64: Buffer.concat([
      Buffer.from([2]),
      ...signatures.map((s) => Buffer.from(s.signature, "base64")),
      message,
    ]).toString("base64"),
  };
  return { identity, message, result };
}
test("Two real Ed25519 signatures over an exact Solana message verify", () => {
  const { identity, result } = fixture();
  assert.equal(
    verifySigned(result, identity).status,
    "SIGNATURES_VALID_TEST_ONLY",
  );
});
test("Every altered message byte is refused even if attacker updates checksum", () => {
  const { identity, result, message } = fixture();
  for (let i = 0; i < message.length; i++) {
    const altered = Buffer.from(message);
    altered[i] ^= 1;
    assert.throws(() =>
      inspect(
        {
          ...result,
          messageBase64: altered.toString("base64"),
          messageSha256: sha256(altered),
        },
        identity,
      ),
    );
  }
  const extra = Buffer.concat([message, Buffer.from([0])]);
  assert.throws(() =>
    inspect(
      {
        ...result,
        messageBase64: extra.toString("base64"),
        messageSha256: sha256(extra),
      },
      identity,
    ),
  );
});
test("Changed signature, signer, wire bytes, checksum and missing signatures fail", () => {
  const { identity, result } = fixture();
  for (const mutation of [
    (r) => r.signatures.pop(),
    (r) => r.signatures.reverse(),
    (r) => (r.signatures[0].signature = Buffer.alloc(64).toString("base64")),
    (r) => (r.transactionBase64 += "AA=="),
    (r) => (r.messageSha256 = "0".repeat(64)),
    (r) => (r.kind = "mainnet"),
  ]) {
    const copy = JSON.parse(JSON.stringify(result));
    mutation(copy);
    assert.throws(() => verifySigned(copy, identity));
  }
});
test("Other programs, Config accounts, same keys and invalid public keys rejected", () => {
  const { identity } = fixture();
  for (const change of [
    { programId: identity.admin },
    { config: identity.admin },
    { admin: identity.newIssuer },
    { admin: "bad" },
  ])
    assert.throws(() => expectedMessage({ ...identity, ...change }));
});
