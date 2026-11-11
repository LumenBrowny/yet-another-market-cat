import { admissionInstruction } from "../packages/shared/src/admission";
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
  createTransferCheckedInstruction,
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
  claimInstruction,
} from "../packages/shared/src/cycles";
import {
  emptyRoot,
  leafHash,
  unsigned,
} from "../packages/shared/src/settlement";

test(
  "SBF gated launch, 396 funded days, terminal cutoff and independent exits",
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
    async function fail(
      ixs: TransactionInstruction[],
      signers = [admin],
      error?: string,
    ) {
      const result = await send(ixs, signers);
      assert(result.result, "Expected instruction rejection");
      if (error)
        assert(
          result.meta?.logMessages.join("\n").includes(error),
          result.meta?.logMessages.join("\n"),
        );
    }
    const decode = async (name: string, key: PublicKey) =>
      coder.decode(name, Buffer.from((await bank.getAccount(key))!.data));
    const balance = async (key: PublicKey) =>
      AccountLayout.decode(Buffer.from((await bank.getAccount(key))!.data))
        .amount;
    const adminAta = ownerAccounts(admin.publicKey, mint.publicKey).ownerTokens;
    const supply = 100_000_000_000_000n,
      reserve = 99_000_000_000_000n,
      emission = 250_000_000_000n;
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
      instruction("initializeLaunchConfig", {
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
      genesis: new BN(0),
      duration: new BN(86400),
      emission: new BN(emission.toString()),
      publisher: admin.publicKey,
    };

    for (const overrides of [
      { genesis: new BN(1) },
      { duration: new BN(3600) },
      { emission: new BN("100000000000") },
    ])
      await fail([
        instruction("initializeRewards", initKeys, undefined, {
          ...initArgs,
          ...overrides,
        }),
      ]);
    await ok([instruction("initializeRewards", initKeys, undefined, initArgs)]);
    const aliceKeys = ownerAccounts(alice.publicKey, mint.publicKey);
    await ok(
      [
        ensureAta(alice.publicKey, mint.publicKey),
        instruction("createPosition", aliceKeys),
      ],
      [alice],
    );
    await fail(
      [instruction("claimFaucet", aliceKeys)],
      [alice],
      "AdmissionRequired",
    );
    await fail(
      [instruction("deposit", aliceKeys, 1_000_000_000n)],
      [alice],
      "NotActivated",
    );
    const activation = (who = admin.publicKey) =>
      instruction(
        "activateRewards",
        {
          admin: who,
          config: configAddress,
          rewards: rewardsPda,
          rewardVault: rewardVaultPda,
        },
        undefined,
        {
          faucetOpensAt: new BN(2000),
          waveTwoAt: new BN(2010),
          miningStartsAt: new BN(2020),
          issuer: admin.publicKey,
        },
      );
    await fail([activation(attacker.publicKey)], [attacker]);
    const publish = (id: bigint, empty = false) =>
      instruction(
        "publishCycle",
        {
          publisher: admin.publicKey,
          config: configAddress,
          rewards: rewardsPda,
          rewardVault: rewardVaultPda,
          cycle: deriveCyclePda(id),
        },
        undefined,
        {
          cycleId: new BN(id.toString()),
          root: [
            ...Buffer.from(
              empty
                ? emptyRoot
                : leafHash(id.toString(), {
                    wallet: alice.publicKey.toBase58(),
                    pointUnits: "86400000",
                    rewardBaseUnits: emission.toString(),
                  }),
              "hex",
            ),
          ],
          manifestHash: Array(32).fill(7),
          totalPoints: empty
            ? Array(32).fill(0)
            : [...unsigned(86400000n, 32, true)],
          totalAllocated: new BN(empty ? "0" : emission.toString()),
          leafCount: empty ? 0 : 1,
        },
      );
    await fail([publish(0n, true)], [admin], "NotActivated");
    await clock(1900n);
    await ok([activation()]);
    assert.equal(
      (await decode("rewardConfig", rewardsPda)).genesis.toString(),
      "2020",
    );
    await fail([activation()], [admin], "AlreadyActivated");
    const sgt = Keypair.generate().publicKey;
    const grant = (
      owner: PublicKey,
      wave: 1 | 2,
      subject: PublicKey,
      expiry = 2200,
    ) =>
      admissionInstruction(
        owner,
        mint.publicKey,
        admin.publicKey,
        wave,
        subject,
        expiry,
      );
    await fail(
      [grant(alice.publicKey, 1, sgt)],
      [alice, admin],
      "NotActivated",
    );
    await clock(2000n);
    const unsignedGrant = grant(alice.publicKey, 1, sgt);
    unsignedGrant.keys.find((k) => k.pubkey.equals(admin.publicKey))!.isSigner =
      false;
    await fail([unsignedGrant], [alice], "AccountNotSigner");
    await fail(
      [
        admissionInstruction(
          alice.publicKey,
          mint.publicKey,
          attacker.publicKey,
          1,
          sgt,
          2200,
        ),
      ],
      [alice, attacker],
      "ConstraintAddress",
    );

    await fail(
      [grant(alice.publicKey, 2, alice.publicKey)],
      [alice, admin],
      "InvalidAdmission",
    );
    await fail(
      [grant(alice.publicKey, 1, sgt, 2000)],
      [alice, admin],
      "InvalidAdmission",
    );
    await fail(
      [grant(alice.publicKey, 1, sgt, 2301)],
      [alice, admin],
      "InvalidAdmission",
    );
    await ok([grant(alice.publicKey, 1, sgt)], [alice, admin]);
    await ok([ensureAta(bob.publicKey, mint.publicKey)], [bob]);
    await fail([grant(bob.publicKey, 1, sgt)], [bob, admin]);
    await ok([instruction("deposit", aliceKeys, 1_000_000_000n)], [alice]);
    await fail([publish(0n)], [admin], "NotActivated");
    await clock(2010n);
    await fail(
      [grant(bob.publicKey, 1, Keypair.generate().publicKey)],
      [bob, admin],
      "InvalidAdmission",
    );
    await fail([grant(alice.publicKey, 2, alice.publicKey)], [alice, admin]);
    assert.equal(await balance(aliceKeys.ownerTokens), 0n); // pre-locked before mining genesis
    await fail([instruction("claimFaucet", aliceKeys)], [alice]);
    await t.test(
      "issuer rotation requires admin and incoming signatures; invalidates outstanding grants",
      async () => {
        const next = Keypair.generate();
        const rotate = (
          authority = admin.publicKey,
          replacement = next.publicKey,
        ) =>
          instruction("rotateFaucetIssuer", {
            admin: authority,
            newIssuer: replacement,
            config: configAddress,
          });
        const before = await decode("config", configAddress);
        const outstanding = grant(bob.publicKey, 2, bob.publicKey);
        await fail(
          [rotate(attacker.publicKey)],
          [attacker, next],
          "ConstraintHasOne",
        );
        const noIncoming = rotate();
        noIncoming.keys.find((k) => k.pubkey.equals(next.publicKey))!.isSigner =
          false;
        await fail([noIncoming], [admin], "AccountNotSigner");
        const noAdmin = rotate();
        noAdmin.keys.find((k) => k.pubkey.equals(admin.publicKey))!.isSigner =
          false;
        await fail([noAdmin], [attacker, next], "AccountNotSigner");
        await fail(
          [rotate(admin.publicKey, admin.publicKey)],
          [admin],
          "InvalidReplacement",
        );
        await ok([rotate()], [admin, next]);
        const after = await decode("config", configAddress);
        assert(after.faucetIssuer.equals(next.publicKey));
        assert.deepEqual(
          { ...after, faucetIssuer: before.faucetIssuer },
          before,
        );
        await fail([outstanding], [bob, admin], "ConstraintAddress");
        // Existing wallet/subject receipt cannot be bypassed by changing issuer.
        await fail(
          [
            admissionInstruction(
              alice.publicKey,
              mint.publicKey,
              next.publicKey,
              2,
              alice.publicKey,
              2200,
            ),
          ],
          [alice, next],
        );
        await ok(
          [
            admissionInstruction(
              bob.publicKey,
              mint.publicKey,
              next.publicKey,
              2,
              bob.publicKey,
              2200,
            ),
          ],
          [bob, next],
        );
        await ok([rotate(admin.publicKey, admin.publicKey)], [admin]);
        await fail([grant(bob.publicKey, 2, bob.publicKey)], [bob, admin]);
      },
    );
    await t.test(
      "1000 launch grants exhaust the inventory; no wallet 1001",
      async () => {
        for (let i = 2; i < 1000; i++) {
          const recipient = Keypair.generate();
          ctx.setAccount(recipient.publicKey, {
            owner: SystemProgram.programId,
            executable: false,
            lamports: 100_000_000,
            data: Buffer.alloc(0),
          });
          await ok(
            [
              ensureAta(recipient.publicKey, mint.publicKey),
              grant(recipient.publicKey, 2, recipient.publicKey),
            ],
            [recipient, admin],
          );
        }
        assert.equal(await balance(faucetVaultAddress), 0n);
        await ok([ensureAta(bob.publicKey, mint.publicKey)], [bob]);
        await fail(
          [
            ensureAta(attacker.publicKey, mint.publicKey),
            grant(attacker.publicKey, 2, attacker.publicKey),
          ],
          [attacker, admin],
          "FaucetExhausted",
        );
      },
    );
    await clock(2020n);
    await fail([publish(0n)], [admin], "CycleOpen");
    await clock(88420n);
    await ok([publish(0n, true)]);
    assert.equal(
      (await decode("config", configAddress)).totalAllocated.toString(),
      "0",
    );
    await t.test(
      "publisher rotation preserves schedule and prior cycles; old signer is rejected",
      async () => {
        const next = Keypair.generate();
        ctx.setAccount(next.publicKey, {
          owner: SystemProgram.programId,
          executable: false,
          lamports: 1000000000,
          data: Buffer.alloc(0),
        });
        const rotate = (
          authority = admin.publicKey,
          replacement = next.publicKey,
        ) =>
          instruction("rotatePublisher", {
            admin: authority,
            newPublisher: replacement,
            config: configAddress,
            rewards: rewardsPda,
          });
        const before = await decode("rewardConfig", rewardsPda);
        const configBefore = await decode("config", configAddress);
        const prior = await bank.getAccount(deriveCyclePda(0n));
        await fail(
          [rotate(attacker.publicKey)],
          [attacker, next],
          "ConstraintHasOne",
        );
        const unsigned = rotate();
        unsigned.keys.find((k) => k.pubkey.equals(next.publicKey))!.isSigner =
          false;
        await fail([unsigned], [admin], "AccountNotSigner");
        const unsignedAdmin = rotate();
        unsignedAdmin.keys.find((k) =>
          k.pubkey.equals(admin.publicKey),
        )!.isSigner = false;
        await fail([unsignedAdmin], [attacker, next], "AccountNotSigner");
        await fail(
          [rotate(admin.publicKey, admin.publicKey)],
          [admin],
          "InvalidReplacement",
        );
        await ok([rotate()], [admin, next]);
        const after = await decode("rewardConfig", rewardsPda);
        assert(after.publisher.equals(next.publicKey));
        assert.deepEqual({ ...after, publisher: before.publisher }, before);
        assert.deepEqual(await decode("config", configAddress), configBefore);
        assert.deepEqual(
          (await bank.getAccount(deriveCyclePda(0n)))!.data,
          prior!.data,
        );
        await clock(2020n + 2n * 86400n + 17n);
        await fail([publish(1n)], [admin], "ConstraintHasOne");
        const nextPublish = publish(1n);
        nextPublish.keys.find((k) => k.pubkey.equals(admin.publicKey))!.pubkey =
          next.publicKey;
        await ok([nextPublish], [next]);
        await ok([rotate(admin.publicKey, admin.publicKey)], [admin]);
        // The late claim below is for cycle 1, published by the now-retired key.
      },
    );
    await t.test(
      "empty cycle preserves reserve; all 396 daily allocations commit",
      async () => {
        for (let id = 2n; id <= 396n; id++) {
          await clock(2020n + (id + 1n) * 86400n + 17n);
          await ok([publish(id)]);
        }
      },
    );
    const cutoff = 2020n + 397n * 86400n;
    const cfg = await decode("config", configAddress);
    assert.equal(cfg.ppCutoff.toString(), cutoff.toString());
    assert.equal(cfg.totalAllocated.toString(), reserve.toString());
    assert.equal(await balance(rewardVaultPda), reserve); // unclaimed obligations, not spendable emission
    await clock(cutoff + 90000n);
    await fail([publish(397n, true)], [admin], "DistributionComplete");
    await fail(
      [instruction("deposit", aliceKeys, 1n)],
      [alice],
      "DistributionComplete",
    );
    await ok([ensureAta(bob.publicKey, mint.publicKey)], [bob]);
    await fail(
      [
        ensureAta(attacker.publicKey, mint.publicKey),
        grant(
          attacker.publicKey,
          2,
          attacker.publicKey,
          Number(cutoff + 90100n),
        ),
      ],
      [attacker, admin],
      "DistributionComplete",
    );
    await ok(
      [
        claimInstruction(
          alice.publicKey,
          mint.publicKey,
          1n,
          86400000n,
          emission,
          [],
        ),
      ],
      [alice],
    );
    await fail(
      [
        claimInstruction(
          alice.publicKey,
          mint.publicKey,
          1n,
          86400000n,
          emission,
          [],
        ),
      ],
      [alice],
    );
    await ok(
      [
        createTransferCheckedInstruction(
          aliceKeys.ownerTokens,
          mint.publicKey,
          rewardVaultPda,
          alice.publicKey,
          1n,
          6,
        ),
      ],
      [alice],
    );
    await fail([publish(397n)], [admin], "DistributionComplete");
    await ok(
      [instruction("requestWithdraw", aliceKeys, 1_000_000_000n)],
      [alice],
    );
    await fail(
      [instruction("executeWithdraw", aliceKeys)],
      [alice],
      "Cooldown",
    );
    await clock(cutoff + 180000n);
    await ok([instruction("executeWithdraw", aliceKeys)], [alice]);
    assert.equal(
      await balance(aliceKeys.ownerTokens),
      emission - 1n + 1_000_000_000n,
    );
    assert.equal(
      (await decode("config", configAddress)).ppCutoff.toString(),
      cutoff.toString(),
    );
    assert.equal(
      (await decode("rewardConfig", rewardsPda)).committedUnclaimed.toString(),
      (reserve - emission).toString(),
    );
  },
);
