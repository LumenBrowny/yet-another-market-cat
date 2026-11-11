import test from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  MAINNET_GENESIS,
  digest,
} from "../tools/offline-mainnet/deployment-policy";
import {
  initializationAddresses,
  initializationPinsDigest,
  type InitializationPins,
} from "../tools/offline-mainnet/initialization-policy";
import { signInitialization } from "../tools/offline-mainnet/initialization-signing";
import {
  readInitSnapshot,
  prepareInitialization,
  assembleInitialization,
  submitInitializationOnce,
  reconcileInitialization,
  type InitRpc,
  type InitAttempt,
} from "../tools/offline-mainnet/initialization-online";
test("initialization gate binds signatures, budgets, nonce, signed simulation and pre-send journal", async () => {
  const keys = Object.fromEntries(
    [
      "admin",
      "program",
      "payer",
      "buffer",
      "bufferAuthority",
      "nonceAccount",
      "mint",
      "publisher",
      "issuer",
    ].map((r) => [r, Keypair.generate()]),
  );
  const elf = Buffer.from("fixture");
  const p: InitializationPins = {
    schema: "yamc-mainnet-initialization-v1",
    deployment: {
      schema: "yamc-mainnet-deployment-pins-v1",
      genesis: MAINNET_GENESIS,
      program: keys.program.publicKey.toBase58(),
      admin: keys.admin.publicKey.toBase58(),
      payer: keys.payer.publicKey.toBase58(),
      buffer: keys.buffer.publicKey.toBase58(),
      bufferAuthority: keys.bufferAuthority.publicKey.toBase58(),
      nonceAccount: keys.nonceAccount.publicKey.toBase58(),
      binarySha256: digest(elf),
      binarySize: elf.length,
      programRentLamports: 1000,
    },
    mint: keys.mint.publicKey.toBase58(),
    publisher: keys.publisher.publicKey.toBase58(),
    issuer: keys.issuer.publicKey.toBase58(),
    mintRentLamports: 1000,
  };
  const a = initializationAddresses(p),
    loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  const nonce = Buffer.alloc(80);
  nonce.writeUInt32LE(1);
  nonce.writeUInt32LE(1, 4);
  keys.admin.publicKey.toBuffer().copy(nonce, 8);
  Keypair.generate().publicKey.toBuffer().copy(nonce, 40);
  const program = Buffer.alloc(36);
  program.writeUInt32LE(2);
  a.programData.toBuffer().copy(program, 4);
  const pd = Buffer.alloc(45 + elf.length);
  pd.writeUInt32LE(3);
  pd.writeBigUInt64LE(1n, 4);
  pd[12] = 1;
  keys.admin.publicKey.toBuffer().copy(pd, 13);
  elf.copy(pd, 45);
  const account = (data: Buffer, owner: PublicKey, executable = false) => ({
    data,
    owner,
    executable,
    lamports: 1000,
  });
  const accounts = [
    account(nonce, SystemProgram.programId),
    account(program, loader, true),
    account(pd, loader),
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    account(Buffer.alloc(0), SystemProgram.programId),
  ];
  let genesis = MAINNET_GENESIS,
    balance = 1000000,
    simFail = false,
    sends = 0,
    record: InitAttempt | undefined;
  const rpc: InitRpc = {
    getGenesisHash: async () => genesis,
    getMultipleAccountsInfoAndContext: async () => ({
      context: { slot: 100 },
      value: accounts,
    }),
    getMinimumBalanceForRentExemption: async () => 1000,
    getFeeForMessage: async () => ({ context: { slot: 100 }, value: 10000 }),
    getBalanceAndContext: async () => ({
      context: { slot: 100 },
      value: balance,
    }),
    simulateTransaction: (async (_tx, config) => {
      assert(!Array.isArray(config));
      assert.equal(config?.sigVerify, true);
      assert.equal(config?.replaceRecentBlockhash, false);
      return {
        context: { slot: 100 },
        value: { err: simFail ? "failure" : null, logs: [] },
      };
    }) as InitRpc["simulateTransaction"],
    sendRawTransaction: async () => {
      assert(record);
      sends++;
      throw Error("Lost response");
    },
    getSignatureStatuses: async () => ({
      context: { slot: 100 },
      value: [null],
    }),
  };
  const limits = {
    maxFeeLamports: 20000,
    maxAdminDebitLamports: 20000,
    adminReserveLamports: 1000,
  };
  genesis = "wrong";
  await assert.rejects(readInitSnapshot(rpc, p), /Wrong network/);
  genesis = MAINNET_GENESIS;
  balance = 1;
  await assert.rejects(
    prepareInitialization(rpc, p, elf, "initialize", limits),
    /balance/,
  );
  balance = 1000000;
  await assert.rejects(
    prepareInitialization(rpc, p, elf, "initialize", {
      ...limits,
      maxAdminDebitLamports: 1,
    }),
    /cap/,
  );
  const prepared = await prepareInitialization(
    rpc,
    p,
    elf,
    "initialize",
    limits,
  );
  const results = (["admin", "mint"] as const).map((role) =>
    signInitialization(
      p,
      prepared.request,
      elf,
      role,
      [...keys[role].secretKey],
      prepared.request.messageSha256,
      initializationPinsDigest(p),
    ),
  );
  await assert.rejects(
    assembleInitialization(rpc, p, elf, prepared, [results[0]], limits),
    /roles/,
  );
  await assert.rejects(
    assembleInitialization(
      rpc,
      p,
      elf,
      prepared,
      [results[0], results[0]],
      limits,
    ),
    /roles/,
  );
  const raw = await assembleInitialization(
    rpc,
    p,
    elf,
    prepared,
    results,
    limits,
  );
  nonce[40] ^= 1;
  await assert.rejects(
    assembleInitialization(rpc, p, elf, prepared, results, limits),
    /State changed/,
  );
  nonce[40] ^= 1;
  const store = {
    create(r: InitAttempt) {
      if (record) throw Error("Existing journal");
      record = r;
    },
    read() {
      assert(record);
      return record;
    },
  };
  const approval = {
    messageSha256: prepared.request.messageSha256,
    pinsSha256: prepared.pinsSha256,
  };
  await assert.rejects(
    submitInitializationOnce(rpc, p, elf, prepared, raw, limits, store, {
      ...approval,
      messageSha256: "wrong",
    }),
    /approval/,
  );
  assert.equal(record, undefined);
  simFail = true;
  await assert.rejects(
    submitInitializationOnce(
      rpc,
      p,
      elf,
      prepared,
      raw,
      limits,
      store,
      approval,
    ),
    /simulation/,
  );
  simFail = false;
  assert.equal(record, undefined);
  await assert.rejects(
    submitInitializationOnce(
      rpc,
      p,
      elf,
      prepared,
      raw,
      limits,
      {
        ...store,
        create() {
          throw Error("Disk full");
        },
      },
      approval,
    ),
    /Disk full/,
  );
  assert.equal(sends, 0);
  assert.equal(
    (
      await submitInitializationOnce(
        rpc,
        p,
        elf,
        prepared,
        raw,
        limits,
        store,
        approval,
      )
    ).status,
    "UNKNOWN_DO_NOT_RESEND",
  );
  assert.equal(sends, 1);
  await assert.rejects(
    submitInitializationOnce(
      rpc,
      p,
      elf,
      prepared,
      raw,
      limits,
      store,
      approval,
    ),
    /Existing journal/,
  );
  assert.equal(sends, 1);
  assert.equal(
    (await reconcileInitialization(rpc, p, elf, prepared, raw, store)).status,
    "PENDING_OR_UNKNOWN_DO_NOT_RESEND",
  );
  assert.equal(sends, 1);
  await assert.rejects(
    reconcileInitialization(rpc, p, elf, prepared, raw, {
      ...store,
      read() {
        return { ...record!, wireSha256: "bad" };
      },
    }),
    /Journal mismatch/,
  );
});
