import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { BorshAccountsCoder, BN } from "@coral-xyz/anchor";
import { IDL, PROGRAM_ID } from "@yac/shared/src/client";
import { MIN_LOCK, UNLOCK_COOLDOWN } from "@yac/shared";
import { installBufferSubarray } from "../app/src/bufferCompat";

test("Hermes/browser Buffer keeps numeric methods and shared memory through Anchor subarray decoding", async () => {
  // Trailing slash selects the npm polyfill instead of Node's built-in Buffer.
  const BrowserBuffer = (
    createRequire(resolve("package.json"))("buffer/") as {
      Buffer: typeof Buffer;
    }
  ).Buffer;
  // Reproduce Hermes returning a Uint8Array without the Buffer prototype.
  BrowserBuffer.prototype.subarray = function (
    start?: number,
    end?: number,
  ): Buffer {
    const view = Uint8Array.prototype.subarray.call(this, start, end);
    return new Uint8Array(
      view.buffer,
      view.byteOffset,
      view.byteLength,
    ) as Buffer;
  };
  const coder = new BorshAccountsCoder(IDL);
  const encoded = await coder.encode("config", {
    admin: PROGRAM_ID,
    tokenMint: PROGRAM_ID,
    minLockAmount: new BN(MIN_LOCK.toString()),
    unlockCooldownSeconds: new BN(UNLOCK_COOLDOWN.toString()),
    bump: 255,
    faucetDistributed: new BN(0),
  });
  assert.throws(
    () => coder.decode("config", BrowserBuffer.from(encoded)),
    /readUIntLE/,
  );
  installBufferSubarray(BrowserBuffer);
  installBufferSubarray(BrowserBuffer); // Idempotent for fast refresh.
  const decoded = coder.decode("config", BrowserBuffer.from(encoded));
  assert.equal(decoded.minLockAmount.toString(), MIN_LOCK.toString());
  assert.equal(decoded.bump, 255);
  const parent = BrowserBuffer.from([1, 2, 3]);
  const child = parent.subarray(1, 2);
  assert.equal(child.readUIntLE(0, 1), 2);
  child[0] = 9;
  assert.equal(parent[1], 9);
});
