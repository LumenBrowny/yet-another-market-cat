import { test } from "node:test";
import assert from "node:assert/strict";
import fixtures from "../protocol/accounting-fixtures.json";
import tiers from "../protocol/mining-tiers.json";
import { MINING_TIERS, getMiningTier } from "../packages/shared/src/index";
import { decodeLogs, readHistory } from "../scripts/chain-history";
import { IDL, PROGRAM_ID } from "../packages/shared/src/client";
import { PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder, BN } from "@coral-xyz/anchor";
import { mkdtemp, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FinalizedBlockCache } from "../scripts/finalized-block-cache";

test("finalized block cache reuses RPC blocks but never bypasses fresh history availability", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "yac-rpc-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = await new BorshAccountsCoder(IDL).encode("config", {
    admin: PROGRAM_ID,
    tokenMint: PROGRAM_ID,
    minLockAmount: new BN(1000),
    unlockCooldownSeconds: new BN(86400),
    bump: 1,
    faucetDistributed: new BN(0),
  });
  let blockValue: unknown = { blockTime: 999, transactions: [] };
  let blocks = 0,
    fail = false,
    firstAvailable = 1,
    genesis = "genesis-a";
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, options: { body: string }) => {
      const { method } = JSON.parse(options.body);
      if (fail) throw Error("RPC unavailable");
      if (method === "getBlock") blocks++;
      const values: Record<string, unknown> = {
        getGenesisHash: genesis,
        getSlot: 100,
        getFirstAvailableBlock: firstAvailable,
        getAccountInfo: {
          value: {
            owner: PROGRAM_ID.toBase58(),
            data: [bytes.toString("base64"), "base64"],
          },
        },
        getSignaturesForAddress: [
          { signature: "s", slot: 99, err: null },
          { signature: "old", slot: 1, err: null },
        ],
        getBlockTime: 1000,
        getBlock: blockValue,
      };
      return new Response(JSON.stringify({ result: values[method] }), {
        status: 200,
      });
    },
  );
  const input = {
    checkpoint: 0,
    startSlot: 50,
    endpoint: "http://localhost:8899",
    programId: PROGRAM_ID.toBase58(),
    blockCacheDirectory: directory,
  };
  const first = await readHistory(input);
  const second = await readHistory(input);
  assert.equal(blocks, 1);
  assert.deepEqual(first.events, second.events);
  assert.deepEqual(second.rpcBlocks, { cached: 1, downloaded: 0 });
  const [warmNamespace] = await readdir(directory);
  await writeFile(join(directory, warmNamespace, "99.gz"), "corrupt");
  const repaired = await readHistory(input);
  assert.deepEqual(repaired.rpcBlocks, { cached: 0, downloaded: 1 });
  assert.deepEqual(repaired.events, first.events);
  const restarted = await readHistory(input);
  assert.deepEqual(restarted.rpcBlocks, { cached: 1, downloaded: 0 });
  firstAvailable = 51;
  await assert.rejects(readHistory(input), /Required history pruned/);
  firstAvailable = 1;
  blocks = 1; // Remaining checks count requests relative to the repaired warm state.
  fail = true;
  await assert.rejects(readHistory(input), /RPC unavailable/);
  fail = false;
  genesis = "genesis-b";
  await readHistory(input);
  assert.equal(blocks, 2, "another genesis cannot reuse a finalized block");
  await readHistory({ ...input, endpoint: "http://localhost:8900" });
  assert.equal(blocks, 3, "another RPC provider has an independent cache");
  genesis = "genesis-c";
  blockValue = null;
  await assert.rejects(readHistory(input), /Block\/time unavailable/);
  await assert.rejects(readHistory(input), /Block\/time unavailable/);
  assert.equal(blocks, 5, "null blocks must be fetched again");
  blockValue = {
    blockTime: 999,
    transactions: [{ transaction: { signatures: ["s"] }, meta: null }],
  };
  await assert.rejects(readHistory(input), /Missing metadata/);
  await assert.rejects(readHistory(input), /Missing metadata/);
  assert.equal(blocks, 7, "incomplete blocks must not enter the cache");
});

test("corrupt cached blocks are misses", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "yac-cache-corrupt-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = new FinalizedBlockCache(
    directory,
    "http://localhost:8899",
    "genesis",
  );
  await cache.put(42, { blockTime: 1, transactions: [] });
  assert.deepEqual(await cache.get(42), { blockTime: 1, transactions: [] });
  const [namespace] = await readdir(directory);
  await writeFile(join(directory, namespace, "42.gz"), "broken gzip");
  assert.equal(await cache.get(42), undefined);
});

for (const failure of ["timestamp", "pruned", "pagination"] as const) {
  test(`RPC history defers ${failure} without inventing a finalized boundary`, async (t) => {
    const bytes = await new BorshAccountsCoder(IDL).encode("config", {
      admin: PROGRAM_ID,
      tokenMint: PROGRAM_ID,
      minLockAmount: new BN(1000),
      unlockCooldownSeconds: new BN(86400),
      bump: 1,
      faucetDistributed: new BN(0),
    });
    t.mock.method(
      globalThis,
      "fetch",
      async (_url: unknown, options: { body: string }) => {
        const { method } = JSON.parse(options.body);
        const results: Record<string, unknown> = {
          getGenesisHash: "genesis",
          getSlot: 100,
          getFirstAvailableBlock: failure === "pruned" ? 101 : 1,
          getAccountInfo: {
            value: {
              owner: PROGRAM_ID.toBase58(),
              data: [bytes.toString("base64"), "base64"],
            },
          },
          getSignaturesForAddress:
            failure === "pagination"
              ? [{ signature: "repeated", slot: 100, err: null }]
              : [],
          getBlockTime: null,
        };
        assert(method in results);
        return new Response(JSON.stringify({ result: results[method] }));
      },
    );
    await assert.rejects(
      readHistory({
        checkpoint: 0,
        startSlot: 10,
        endpoint: "http://rpc.invalid",
        programId: PROGRAM_ID.toBase58(),
      }),
      failure === "pruned"
        ? /pruned/
        : failure === "pagination"
          ? /pagination/
          : /timestamp unavailable/,
    );
  });
}

test(".NET tier spec exactly matches shared TS thresholds and rational rates", () => {
  assert.deepEqual(
    tiers,
    MINING_TIERS.map((t) => ({
      id: t.id,
      minimumBaseUnits: String(t.minimumLocked),
      rateUnits: String(
        (1000n * t.multiplierNumerator) / t.multiplierDenominator,
      ),
    })),
  );
});
for (const f of fixtures)
  test(`independent accounting: ${f.name}`, () => {
    let previous = 0,
      rate = 0n,
      points = 0n;
    for (const t of f.transitions) {
      const time = Math.max(previous, t.time);
      points +=
        BigInt(
          Math.max(0, Math.min(f.end, time) - Math.max(f.start, previous)),
        ) * rate;
      previous = time;
      const tier = getMiningTier(BigInt(t.locked));
      rate = (1000n * tier.multiplierNumerator) / tier.multiplierDenominator;
    }
    points += BigInt(Math.max(0, f.end - Math.max(f.start, previous))) * rate;
    assert.equal(String(points), f.expected);
  });
const pid = PROGRAM_ID.toBase58();
const other = new PublicKey(new Uint8Array(32).fill(2)).toBase58();
function eventLog() {
  const discriminator = IDL.events!.find(
    (e) => e.name === "positionCreated",
  )!.discriminator;
  const payload = Buffer.alloc(48);
  Buffer.from(discriminator).copy(payload);
  PROGRAM_ID.toBuffer().copy(payload, 8);
  payload.writeBigInt64LE(100n, 40);
  return `Program data: ${payload.toString("base64")}`;
}
test("decoder keeps committed target events, ignores foreign data", () => {
  const events = decodeLogs(
    [
      `Program ${other} invoke [1]`,
      eventLog(),
      `Program ${pid} invoke [2]`,
      eventLog(),
      `Program ${pid} success`,
      `Program ${other} success`,
    ],
    pid,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].index, 3);
});
test("decoder discards failed inner invocation even if transaction succeeds", () => {
  assert.equal(
    decodeLogs(
      [
        `Program ${other} invoke [1]`,
        `Program ${pid} invoke [2]`,
        eventLog(),
        `Program ${pid} failed: custom program error`,
        `Program ${other} success`,
      ],
      pid,
    ).length,
    0,
  );
  assert.equal(
    decodeLogs(
      [
        `Program ${other} invoke [1]`,
        `Program ${pid} invoke [2]`,
        eventLog(),
        `Program ${pid} success`,
        `Program ${other} failed: custom program error`,
      ],
      pid,
    ).length,
    0,
  );
});
test("decoder rejects truncated, unbalanced and unknown program data", () => {
  assert.throws(() =>
    decodeLogs([`Program ${pid} invoke [1]`, eventLog()], pid),
  );
  assert.throws(() =>
    decodeLogs([`Program ${pid} invoke [1]`, "Log truncated"], pid),
  );
  assert.throws(() =>
    decodeLogs([`Program ${pid} invoke [1]`, "Program data: AAAAAAAA"], pid),
  );
});
