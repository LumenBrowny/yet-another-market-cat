import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAppConfiguration } from "../packages/shared/src/app-config";
import {
  verifyCycleReport,
  verifyCyclesReport,
  recomputePoints,
} from "../scripts/cycle-verifier";
import vectors from "../protocol/settlement-vectors.json";
import {
  assertBackendIdentity,
  checkBackendIdentity,
} from "../packages/shared/src/backend-identity";
import { BN, BorshAccountsCoder } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { IDL, PROGRAM_ID } from "../packages/shared/src/client";
import {
  MAINNET_GENESIS,
  readCheckedConfig,
  readChainCheckedConfig,
} from "../packages/shared/src/deployment-guard";
import { isCustodyWithdrawal } from "../packages/shared/src/withdrawal-guard";
import {
  ensureAta,
  instruction,
  ownerAccounts,
} from "../packages/shared/src/client";
import {
  Keypair,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

test("Backend-free withdrawal accepts only exact owner-bound instruction shapes", () => {
  const owner = Keypair.generate().publicKey,
    mint = Keypair.generate().publicKey;
  const accounts = ownerAccounts(owner, mint);
  const request = instruction("requestWithdraw", accounts, 1000n);
  const execute = [
    ensureAta(owner, mint),
    instruction("executeWithdraw", accounts),
  ];
  assert(isCustodyWithdrawal([request], owner, mint));
  assert(isCustodyWithdrawal(execute, owner, mint));
  for (const instructions of [
    [],
    [instruction("deposit", accounts, 1000n)],
    [instruction("requestWithdraw", accounts, 0n)],
    [execute[1]],
    [...execute, request],
    [
      request,
      SystemProgram.transfer({
        fromPubkey: owner,
        toPubkey: mint,
        lamports: 1,
      }),
    ],
    [
      new TransactionInstruction({
        ...request,
        programId: SystemProgram.programId,
      }),
    ],
    [
      new TransactionInstruction({
        ...request,
        data: Buffer.concat([request.data, Buffer.from([0])]),
      }),
    ],
  ])
    assert.equal(isCustodyWithdrawal(instructions, owner, mint), false);
  for (const valid of [[request], execute]) {
    assert.equal(
      isCustodyWithdrawal(valid, Keypair.generate().publicKey, mint),
      false,
    );
    assert.equal(
      isCustodyWithdrawal(valid, owner, Keypair.generate().publicKey),
      // Request only changes the owner's position; it has no mint account.
      // The RPC Config guard pins the mint independently before signing.
      valid.length === 1,
    );
    for (let i = 0; i < valid.length; i++)
      for (let k = 0; k < valid[i].keys.length; k++) {
        for (const change of [
          { pubkey: Keypair.generate().publicKey },
          { isSigner: !valid[i].keys[k].isSigner },
          { isWritable: !valid[i].keys[k].isWritable },
        ]) {
          const copy = valid.map(
            (ix) =>
              new TransactionInstruction({
                ...ix,
                keys: ix.keys.map((key) => ({ ...key })),
              }),
          );
          Object.assign(copy[i].keys[k], change);
          assert.equal(isCustodyWithdrawal(copy, owner, mint), false);
        }
      }
  }
});

const mainnetInput = {
  profile: "mainnet",
  cluster: "mainnet-beta",
  rpcUrl: "https://rpc.invalid",
  apiUrl: "https://api.invalid",
  programId: PROGRAM_ID.toBase58(),
  tokenMint: PROGRAM_ID.toBase58(),
};
test("Backend identity is exact; unavailable and malformed responses fail closed", async (t) => {
  const app = parseAppConfiguration(mainnetInput);
  const identity = {
    version: 1,
    cluster: app.cluster,
    programId: app.programId,
    mint: app.tokenMint,
    genesisHash: MAINNET_GENESIS,
  };
  assert.doesNotThrow(() =>
    assertBackendIdentity(identity, app, MAINNET_GENESIS),
  );
  for (const key of Object.keys(identity)) {
    assert.throws(() =>
      assertBackendIdentity(
        { ...identity, [key]: "wrong" },
        app,
        MAINNET_GENESIS,
      ),
    );
    assert.throws(() =>
      assertBackendIdentity(
        { ...identity, [key]: undefined },
        app,
        MAINNET_GENESIS,
      ),
    );
  }
  for (const value of [null, [], {}, "mainnet"])
    assert.throws(() => assertBackendIdentity(value, app, MAINNET_GENESIS));
  let response = new Response("{}", { status: 503 });
  const fetchMock = t.mock.method(globalThis, "fetch", async () => response);
  await assert.rejects(
    checkBackendIdentity(app, MAINNET_GENESIS),
    /unavailable/,
  );
  response = new Response("not JSON");
  await assert.rejects(checkBackendIdentity(app, MAINNET_GENESIS));
  response = new Response(JSON.stringify(identity));
  await checkBackendIdentity(app, MAINNET_GENESIS);
  assert.equal(
    fetchMock.mock.calls[0].arguments[0],
    `${app.apiUrl}/api/deployment`,
  );
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("offline");
  });
  await assert.rejects(checkBackendIdentity(app, MAINNET_GENESIS), /offline/);
});
test("Mainnet is explicit, pinned and excludes demo/local endpoints", () => {
  assert.equal(parseAppConfiguration(mainnetInput).cluster, "mainnet-beta");
  for (const change of [
    { programId: undefined },
    { tokenMint: undefined },
    { rpcUrl: undefined },
    { apiUrl: undefined },
    { cluster: "devnet" },
    { profile: "local" },
    { demoControls: "true" },
    { rehearsalGenesis: MAINNET_GENESIS },
    { rpcUrl: "http://rpc.invalid" },
    { apiUrl: "https://[::1]" },
  ])
    assert.throws(() => parseAppConfiguration({ ...mainnetInput, ...change }));
});
test("Mainnet guard rejects wrong network, owner, mint, legacy and missing config", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          version: 1,
          cluster: "mainnet-beta",
          programId: mainnetInput.programId,
          mint: mainnetInput.tokenMint,
          genesisHash: MAINNET_GENESIS,
        }),
      ),
  );
  const app = parseAppConfiguration(mainnetInput);
  let genesis = MAINNET_GENESIS;
  const data = await new BorshAccountsCoder(IDL).encode("config", {
    admin: PROGRAM_ID,
    tokenMint: PROGRAM_ID,
    bump: 1,
    minLockAmount: new BN(1000),
    unlockCooldownSeconds: new BN(86400),
    faucetDistributed: new BN(0),
    launchMode: true,
    activatedAt: new BN(0),
    ppCutoff: new BN(0),
    totalAllocated: new BN(0),
    faucetOpensAt: new BN(0),
    waveTwoAt: new BN(0),
    faucetIssuer: PROGRAM_ID,
  });
  let info: { owner: PublicKey; data: Buffer } | null = {
    owner: PROGRAM_ID,
    data,
  };
  const connection = {
    getGenesisHash: async () => genesis,
    getAccountInfo: async () => info,
  } as unknown as Connection;
  assert.equal((await readCheckedConfig(connection, app))?.launchMode, true);
  // Backend outage must not prevent custody reads / withdrawals. Normal actions
  // still require the backend identity check; neither path skips chain identity.
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("backend offline");
  });
  assert.equal(
    (await readChainCheckedConfig(connection, app))?.launchMode,
    true,
  );
  await assert.rejects(readCheckedConfig(connection, app), /backend offline/);
  genesis = "devnet";
  await assert.rejects(readChainCheckedConfig(connection, app), /genesis/);
  await assert.rejects(readCheckedConfig(connection, app), /genesis/);
  genesis = MAINNET_GENESIS;
  const other = "11111111111111111111111111111111";
  await assert.rejects(
    readCheckedConfig(connection, { ...app, programId: other }),
    /IDL/,
  );
  await assert.rejects(
    readCheckedConfig(connection, { ...app, tokenMint: other }),
    /mint/,
  );
  info = { owner: new PublicKey(other), data };
  await assert.rejects(readCheckedConfig(connection, app), /owner/);
  info = { owner: PROGRAM_ID, data: data.subarray(0, 97) };
  await assert.rejects(readCheckedConfig(connection, app), /config/);
  info = null;
  await assert.rejects(readCheckedConfig(connection, app), /config/);
  genesis = "devnet";
  assert.equal(
    await readCheckedConfig(connection, parseAppConfiguration({})),
    null,
  );
});
test("USB rehearsal permits only explicit local endpoints and a pinned genesis", () => {
  const base = {
    profile: "local",
    cluster: "devnet",
    standalone: true,
    rpcUrl: "http://127.0.0.1:8929",
    apiUrl: "http://localhost:5088",
    rehearsalGenesis: "6zGKm1eeBKKfL226bGHdvxH7k3P1umUGZbRTY444WDdN",
  };
  assert.equal(
    parseAppConfiguration(base).rehearsalGenesis,
    base.rehearsalGenesis,
  );
  for (const change of [
    { rehearsalGenesis: undefined },
    { rehearsalGenesis: "bad" },
    { profile: "staging" },
    { cluster: "mainnet-beta" },
    { cluster: "localnet" },
    { rpcUrl: "https://api.devnet.solana.com" },
    { apiUrl: "http://192.168.1.2:5088" },
  ])
    assert.throws(() => parseAppConfiguration({ ...base, ...change }));
});
test("Standalone profiles reject emulator, credentials, mainnet and insecure staging", () => {
  const base = {
    profile: "local",
    cluster: "localnet",
    apiUrl: "http://192.168.1.2:5080",
    rpcUrl: "http://192.168.1.2:9099",
    standalone: true,
  };
  assert.equal(parseAppConfiguration(base).cluster, "localnet");
  assert.equal(
    parseAppConfiguration(base).identity,
    "Yet Another Market Cat 💩",
  );
  for (const change of [
    { rpcUrl: "http://10.0.2.2:9099" },
    { apiUrl: "http://localhost:5080" },
    { apiUrl: "http://user:secret@example.com" },
    { cluster: "mainnet-beta" },
    { apiUrl: "" },
    { profile: "staging", cluster: "devnet" },
  ])
    assert.throws(() => parseAppConfiguration({ ...base, ...change }));
  assert.equal(
    parseAppConfiguration({
      profile: "staging",
      cluster: "devnet",
      rpcUrl: "https://api.devnet.solana.com",
      apiUrl: "https://example.com",
      standalone: true,
    }).demoControls,
    false,
  );
  assert.throws(() =>
    parseAppConfiguration({
      profile: "staging",
      cluster: "devnet",
      apiUrl: "https://example.com",
      demoControls: "true",
    }),
  );
});
test("Internal consistency without chain history is UNVERIFIABLE, never VALID", async () => {
  const report = await verifyCycleReport(vectors[3].canonical);
  assert.equal(report.result, "UNVERIFIABLE");
  assert(report.internalConsistency);
  assert(!report.chainRecomputation);
  assert(report.checks.some((c) => c.status === "UNAVAILABLE"));
});
test("Malformed/tampered/noncanonical manifests have concrete INVALID checks", async () => {
  for (const input of [
    "{",
    vectors[3].canonical + "\n",
    vectors[3].canonical.replace(
      vectors[3].manifest.merkleRoot,
      "00".repeat(32),
    ),
  ]) {
    const report = await verifyCycleReport(input);
    assert.equal(report.result, "INVALID");
    assert(report.checks.some((c) => c.status === "FAIL"));
  }
});
test("Independent verifier empty history gives zero miners", () =>
  assert.deepEqual(recomputePoints([], 1000, 1100), []));
test("Batch RPC failure preserves INVALID for tampering and never asserts VALID", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    throw new Error("offline");
  });
  const reports = await verifyCyclesReport(
    [vectors[3].canonical, "{"],
    "http://rpc.invalid",
    1,
  );
  assert.equal(reports.length, 2);
  assert.equal(reports[0].result, "UNVERIFIABLE");
  assert.equal(reports[1].result, "INVALID");
  assert(reports.every((r) => !r.chainRecomputation));
  assert.equal(requests, 2); // One replay's parallel genesis/tip reads, no per-cycle replay.
});
test("Unavailable RPC does not turn an internally valid manifest into VALID or INVALID", async () => {
  const report = await verifyCycleReport(
    vectors[3].canonical,
    "http://127.0.0.1:1",
    1,
  );
  assert.equal(report.result, "UNVERIFIABLE");
  assert(report.internalConsistency);
  assert(!report.chainRecomputation);
  assert(
    report.checks.some((c) => c.id === "rpc" && c.status === "UNAVAILABLE"),
  );
});
