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
import {
  prepareReview,
  checkReturnedSignatures,
  type ReviewRpc,
} from "../tools/offline-mainnet/online-review";
import { signRequest, pinsDigest } from "../tools/offline-mainnet/signing";
import { cosignReviewed } from "../tools/offline-mainnet/cosign";
import {
  submitOnce,
  reconcileAttempt,
  type Attempt,
  type SubmitRpc,
} from "../tools/offline-mainnet/submission";
for (const operation of ["accept-buffer", "deploy"] as const)
  test(`online/offline ${operation} round trip with fresh-state and budget gates`, async () => {
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
    const elf = Buffer.from("TEST ONLY ELF");
    const p = {
      schema: "yamc-mainnet-deployment-pins-v1",
      genesis: MAINNET_GENESIS,
      ...Object.fromEntries(
        Object.entries(keys).map(([k, v]) => [k, v.publicKey.toBase58()]),
      ),
      binarySize: elf.length,
      binarySha256: digest(elf),
      programRentLamports: 1000,
    } as DeploymentPins;
    const nonce = Buffer.alloc(80);
    nonce.writeUInt32LE(1);
    nonce.writeUInt32LE(1, 4);
    keys.admin.publicKey.toBuffer().copy(nonce, 8);
    Keypair.generate().publicKey.toBuffer().copy(nonce, 40);
    const buffer = Buffer.alloc(37 + elf.length);
    buffer.writeUInt32LE(1);
    buffer[4] = 1;
    keys[operation === "deploy" ? "admin" : "bufferAuthority"].publicKey
      .toBuffer()
      .copy(buffer, 5);
    elf.copy(buffer, 37);
    let slot = 100,
      fee: number | null = 15000,
      balance = 1000000,
      genesis = MAINNET_GENESIS,
      rent = 1000;
    const rpc: ReviewRpc = {
      getGenesisHash: async () => genesis,
      getMultipleAccountsInfoAndContext: async () => ({
        context: { slot },
        value: [
          {
            owner: SystemProgram.programId,
            executable: false,
            lamports: 1000,
            data: nonce,
          },
          {
            owner: new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
            executable: false,
            lamports: 1000,
            data: buffer,
          },
          null,
          null,
        ],
      }),
      getMinimumBalanceForRentExemption: async () => rent,
      getFeeForMessage: async () => ({ context: { slot }, value: fee }),
      getBalanceAndContext: async () => ({ context: { slot }, value: balance }),
    };
    const limits = {
      maxFeeLamports: 20000,
      maxPayerDebitLamports: 21000,
      payerReserveLamports: 5000,
    };
    const prepared = await prepareReview(rpc, p, elf, operation, limits);
    await assert.rejects(
      prepareReview(
        {
          ...rpc,
          getFeeForMessage: async () => ({
            context: { slot: 99 },
            value: 15000,
          }),
        },
        p,
        elf,
        operation,
        limits,
      ),
      /stale/,
    );
    await assert.rejects(
      prepareReview(
        {
          ...rpc,
          getBalanceAndContext: async () => ({
            context: { slot: 99 },
            value: 1000000,
          }),
        },
        p,
        elf,
        operation,
        limits,
      ),
      /stale/,
    );
    if (operation === "deploy") {
      // Excess buffer rent cannot pay the earlier Program create instruction.
      const extraBufferRpc: ReviewRpc = {
        ...rpc,
        getMultipleAccountsInfoAndContext: async (...args) => {
          const state = await rpc.getMultipleAccountsInfoAndContext(...args);
          state.value[1]!.lamports = 100000;
          return state;
        },
      };
      assert.equal(
        (await prepareReview(extraBufferRpc, p, elf, operation, limits))
          .payerDebitLamports,
        16000,
      );
    }
    const roles =
      operation === "deploy"
        ? (["admin", "program"] as const)
        : (["admin"] as const);
    const results = roles.map((role) =>
      signRequest(
        p,
        prepared.request,
        elf,
        role,
        [...keys[role].secretKey],
        prepared.request.messageSha256,
        pinsDigest(p),
      ),
    );
    const checked = await checkReturnedSignatures(
      rpc,
      p,
      elf,
      prepared,
      results,
      limits,
    );
    assert.equal(checked.broadcastAuthorization, false);
    const tx = Transaction.from(
      Buffer.from(checked.partialTransactionBase64, "base64"),
    );
    tx.partialSign(
      keys.payer,
      ...(operation === "accept-buffer" ? [keys.bufferAuthority] : []),
    );
    assert(tx.verifySignatures());
    const approvalForSigning = {
      messageSha256: prepared.request.messageSha256,
      pinsSha256: pinsDigest(p),
    };
    const loaded: string[] = [];
    const signed = await cosignReviewed(
      rpc,
      p,
      elf,
      prepared,
      results,
      limits,
      approvalForSigning,
      (role) => {
        loaded.push(role);
        return [...keys[role].secretKey];
      },
    );
    assert(signed.equals(tx.serialize()));
    assert.deepEqual(
      loaded,
      operation === "deploy" ? ["payer"] : ["payer", "bufferAuthority"],
    );
    let forbiddenReads = 0;
    const forbidden = () => {
      forbiddenReads++;
      throw Error("Must not load key");
    };
    await assert.rejects(
      cosignReviewed(
        rpc,
        p,
        elf,
        prepared,
        results,
        limits,
        { ...approvalForSigning, messageSha256: "wrong" },
        forbidden,
      ),
    );
    await assert.rejects(
      cosignReviewed(
        rpc,
        p,
        elf,
        prepared,
        [],
        limits,
        approvalForSigning,
        forbidden,
      ),
    );
    assert.equal(forbiddenReads, 0);
    await assert.rejects(
      cosignReviewed(
        rpc,
        p,
        elf,
        prepared,
        results,
        limits,
        approvalForSigning,
        () => [...keys.admin.secretKey],
      ),
      /Wrong online role/,
    );
    await assert.rejects(
      cosignReviewed(
        rpc,
        p,
        elf,
        prepared,
        results,
        limits,
        approvalForSigning,
        () => Array(64).fill(256),
      ),
      /Invalid key/,
    );
    await assert.rejects(
      checkReturnedSignatures(rpc, p, elf, prepared, [], limits),
    );
    await assert.rejects(
      checkReturnedSignatures(
        rpc,
        p,
        elf,
        prepared,
        [...results, results[0]],
        limits,
      ),
    );
    await assert.rejects(
      checkReturnedSignatures(
        rpc,
        p,
        elf,
        prepared,
        [
          {
            ...results[0],
            signatureBase64: Buffer.alloc(64).toString("base64"),
          },
          ...results.slice(1),
        ],
        limits,
      ),
    );
    nonce[40] ^= 1;
    await assert.rejects(
      checkReturnedSignatures(rpc, p, elf, prepared, results, limits),
      /State changed/,
    );
    nonce[40] ^= 1;
    buffer[37] ^= 1;
    await assert.rejects(
      checkReturnedSignatures(rpc, p, elf, prepared, results, limits),
      /ELF/,
    );
    buffer[37] ^= 1;
    slot = 99;
    await assert.rejects(
      checkReturnedSignatures(rpc, p, elf, prepared, results, limits),
      /older/,
    );
    slot = 101;
    fee = null;
    await assert.rejects(prepareReview(rpc, p, elf, operation, limits));
    fee = 25000;
    await assert.rejects(prepareReview(rpc, p, elf, operation, limits));
    fee = 15000;
    balance = 100;
    await assert.rejects(prepareReview(rpc, p, elf, operation, limits));
    balance = 1000000;
    rent = 1001;
    await assert.rejects(prepareReview(rpc, p, elf, operation, limits), /Rent/);
    rent = 1000;
    genesis = "wrong";
    await assert.rejects(
      prepareReview(rpc, p, elf, operation, limits),
      /network/,
    );
    genesis = MAINNET_GENESIS;
    await assert.rejects(
      prepareReview(rpc, p, elf, operation, {
        ...limits,
        maxPayerDebitLamports: 1,
      }),
    );
    assert.equal(
      (await checkReturnedSignatures(rpc, p, elf, prepared, results, limits))
        .freshReview.observedSlot,
      101,
    );
    let attempt: Attempt | undefined,
      sends = 0,
      simulations = 0;
    const store = {
      create(a: Attempt) {
        if (attempt) throw Error("Existing attempt");
        attempt = a;
      },
      read() {
        assert(attempt);
        return attempt;
      },
    };
    const transport: SubmitRpc = {
      ...rpc,
      simulateTransaction: (async (_tx: unknown, config: unknown) => {
        assert.deepEqual(config, {
          sigVerify: true,
          replaceRecentBlockhash: false,
          commitment: "finalized",
          minContextSlot: 101,
        });
        simulations++;
        return { context: { slot: 101 }, value: { err: null, logs: [] } };
      }) as SubmitRpc["simulateTransaction"],
      sendRawTransaction: async (_raw, options) => {
        assert(attempt, "journal must exist BEFORE send");
        assert.equal(options?.maxRetries, 0);
        sends++;
        throw Error("Timeout after possible acceptance");
      },
      getSignatureStatuses: async () => ({
        context: { slot: 101 },
        value: [null],
      }),
    };
    const approval = {
      messageSha256: prepared.request.messageSha256,
      pinsSha256: pinsDigest(p),
    };
    const raw = tx.serialize();
    await assert.rejects(
      submitOnce(transport, p, elf, prepared, raw, limits, store, {
        ...approval,
        messageSha256: "wrong",
      }),
    );
    assert.equal(simulations, 0);
    const badSim = {
      ...transport,
      simulateTransaction: (async () => ({
        context: { slot: 101 },
        value: { err: { InstructionError: [0, "InvalidArgument"] }, logs: [] },
      })) as SubmitRpc["simulateTransaction"],
    };
    await assert.rejects(
      submitOnce(badSim, p, elf, prepared, raw, limits, store, approval),
      /simulation/,
    );
    assert.equal(attempt, undefined);
    assert.equal(sends, 0);
    assert.equal(
      (
        await submitOnce(
          transport,
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
      submitOnce(transport, p, elf, prepared, raw, limits, store, approval),
      /Existing attempt/,
    );
    assert.equal(sends, 1);
    assert.equal(
      (await reconcileAttempt(transport, p, elf, prepared, raw, store)).status,
      "PENDING_OR_UNKNOWN_DO_NOT_RESEND",
    );
    assert.equal(sends, 1);
    const failed = {
      ...transport,
      getSignatureStatuses: async () => ({
        context: { slot: 101 },
        value: [
          {
            slot: 101,
            confirmations: null,
            confirmationStatus: "finalized" as const,
            err: {
              InstructionError: [0, "InvalidArgument"] as [number, string],
            },
          },
        ],
      }),
    };
    assert.equal(
      (await reconcileAttempt(failed, p, elf, prepared, raw, store)).status,
      "FINALIZED_FAILURE_REVIEW_NONCE",
    );
    assert.equal(sends, 1);
  });
