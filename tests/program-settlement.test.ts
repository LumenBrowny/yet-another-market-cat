import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BorshAccountsCoder, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import { start, Clock } from "solana-bankrun";
import {
  AccountLayout,
  MintLayout,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  AuthorityType,
  createInitializeMint2Instruction,
  createMintToCheckedInstruction,
  createSetAuthorityInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import {
  IDL,
  PROGRAM_ID,
  configAddress,
  faucetVaultAddress,
  instruction,
  ensureAta,
  ownerAccounts,
} from "../packages/shared/src/client";
import {
  rewardsPda,
  rewardVaultPda,
  deriveCyclePda,
  deriveClaimReceiptPda,
  claimInstruction,
} from "../packages/shared/src/cycles";
import {
  allocateRewards,
  buildTree,
  emptyRoot,
  leafHash,
  nodeHash,
  unsigned,
} from "../packages/shared/src/settlement";

test(
  "SBF immutable cycles, finite reserve and atomic claims",
  { timeout: 240000 },
  async (t) => {
    const admin = Keypair.generate(),
      alice = Keypair.generate(),
      bob = Keypair.generate(),
      attacker = Keypair.generate(),
      mint = Keypair.generate();
    const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
    const programData = PublicKey.findProgramAddressSync(
      [PROGRAM_ID.toBuffer()],
      loader,
    )[0];
    const programBytes = Buffer.alloc(36);
    programBytes.writeUInt32LE(2);
    programData.toBuffer().copy(programBytes, 4);
    const elf = readFileSync("target/deploy/cat_shit_mining.so");
    const bytes = Buffer.alloc(45 + elf.length);
    bytes.writeUInt32LE(3);
    bytes[12] = 1;
    admin.publicKey.toBuffer().copy(bytes, 13);
    elf.copy(bytes, 45);
    const ctx = await start(
      [],
      [
        {
          address: PROGRAM_ID,
          info: {
            owner: loader,
            executable: true,
            lamports: 10_000_000,
            data: programBytes,
          },
        },
        {
          address: programData,
          info: {
            owner: loader,
            executable: false,
            lamports: 10_000_000_000,
            data: bytes,
          },
        },
      ],
    );
    const bank = ctx.banksClient;
    const coder = new BorshAccountsCoder(IDL);
    let nonce = 0;
    for (const k of [admin, alice, bob, attacker])
      ctx.setAccount(k.publicKey, {
        owner: SystemProgram.programId,
        executable: false,
        lamports: 10_000_000_000,
        data: Buffer.alloc(0),
      });
    const clock = async (time: bigint) => {
      const c = await bank.getClock();
      ctx.setClock(
        new Clock(
          c.slot,
          c.epochStartTimestamp,
          c.epoch,
          c.leaderScheduleEpoch,
          time,
        ),
      );
    };
    await clock(1000n);
    async function send(ixs: TransactionInstruction[], signers = [admin]) {
      const tx = new Transaction({
        feePayer: signers[0].publicKey,
        recentBlockhash: (await bank.getLatestBlockhash())![0],
      }).add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 500000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: ++nonce }),
        ...ixs,
      );
      tx.sign(...signers);
      return bank.tryProcessTransaction(tx);
    }
    async function ok(ixs: TransactionInstruction[], signers = [admin]) {
      const result = await send(ixs, signers);
      assert.equal(result.result, null, result.meta?.logMessages.join("\n"));
      return result;
    }
    async function fail(ixs: TransactionInstruction[], signers = [admin]) {
      const result = await send(ixs, signers);
      assert(result.result, "Expected instruction rejection");
    }
    const decode = async (name: string, key: PublicKey) =>
      coder.decode(name, Buffer.from((await bank.getAccount(key))!.data));
    const balance = async (key: PublicKey) =>
      AccountLayout.decode(Buffer.from((await bank.getAccount(key))!.data))
        .amount;
    const adminAta = ownerAccounts(admin.publicKey, mint.publicKey).ownerTokens;
    const supply = 100_000_000_000_000n,
      reserve = 99_000_000_000_000n,
      emission = reserve / 2n;
    await ok(
      [
        SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: mint.publicKey,
          space: MINT_SIZE,
          lamports: Number(
            (await bank.getRent()).minimumBalance(BigInt(MINT_SIZE)),
          ),
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(
          mint.publicKey,
          6,
          admin.publicKey,
          null,
        ),
        createAssociatedTokenAccountIdempotentInstruction(
          admin.publicKey,
          adminAta,
          admin.publicKey,
          mint.publicKey,
        ),
        createMintToCheckedInstruction(
          mint.publicKey,
          adminAta,
          admin.publicKey,
          supply,
          6,
        ),
        createSetAuthorityInstruction(
          mint.publicKey,
          admin.publicKey,
          AuthorityType.MintTokens,
          null,
        ),
      ],
      [admin, mint],
    );
    await ok([
      instruction("initializeConfig", {
        admin: admin.publicKey,
        program: PROGRAM_ID,
        programData,
        config: configAddress,
        tokenMint: mint.publicKey,
        adminTokens: adminAta,
        faucetVault: faucetVaultAddress,
      }),
    ]);
    const initKeys = {
      admin: admin.publicKey,
      config: configAddress,
      tokenMint: mint.publicKey,
      adminTokens: adminAta,
      rewards: rewardsPda,
      rewardVault: rewardVaultPda,
    };
    const initArgs = {
      genesis: new BN(1000),
      duration: new BN(100),
      emission: new BN(emission.toString()),
      publisher: admin.publicKey,
    };
    await t.test(
      "Reward bootstrap rejects unauthorized and invalid immutable config",
      async () => {
        await fail(
          [
            instruction(
              "initializeRewards",
              { ...initKeys, admin: attacker.publicKey },
              undefined,
              initArgs,
            ),
          ],
          [attacker],
        );
        await fail([
          instruction("initializeRewards", initKeys, undefined, {
            ...initArgs,
            duration: new BN(0),
          }),
        ]);
        await fail([
          instruction("initializeRewards", initKeys, undefined, {
            ...initArgs,
            emission: new BN((reserve + 1n).toString()),
          }),
        ]);
        await ok([
          instruction("initializeRewards", initKeys, undefined, initArgs),
        ]);
        await fail([
          instruction("initializeRewards", initKeys, undefined, initArgs),
        ]);
        assert.equal(await balance(rewardVaultPda), reserve);
        assert.equal(await balance(faucetVaultAddress), 1_000_000_000_000n);
        const m = MintLayout.decode(
          Buffer.from((await bank.getAccount(mint.publicKey))!.data),
        );
        assert.equal(m.mintAuthorityOption, 0);
        assert.equal(m.freezeAuthorityOption, 0);
        assert.equal(m.supply, supply);
      },
    );
    for (const owner of [alice, bob, attacker])
      await ok([ensureAta(owner.publicKey, mint.publicKey)], [owner]);
    const miners = allocateRewards(
      [
        { wallet: alice.publicKey.toBase58(), pointUnits: "300000" },
        { wallet: bob.publicKey.toBase58(), pointUnits: "200000" },
      ],
      emission,
    );
    const tree = buildTree("0", miners);
    const deepProof = Array.from({ length: 16 }, (_, i) => ({
      hash: (i + 1).toString(16).padStart(2, "0").repeat(32),
      left: i % 2 === 1,
    }));
    const deepLeaf = leafHash("1", {
      wallet: alice.publicKey.toBase58(),
      pointUnits: "500000",
      rewardBaseUnits: emission.toString(),
    });
    const deepRoot = deepProof.reduce(
      (h, p) => (p.left ? nodeHash(p.hash, h) : nodeHash(h, p.hash)),
      deepLeaf,
    );
    const hash = Array(32).fill(7);
    const pubArgs = (id: bigint, overrides = {}) => ({
      cycleId: new BN(id.toString()),
      root: [...Buffer.from(tree.root, "hex")],
      manifestHash: hash,
      totalPoints: [...unsigned(500000n, 32, true)],
      totalAllocated: new BN(emission.toString()),
      leafCount: 2,
      ...overrides,
    });
    const publish = (
      id: bigint,
      args = pubArgs(id),
      publisher = admin.publicKey,
    ) =>
      instruction(
        "publishCycle",
        {
          publisher,
          rewards: rewardsPda,
          rewardVault: rewardVaultPda,
          cycle: deriveCyclePda(id),
        },
        undefined,
        args,
      );
    await t.test(
      "Publish rejects active, unauthorized, nonsequential and overflow cycles",
      async () => {
        await fail([publish(0n)]);
        await clock(1400n);
        await fail([publish(0n, pubArgs(0n), attacker.publicKey)], [attacker]);
        await fail([publish(1n)]);
        await fail([publish((1n << 64n) - 1n)]);
        await fail([
          publish(
            0n,
            pubArgs(0n, { totalAllocated: new BN((emission + 1n).toString()) }),
          ),
        ]);
        await fail([publish(0n, pubArgs(0n, { leafCount: 0 }))]);
        await fail([
          publish(0n, pubArgs(0n, { manifestHash: Array(32).fill(0) })),
        ]);
        await fail([publish(0n, pubArgs(0n, { leafCount: 65537 }))]);
      },
    );
    await t.test("Immutable root and cumulative reserve solvency", async () => {
      await ok([publish(0n)]);
      const original = await decode("shitCycle", deriveCyclePda(0n));
      await fail([publish(0n, pubArgs(0n, { root: Array(32).fill(9) }))]);
      assert.deepEqual(
        (await decode("shitCycle", deriveCyclePda(0n))).root,
        original.root,
      );
      await ok([
        publish(
          1n,
          pubArgs(1n, {
            root: [...Buffer.from(deepRoot, "hex")],
            leafCount: 65536,
          }),
        ),
      ]);
      assert.equal(
        (
          await decode("rewardConfig", rewardsPda)
        ).committedUnclaimed.toString(),
        reserve.toString(),
      );
      await fail([publish(2n)]);
      await ok([
        publish(
          2n,
          pubArgs(2n, {
            root: [...Buffer.from(emptyRoot, "hex")],
            totalPoints: Array(32).fill(0),
            totalAllocated: new BN(0),
            leafCount: 0,
          }),
        ),
      ]);
    });
    const rewardA = miners.find(
      (m) => m.wallet === alice.publicKey.toBase58(),
    )!;
    const proofA = tree.proofs[rewardA.wallet];
    const claimA = () =>
      claimInstruction(
        alice.publicKey,
        mint.publicKey,
        0n,
        BigInt(rewardA.pointUnits),
        BigInt(rewardA.rewardBaseUnits),
        proofA,
      );
    await t.test(
      "Claims reject tampered points/reward/proof, wrong wallet/cycle and zero reward",
      async () => {
        await fail(
          [
            claimInstruction(
              alice.publicKey,
              mint.publicKey,
              0n,
              1n,
              BigInt(rewardA.rewardBaseUnits),
              proofA,
            ),
          ],
          [alice],
        );
        await fail(
          [
            claimInstruction(
              alice.publicKey,
              mint.publicKey,
              0n,
              BigInt(rewardA.pointUnits),
              1n,
              proofA,
            ),
          ],
          [alice],
        );
        await fail(
          [
            claimInstruction(
              alice.publicKey,
              mint.publicKey,
              0n,
              BigInt(rewardA.pointUnits),
              0n,
              proofA,
            ),
          ],
          [alice],
        );
        await fail(
          [
            claimInstruction(
              alice.publicKey,
              mint.publicKey,
              0n,
              BigInt(rewardA.pointUnits),
              BigInt(rewardA.rewardBaseUnits),
              [{ ...proofA[0], hash: "ff".repeat(32) }],
            ),
          ],
          [alice],
        );
        await fail(
          [
            claimInstruction(
              alice.publicKey,
              mint.publicKey,
              0n,
              BigInt(rewardA.pointUnits),
              BigInt(rewardA.rewardBaseUnits),
              [{ ...proofA[0], left: !proofA[0].left }],
            ),
          ],
          [alice],
        );
        await fail(
          [
            claimInstruction(
              bob.publicKey,
              mint.publicKey,
              0n,
              BigInt(rewardA.pointUnits),
              BigInt(rewardA.rewardBaseUnits),
              proofA,
            ),
          ],
          [bob],
        );
        for (const id of [1n, 2n, 99n])
          await fail(
            [
              claimInstruction(
                alice.publicKey,
                mint.publicKey,
                id,
                BigInt(rewardA.pointUnits),
                BigInt(rewardA.rewardBaseUnits),
                proofA,
              ),
            ],
            [alice],
          );
        assert.equal(
          await bank.getAccount(deriveClaimReceiptPda(0n, alice.publicKey)),
          null,
        );
      },
    );
    await t.test(
      "Claims reject account substitution and missing owner signature",
      async () => {
        for (const [expected, replacement] of [
          [rewardVaultPda, faucetVaultAddress],
          [mint.publicKey, adminAta],
          [
            ownerAccounts(alice.publicKey, mint.publicKey).ownerTokens,
            adminAta,
          ],
        ]) {
          const ix = claimA();
          ix.keys = ix.keys.map((k) =>
            k.pubkey.equals(expected) ? { ...k, pubkey: replacement } : k,
          );
          await fail([ix], [alice]);
        }
        const noSignature = claimA();
        noSignature.keys = noSignature.keys.map((k) =>
          k.pubkey.equals(alice.publicKey) ? { ...k, isSigner: false } : k,
        );
        await fail([noSignature], [attacker]);
      },
    );
    await t.test(
      "Failed SPL transfer rolls back receipt and obligation counters",
      async () => {
        const ata = ownerAccounts(alice.publicKey, mint.publicKey).ownerTokens;
        const account = (await bank.getAccount(ata))!;
        const data = Buffer.from(account.data);
        data[108] = 2;
        ctx.setAccount(ata, { ...account, data });
        await fail([claimA()], [alice]);
        assert.equal(
          await bank.getAccount(deriveClaimReceiptPda(0n, alice.publicKey)),
          null,
        );
        assert.equal(
          (
            await decode("shitCycle", deriveCyclePda(0n))
          ).claimedAmount.toString(),
          "0",
        );
        assert.equal(
          (
            await decode("rewardConfig", rewardsPda)
          ).committedUnclaimed.toString(),
          reserve.toString(),
        );
        ctx.setAccount(ata, account);
      },
    );
    await t.test(
      "Valid claim moves exact finite tokens; double claim cannot pay again",
      async () => {
        const before = await balance(rewardVaultPda);
        const reward = BigInt(rewardA.rewardBaseUnits);
        const result = await ok([claimA()], [alice]);
        console.log(
          "claim compute",
          result.meta?.computeUnitsConsumed.toString(),
        );
        assert.equal(await balance(rewardVaultPda), before - reward);
        assert.equal(
          await balance(
            ownerAccounts(alice.publicKey, mint.publicKey).ownerTokens,
          ),
          reward,
        );
        assert.equal(
          (
            await decode("rewardConfig", rewardsPda)
          ).committedUnclaimed.toString(),
          (reserve - reward).toString(),
        );
        await fail([claimA()], [alice]);
        assert.equal(await balance(rewardVaultPda), before - reward);
        const receipt = await decode(
          "claimReceipt",
          deriveClaimReceiptPda(0n, alice.publicKey),
        );
        assert.equal(receipt.rewardAmount.toString(), reward.toString());
      },
    );
    await t.test(
      "Independent second claimant preserves fixed supply and remaining obligations",
      async () => {
        const b = miners.find((m) => m.wallet === bob.publicKey.toBase58())!;
        await ok(
          [
            claimInstruction(
              bob.publicKey,
              mint.publicKey,
              0n,
              BigInt(b.pointUnits),
              BigInt(b.rewardBaseUnits),
              tree.proofs[b.wallet],
            ),
          ],
          [bob],
        );
        assert.equal(await balance(rewardVaultPda), reserve - emission);
        assert.equal(
          (
            await decode("rewardConfig", rewardsPda)
          ).committedUnclaimed.toString(),
          emission.toString(),
        );
        const m = MintLayout.decode(
          Buffer.from((await bank.getAccount(mint.publicKey))!.data),
        );
        assert.equal(m.supply, supply);
        assert.equal(m.mintAuthorityOption, 0);
        assert.equal(m.freezeAuthorityOption, 0);
        await fail([publish(3n)]); // Claimed funds did not magically replenish available inventory.
        assert(
          !IDL.instructions.some((i) =>
            /close.*receipt|sweep|replace.*cycle|update.*root/i.test(i.name),
          ),
        );
      },
    );
    await t.test(
      "Maximum-depth proof executes within the default compute budget",
      async () => {
        const result = await ok(
          [
            claimInstruction(
              alice.publicKey,
              mint.publicKey,
              1n,
              500000n,
              emission,
              deepProof,
            ),
          ],
          [alice],
        );
        assert(result.meta!.computeUnitsConsumed < 200000n);
        console.log(
          "Maximum-depth claim compute",
          result.meta!.computeUnitsConsumed.toString(),
        );
        assert.equal(await balance(rewardVaultPda), 0n);
        assert.equal(
          (
            await decode("rewardConfig", rewardsPda)
          ).committedUnclaimed.toString(),
          "0",
        );
      },
    );
  },
);
