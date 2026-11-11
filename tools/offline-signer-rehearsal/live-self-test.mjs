import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { generateKeyPairSync, sign } from "node:crypto";
import { base58, expectedMessage, publicBytes, sha256 } from "./signer.mjs";
import { inspectLive, verifyLive } from "./live-signer.mjs";
function fixture() {
  const keys = [generateKeyPairSync("ed25519"), generateKeyPairSync("ed25519")];
  const addresses = keys.map((k) =>
    base58(k.publicKey.export({ format: "der", type: "spki" }).subarray(-32)),
  );
  const identity = {
    kind: "YAMC_NON_BROADCASTABLE_REHEARSAL_V1",
    programId: "BfNiASrYNqmARu2TQ1eBa1PJ6KgVHTNn44ATk5rJe6zW",
    config: "8npimHwcND7YyrmSgoXet7MUAUfg2oCSpZp7uV8L4ASD",
    admin: addresses[0],
    newIssuer: addresses[1],
  };
  const policy = {
    ...identity,
    kind: "YAMC_LOCAL_LIVE_ROTATION_V1",
    rpc: "http://127.0.0.1:8993",
    genesis: identity.programId,
    oldIssuer: identity.config,
  };
  const message = expectedMessage(identity);
  publicBytes(identity.newIssuer).copy(message, 132);
  const request = {
    kind: policy.kind,
    genesis: policy.genesis,
    oldIssuer: policy.oldIssuer,
    blockhash: identity.newIssuer,
    lastValidBlockHeight: 1000,
    preparedAtMs: Date.now(),
    messageBase64: message.toString("base64"),
    messageSha256: sha256(message),
  };
  const signatures = keys.map((k, i) => ({
    publicKey: addresses[i],
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
test("Live local message validates and both offline signatures verify", () => {
  const f = fixture();
  assert.equal(
    verifyLive(f.result, f.identity, f.policy).status,
    "LOCAL_TEST_SIGNATURES_VALID",
  );
});
test("Every changed message byte fails; mismatched genesis, zero hash and mainnet policy fail", () => {
  const f = fixture();
  for (let i = 0; i < f.message.length; i++) {
    const b = Buffer.from(f.message);
    b[i] ^= 1;
    assert.throws(() =>
      inspectLive(
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
  for (const delta of [
    { genesis: f.identity.admin },
    { oldIssuer: f.identity.admin },
    { blockhash: "11111111111111111111111111111111" },
    { lastValidBlockHeight: 0 },
    { kind: "mainnet" },
  ])
    assert.throws(() =>
      inspectLive({ ...f.request, ...delta }, f.identity, f.policy),
    );
  for (const delta of [
    { rpc: "https://api.mainnet-beta.solana.com" },
    { genesis: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" },
    { admin: f.identity.newIssuer },
  ])
    assert.throws(() =>
      inspectLive(f.request, f.identity, { ...f.policy, ...delta }),
    );
});
test("Signature replacement and wire tampering fail", () => {
  const f = fixture();
  for (const mutate of [
    (r) => r.signatures.reverse(),
    (r) => (r.signatures[0].signature = Buffer.alloc(64).toString("base64")),
    (r) => (r.transactionBase64 += "AA=="),
  ]) {
    const r = JSON.parse(JSON.stringify(f.result));
    mutate(r);
    assert.throws(() => verifyLive(r, f.identity, f.policy));
  }
});
