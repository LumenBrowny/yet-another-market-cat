import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSkrDetector,
  DetectorGesture,
  parseSkrBalance,
  SKR_MINT,
  SKR_RPC,
  SKR_TTL,
} from "../app/src/skr/detection";

const owner = "test-wallet";
const token = (
  amount: string,
  mint = SKR_MINT,
  wallet = owner,
  pubkey = "account",
) => ({
  pubkey,
  account: {
    owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    data: {
      parsed: {
        type: "account",
        info: {
          mint,
          owner: wallet,
          tokenAmount: { amount, decimals: 6 },
        },
      },
    },
  },
});
test("real mint/owner only, sum raw integer amounts including dust; empty is absent", () => {
  assert.equal(parseSkrBalance([], owner), 0n);
  assert.equal(
    parseSkrBalance([token("0"), token("1", SKR_MINT, owner, "second")], owner),
    1n,
  );
  assert.throws(() => parseSkrBalance([token("1000000", "fake")], owner));
  assert.throws(() =>
    parseSkrBalance([token("1000000", SKR_MINT, "someone-else")], owner),
  );
  assert.throws(() => parseSkrBalance([token("1"), token("1")], owner));
  assert.throws(() => parseSkrBalance(undefined, owner));
});
test("mainnet isolated read; concurrent calls coalesce, cache/cooldown and expiry", async () => {
  let now = 1000,
    calls = 0;
  const detector = createSkrDetector(
    (async (url, options) => {
      calls++;
      assert.equal(url, SKR_RPC);
      const body = JSON.parse(options!.body as string);
      assert.equal(body.method, "getTokenAccountsByOwner");
      assert.deepEqual(body.params[1], { mint: SKR_MINT });
      return new Response(
        JSON.stringify({ result: { value: [token("6660000")] } }),
      );
    }) as typeof fetch,
    () => now,
  );
  const values = await Promise.all([
    detector(owner),
    detector(owner),
    detector(owner, true),
  ]);
  assert.ok(values.every((v) => v.status === "found"));
  assert.equal(calls, 1);
  await detector(owner, true);
  assert.equal(calls, 1);
  now += 15_001;
  await detector(owner, true);
  assert.equal(calls, 2);
  now += SKR_TTL + 1;
  await detector(owner);
  assert.equal(calls, 3);
});
test("network error becomes unknown and throttles explicit retries; no false empty balance", async () => {
  let calls = 0,
    now = 0;
  const detector = createSkrDetector(
    (async () => {
      calls++;
      throw Error("429");
    }) as typeof fetch,
    () => now,
  );
  assert.equal((await detector(owner)).status, "unavailable");
  for (let n = 0; n < 10; n++) await detector(owner, true);
  assert.equal(calls, 1);
  now = 60_001;
  await detector(owner, true);
  assert.equal(calls, 2);
});
test("nine taps within four seconds, no carryover from locked state or previous unlock", () => {
  const gesture = new DetectorGesture();
  for (let n = 0; n < 8; n++) assert.equal(gesture.tap(false, n * 10), false);
  for (let n = 0; n < 8; n++) assert.equal(gesture.tap(true, n * 500), false);
  assert.equal(gesture.tap(true, 4000), true);
  assert.equal(gesture.tap(true, 4100), false);
  gesture.reset();
  for (let n = 0; n < 9; n++) assert.equal(gesture.tap(true, n * 501), false);
  gesture.reset();
  for (let n = 0; n < 10; n++) assert.equal(gesture.tap(true, n * 1000), false);
});
