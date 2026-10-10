import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BN, BorshAccountsCoder } from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { AccountLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  IDL,
  PROGRAM_ID,
  readWalletSnapshot,
} from "../packages/shared/src/client";
import {
  deriveCyclePda,
  fetchPublishedCycles,
} from "../packages/shared/src/cycles";
import { reconcilePointDisplay } from "../app/src/ppDisplay";

for (const count of [10n, 100n, 1000n, 5000n])
  test(`warm discovery at ${count} cycles makes zero RPC`, async () => {
    const c = {
      getMultipleAccountsInfo() {
        throw new Error("Unexpected historical RPC");
      },
    } as unknown as Connection;
    assert.deepEqual(await fetchPublishedCycles(c, count, count), []);
  });
test("cycle discovery reads only 101,102,103 and validates account identity", async () => {
  const coder = new BorshAccountsCoder(IDL);
  const requested: string[][] = [];
  const c = {
    async getMultipleAccountsInfo(keys: PublicKey[]) {
      requested.push(keys.map((k) => k.toBase58()));
      return Promise.all(
        keys.map(async (_, i) => ({
          owner: PROGRAM_ID,
          data: await coder.encode("shitCycle", {
            cycleId: new BN(101 + i),
            start: new BN(0),
            end: new BN(3600),
            root: new Array(32).fill(0),
            manifestHash: new Array(32).fill(0),
            totalPoints: new Array(32).fill(0),
            budget: new BN(100000000000),
            totalAllocated: new BN(0),
            claimedAmount: new BN(0),
            leafCount: 0,
            publishedAt: new BN(3601),
            publisher: PROGRAM_ID,
            bump: 1,
          }),
        })),
      );
    },
  } as unknown as Connection;
  const result = await fetchPublishedCycles(c, 104n, 101n);
  assert.deepEqual(requested, [
    [101n, 102n, 103n].map((i) => deriveCyclePda(i).toBase58()),
  ]);
  assert.deepEqual(
    result.map((c) => c.cycleId),
    ["101", "102", "103"],
  );
  await assert.rejects(fetchPublishedCycles(c, 100n, 101n));
});
test("mobile and public localization sources contain no known UTF-8 mojibake", () => {
  for (const path of [
    "app/src/AccountingPanel.tsx",
    "app/src/App.tsx",
    "server/YetAnotherCat.Api/wwwroot/locales.js",
    "server/YetAnotherCat.Api/wwwroot/product.js",
  ])
    assert(!/вЂ|В·|рџ|\uFFFD/.test(readFileSync(path, "utf8")), path);
});
test("public locales load complete matching translations and cover every referenced key", async () => {
  const source = readFileSync(
    "server/YetAnotherCat.Api/wwwroot/locales.js",
    "utf8",
  );
  const { locales } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
  assert(locales?.en && locales?.ca, "Missing locale export");
  assert.deepEqual(
    Object.keys(locales.en).sort(),
    Object.keys(locales.ca).sort(),
  );
  const product = readFileSync(
    "server/YetAnotherCat.Api/wwwroot/product.js",
    "utf8",
  );
  for (const [, key] of product.matchAll(/\bt\.([A-Za-z]\w*)/g)) {
    assert(Object.hasOwn(locales.en, key), `Missing English key: ${key}`);
    assert(Object.hasOwn(locales.ca, key), `Missing Catalan key: ${key}`);
  }
  for (const values of Object.values(locales) as Record<string, unknown>[]) {
    for (const [key, value] of Object.entries(values)) {
      assert(
        value !== "" && value !== null && value !== undefined,
        `Empty translation: ${key}`,
      );
    }
  }
});
test("stake upgrade does not rewind 508 live PP to an older 500 finalized snapshot", () => {
  assert.equal(reconcilePointDisplay(508, 500, 1, true, true).value, 508);
  assert.equal(reconcilePointDisplay(508, 500, 1.5, true, false).value, 508);
  const fresh = reconcilePointDisplay(508, 520, 1.5, true, false);
  assert(fresh.value > 508 && fresh.value < 520);
  assert.equal(reconcilePointDisplay(508, 0, 1.5, true, false, true).value, 0);
  const large = reconcilePointDisplay(1000, 500, 1.5, true, false);
  assert.equal(large.value, 500);
  assert.equal(large.largeCorrection, true);
});
test("stake synchronization keeps moving and reconciles 4904 to 4930 without a frame jump", () => {
  let shown = 4904;
  for (let frame = 1; frame <= 30; frame++) {
    const next = reconcilePointDisplay(
      shown,
      4904 + frame * 0.15,
      1.5,
      true,
      true,
      false,
      0.1,
    );
    assert(next.value > shown, "Frozen while waiting for finalized stake");
    assert(next.value - shown <= 0.300001);
    shown = next.value;
  }
  for (let frame = 1; frame <= 300; frame++) {
    const target = 4930 + frame * 0.2;
    const next = reconcilePointDisplay(
      shown,
      target,
      2,
      true,
      false,
      false,
      0.1,
    );
    assert(next.value > shown);
    assert(next.value - shown <= 0.400001, "Abrupt catch-up frame");
    assert.equal(next.largeCorrection, false);
    shown = next.value;
    if (frame === 300) assert(target - shown < 1);
  }
  assert.equal(
    reconcilePointDisplay(shown, shown + 1, 2, true, false, false, 0).value,
    shown,
  );
});

test("wallet snapshot decodes exact token balance and rejects mismatched account identities", async () => {
  const wallet = Keypair.generate().publicKey;
  const mint = PublicKey.unique();
  const coder = new BorshAccountsCoder(IDL);
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(
    {
      mint,
      owner: wallet,
      amount: 9007199254740993n,
      delegateOption: 0,
      delegate: PublicKey.default,
      state: 1,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    data,
  );
  const token = {
    owner: TOKEN_PROGRAM_ID,
    data,
    executable: false,
    lamports: 1,
  };
  const receipt = {
    ...token,
    owner: PROGRAM_ID,
    data: await coder.encode("faucetReceipt", { owner: wallet }),
  };
  let infos = [null, token, receipt];
  const c = {
    async getMultipleAccountsInfo() {
      return infos;
    },
  } as unknown as Connection;
  assert.deepEqual(await readWalletSnapshot(c, wallet, mint), {
    balance: 9007199254740993n,
    position: null,
    claimed: true,
  });
  await assert.rejects(
    readWalletSnapshot(c, Keypair.generate().publicKey, mint),
    /identity/,
  );
  await assert.rejects(
    readWalletSnapshot(c, wallet, PublicKey.unique()),
    /identity/,
  );
  infos = [null, { ...token, owner: PROGRAM_ID }, null];
  await assert.rejects(readWalletSnapshot(c, wallet, mint));
  infos = [null, token, { ...receipt, data: Buffer.alloc(8) }];
  await assert.rejects(readWalletSnapshot(c, wallet, mint));
  infos = [null, null, null];
  assert.deepEqual(await readWalletSnapshot(c, wallet, mint), {
    balance: 0n,
    position: null,
    claimed: false,
  });
});
