import test from "node:test";
import assert from "node:assert/strict";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  MAINNET_GENESIS,
  digest,
  type DeploymentPins,
} from "../tools/offline-mainnet/deployment-policy";
import { pinsDigest } from "../tools/offline-mainnet/signing";
import { readDeploymentSnapshot } from "../tools/offline-mainnet/deployment-state";
import {
  advanceUpload,
  freshUploadFee,
  uploadTransaction,
  uploadPlanDigest,
  type UploadRpc,
  type UploadRecord,
} from "../tools/offline-mainnet/upload";

test("fee read retries tolerate lag without accepting stale, null or over-cap quotes", async () => {
  const key = Keypair.generate().publicKey;
  const message = new Transaction({
    feePayer: key,
    recentBlockhash: key.toBase58(),
  })
    .add(
      SystemProgram.transfer({
        fromPubkey: key,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1,
      }),
    )
    .compileMessage();
  let calls = 0;
  const recovered = await freshUploadFee(
    {
      getFeeForMessage: async (m) => {
        assert.equal(m, message);
        calls++;
        return calls === 1
          ? { context: { slot: 99 }, value: null }
          : { context: { slot: 100 }, value: 10000 };
      },
    },
    message,
    100,
    20000,
  );
  assert.equal(calls, 2);
  assert.equal(recovered.value, 10000);
  calls = 0;
  await assert.rejects(
    freshUploadFee(
      {
        getFeeForMessage: async () => {
          calls++;
          return { context: { slot: 99 }, value: 10000 };
        },
      },
      message,
      100,
      20000,
    ),
    /stale/,
  );
  assert.equal(calls, 4);
  calls = 0;
  await assert.rejects(
    freshUploadFee(
      {
        getFeeForMessage: async () => {
          calls++;
          return { context: { slot: 100 }, value: 20001 };
        },
      },
      message,
      100,
      20000,
    ),
    /Fee limit/,
  );
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(
    freshUploadFee(
      {
        getFeeForMessage: async () => {
          calls++;
          throw Error("transport");
        },
      },
      message,
      100,
      20000,
    ),
    /transport/,
  );
  assert.equal(calls, 1);
});

test("upload journals each step before send, blocks uncertain results and verifies complete bytes", async () => {
  const keys = Object.fromEntries(
    [
      "admin",
      "program",
      "payer",
      "bufferAuthority",
      "buffer",
      "nonceAccount",
    ].map((r) => [r, Keypair.generate()]),
  );
  const elf = Buffer.alloc(901, 42);
  const p = {
    schema: "yamc-mainnet-deployment-pins-v1",
    genesis: MAINNET_GENESIS,
    ...Object.fromEntries(
      Object.entries(keys).map(([r, k]) => [r, k.publicKey.toBase58()]),
    ),
    binarySha256: digest(elf),
    binarySize: elf.length,
    programRentLamports: 1000,
  } as DeploymentPins;
  const plan = {
    schema: "yamc-upload-plan-v1" as const,
    pinsSha256: pinsDigest(p),
    nonceRent: 1000,
    bufferRent: 1000,
    maxFeeLamports: 10000,
    maxTotalDebitLamports: 42000,
    payerReserveLamports: 1000,
  };
  const records = new Map<number, UploadRecord>();
  const journal = {
    read: (n: number) => records.get(n) ?? null,
    create(n: number, r: UploadRecord) {
      assert(!records.has(n));
      records.set(n, r);
    },
  };
  const accounts: Awaited<
    ReturnType<UploadRpc["getMultipleAccountsInfoAndContext"]>
  >["value"] = [null, null, null, null];
  let sent = 0,
    reads = 0,
    finalized = false,
    genesis = MAINNET_GENESIS,
    balance = 100000,
    simFails = false;
  const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  const rpc: UploadRpc = {
    getGenesisHash: async () => genesis,
    getMultipleAccountsInfoAndContext: async () => ({
      context: { slot: 100 },
      value: accounts,
    }),
    getMinimumBalanceForRentExemption: async () => 1000,
    getLatestBlockhashAndContext: async () => ({
      context: { slot: 100 },
      value: {
        blockhash: Keypair.generate().publicKey.toBase58(),
        lastValidBlockHeight: 200,
      },
    }),
    getFeeForMessage: async () => ({ context: { slot: 100 }, value: 10000 }),
    getBalanceAndContext: async () => ({
      context: { slot: 100 },
      value: balance,
    }),
    simulateTransaction: (async () => ({
      context: { slot: 100 },
      value: { err: simFails ? "failure" : null, logs: [] },
    })) as UploadRpc["simulateTransaction"],
    getSignatureStatuses: async (signatures) => ({
      context: { slot: 100 },
      value: signatures.map(() =>
        finalized
          ? {
              slot: 100,
              confirmations: null,
              confirmationStatus: "finalized",
              err: null,
            }
          : null,
      ),
    }),
    sendRawTransaction: async (raw) => {
      const record = records.get(sent)!;
      assert(record);
      assert(Buffer.from(record.wireBase64, "base64").equals(Buffer.from(raw)));
      const tx = Transaction.from(raw);
      assert(tx.verifySignatures());
      if (sent === 0) {
        const data = Buffer.alloc(80);
        data.writeUInt32LE(1);
        data.writeUInt32LE(1, 4);
        keys.admin.publicKey.toBuffer().copy(data, 8);
        Keypair.generate().publicKey.toBuffer().copy(data, 40);
        accounts[0] = {
          owner: SystemProgram.programId,
          data,
          lamports: 1000,
          executable: false,
        };
      } else if (sent === 1) {
        const data = Buffer.alloc(37 + elf.length);
        data.writeUInt32LE(1);
        data[4] = 1;
        keys.bufferAuthority.publicKey.toBuffer().copy(data, 5);
        accounts[1] = {
          owner: loader,
          data,
          lamports: 1000,
          executable: false,
        };
      } else {
        const d = tx.instructions[0].data;
        d.subarray(16).copy(accounts[1]!.data, 37 + d.readUInt32LE(4));
      }
      sent++;
      finalized = false;
      throw Error("Response lost after acceptance");
    },
  };
  const load = (r: string) => {
    reads++;
    return [...keys[r].secretKey];
  };
  let snapshotReads = 0;
  const snapshotRpc = {
    ...rpc,
    getMultipleAccountsInfoAndContext: (async (_addresses, config) => {
      assert.deepEqual(config, {
        commitment: "finalized",
        minContextSlot: 100,
      });
      snapshotReads++;
      if (snapshotReads === 1)
        throw Object.assign(Error("Minimum context slot not reached"), {
          code: -32016,
        });
      return {
        context: { slot: snapshotReads === 2 ? 99 : 100 },
        value: accounts,
      };
    }) as UploadRpc["getMultipleAccountsInfoAndContext"],
  };
  assert.equal((await readDeploymentSnapshot(snapshotRpc, p, 100)).slot, 100);
  assert.equal(snapshotReads, 3);
  snapshotReads = 0;
  await assert.rejects(
    readDeploymentSnapshot(
      {
        ...rpc,
        getMultipleAccountsInfoAndContext: async () => {
          snapshotReads++;
          return { context: { slot: 99 }, value: accounts };
        },
      },
      p,
      100,
    ),
    /stale after read retries/,
  );
  assert.equal(snapshotReads, 4);
  snapshotReads = 0;
  await assert.rejects(
    readDeploymentSnapshot(
      {
        ...rpc,
        getMultipleAccountsInfoAndContext: async () => {
          snapshotReads++;
          throw Error("transport");
        },
      },
      p,
      100,
    ),
    /transport/,
  );
  assert.equal(snapshotReads, 1);
  const advance = () =>
    advanceUpload(rpc, p, elf, plan, journal, uploadPlanDigest(plan), load);
  await assert.rejects(
    advanceUpload(rpc, p, elf, plan, journal, "wrong", load),
  );
  assert.equal(reads, 0);
  genesis = "wrong";
  await assert.rejects(advance());
  assert.equal(reads, 0);
  genesis = MAINNET_GENESIS;
  balance = 1;
  await assert.rejects(advance());
  assert.equal(reads, 0);
  balance = 100000;
  simFails = true;
  await assert.rejects(advance());
  assert.equal(records.size, 0);
  assert.equal(sent, 0);
  simFails = false;
  await assert.rejects(
    advanceUpload(rpc, p, elf, plan, journal, uploadPlanDigest(plan), () => [
      ...keys.admin.secretKey,
    ]),
    /Wrong role/,
  );
  await assert.rejects(
    advanceUpload(
      rpc,
      p,
      elf,
      plan,
      {
        ...journal,
        create() {
          throw Error("Disk unavailable");
        },
      },
      uploadPlanDigest(plan),
      load,
    ),
    /Disk unavailable/,
  );
  assert.equal(sent, 0);
  for (let step = 0; step < 4; step++) {
    assert.equal((await advance()).status, "UNKNOWN_DO_NOT_RESEND");
    assert.equal(sent, step + 1);
    assert.equal((await advance()).status, "PENDING_OR_UNKNOWN_DO_NOT_RESEND");
    assert.equal(sent, step + 1);
    finalized = true;
  }
  assert.equal((await advance()).status, "UPLOAD_FINALIZED_AND_VERIFIED");
  assert.equal(sent, 4);
  accounts[1]!.data[37] ^= 1;
  await assert.rejects(advance(), /bytes mismatch/);
  accounts[1]!.data[37] ^= 1;
  const saved = records.get(2)!;
  records.delete(2);
  await assert.rejects(advance(), /gap/);
  records.set(2, saved);
  records.set(2, { ...saved, planSha256: "wrong" });
  await assert.rejects(advance(), /Journal mismatch/);
  records.set(2, saved);
  assert.throws(
    () =>
      uploadTransaction(
        p,
        elf,
        { ...plan, maxTotalDebitLamports: 41999 },
        0,
        keys.admin.publicKey.toBase58(),
      ),
    /budget/,
  );
});
