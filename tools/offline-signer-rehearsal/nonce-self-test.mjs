import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { generateKeyPairSync, sign } from "node:crypto";
import { base58, sha256 } from "./signer.mjs";
import { nonceMessage, inspectNonce, NONCE_KIND } from "./nonce-message.mjs";
import { verifyNonce } from "./nonce-signer.mjs";
function fixture() {
  const pairs = [
    generateKeyPairSync("ed25519"),
    generateKeyPairSync("ed25519"),
  ];
  const pub = (k) =>
    base58(k.publicKey.export({ format: "der", type: "spki" }).subarray(-32));
  const identity = {
    kind: "YAMC_NON_BROADCASTABLE_REHEARSAL_V1",
    programId: "BfNiASrYNqmARu2TQ1eBa1PJ6KgVHTNn44ATk5rJe6zW",
    config: "8npimHwcND7YyrmSgoXet7MUAUfg2oCSpZp7uV8L4ASD",
    admin: pub(pairs[0]),
    newIssuer: pub(pairs[1]),
  };
  const policy = {
    ...identity,
    kind: NONCE_KIND,
    rpc: "http://127.0.0.1:8993",
    genesis: identity.programId,
    oldIssuer: identity.config,
    nonceAccount: pub(generateKeyPairSync("ed25519")),
    nonceAuthority: identity.admin,
    nonceValue: pub(generateKeyPairSync("ed25519")),
  };
  const message = nonceMessage(identity, policy);
  const request = {
    kind: policy.kind,
    genesis: policy.genesis,
    oldIssuer: policy.oldIssuer,
    nonceAccount: policy.nonceAccount,
    nonceAuthority: policy.nonceAuthority,
    nonceValue: policy.nonceValue,
    preparedAtMs: Date.now(),
    messageBase64: message.toString("base64"),
    messageSha256: sha256(message),
  };
  const signatures = pairs.map((k, i) => ({
    publicKey: [identity.admin, identity.newIssuer][i],
    signature: sign(null, message, k.privateKey).toString("base64"),
  }));
  const result = {
    ...request,
    signatures,
    transactionBase64: Buffer.concat([
      Buffer.from([2]),
      ...signatures.map((s) => Buffer.from(s.signature, "base64")),
      message,
    ]).toString("base64"),
  };
  return { identity, policy, request, result, message };
}
test("Exact nonce advance + rotation verifies with two real signatures", () => {
  const f = fixture();
  assert.equal(
    verifyNonce(f.result, f.identity, f.policy).status,
    "LOCAL_NONCE_SIGNATURES_VALID",
  );
});
test("Every altered instruction/account/nonce byte fails despite new checksum", () => {
  const f = fixture();
  for (let i = 0; i < f.message.length; i++) {
    const b = Buffer.from(f.message);
    b[i] ^= 1;
    assert.throws(() =>
      inspectNonce(
        {
          ...f.request,
          messageBase64: b.toString("base64"),
          messageSha256: sha256(b),
        },
        f.identity,
        f.policy,
      ),
    );
  }
});
test("Nonce identity, authority, account collisions and non-local policies fail", () => {
  const f = fixture();
  for (const d of [
    { nonceValue: f.identity.admin },
    { nonceAccount: f.identity.admin },
    { nonceAuthority: f.identity.newIssuer },
    { genesis: f.identity.admin },
  ])
    assert.throws(() =>
      inspectNonce({ ...f.request, ...d }, f.identity, f.policy),
    );
  for (const d of [
    { nonceAuthority: f.identity.newIssuer },
    { nonceAccount: f.identity.config },
    { rpc: "https://api.mainnet-beta.solana.com" },
  ])
    assert.throws(() =>
      inspectNonce(f.request, f.identity, { ...f.policy, ...d }),
    );
});
test("Signatures and serialized wire cannot be replaced or reordered", () => {
  const f = fixture();
  for (const mutate of [
    (r) => r.signatures.reverse(),
    (r) => r.signatures.pop(),
    (r) => (r.signatures[0].signature = Buffer.alloc(64).toString("base64")),
    (r) => (r.transactionBase64 += "AA=="),
  ]) {
    const r = JSON.parse(JSON.stringify(f.result));
    mutate(r);
    assert.throws(() => verifyNonce(r, f.identity, f.policy));
  }
});
