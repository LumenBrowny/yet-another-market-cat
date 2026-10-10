import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
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
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  AuthorityType,
  createInitializeMint2Instruction,
  createMintToCheckedInstruction,
  createSetAuthorityInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import {
  CATSHIT_DECIMALS,
  FAUCET_GLOBAL_CAP,
  FAUCET_AMOUNT_PER_WALLET,
  MIN_LOCK,
  UNLOCK_COOLDOWN,
  getMiningTier,
} from "@yac/shared";
import {
  IDL,
  PROGRAM_ID,
  configAddress,
  faucetVaultAddress,
  pda,
  instruction,
  ownerAccounts,
  ensureAta,
} from "@yac/shared/src/client";

test(
  "SBF custody, ownership, faucet and withdrawal lifecycle",
  { timeout: 240_000 },
  async (t) => {
    const admin = Keypair.generate(),
      owner = Keypair.generate(),
      attacker = Keypair.generate();
    const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
    const programData = PublicKey.findProgramAddressSync(
      [PROGRAM_ID.toBuffer()],
      loader,
    )[0];
    // Reproduce upgradeable-loader deployment metadata, with this test's trusted admin.
    const programBytes = Buffer.alloc(36);
    programBytes.writeUInt32LE(2);
    programData.toBuffer().copy(programBytes, 4);
    const elf = readFileSync("target/deploy/cat_shit_mining.so");
    const data = Buffer.alloc(45 + elf.length);
    data.writeUInt32LE(3);
    data[12] = 1;
    admin.publicKey.toBuffer().copy(data, 13);
    elf.copy(data, 45);
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
            data,
          },
        },
      ],
    );
    const bank = ctx.banksClient;
    function fund(key: PublicKey) {
      ctx.setAccount(key, {
        owner: SystemProgram.programId,
        executable: false,
        lamports: 2_000_000_000,
        data: Buffer.alloc(0),
      });
    }
    [admin, owner, attacker].forEach((k) => fund(k.publicKey));
    let nonce = 0;
    async function send(
      ixs: TransactionInstruction[],
      signers: Keypair[] = [owner],
    ) {
      const tx = new Transaction({
        feePayer: signers[0].publicKey,
        recentBlockhash: (await bank.getLatestBlockhash())![0],
      }).add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: ++nonce }),
        ...ixs,
      );
      tx.sign(...signers);
      return bank.tryProcessTransaction(tx);
    }
    async function ok(ixs: TransactionInstruction[], signers?: Keypair[]) {
      const result = await send(ixs, signers);
      assert.equal(result.result, null, result.meta?.logMessages.join("\n"));
      return result;
    }
    async function fails(
      ixs: TransactionInstruction[],
      expected: RegExp,
      signers?: Keypair[],
    ) {
      const result = await send(ixs, signers);
      assert.ok(result.result, "Transaction unexpectedly succeeded");
      assert.match(
        [result.result, ...(result.meta?.logMessages ?? [])].join("\n"),
        expected,
      );
    }
    const coder = new BorshAccountsCoder(IDL);
    async function position() {
      return coder.decode(
        "miningPosition",
        Buffer.from(
          (await bank.getAccount(pda("position", owner.publicKey)))!.data,
        ),
      );
    }
    async function tokenBalance(key: PublicKey) {
      return AccountLayout.decode(
        Buffer.from((await bank.getAccount(key))!.data),
      ).amount;
    }
    const mint = Keypair.generate();
    const adminAta = getAssociatedTokenAddressSync(
      mint.publicKey,
      admin.publicKey,
    );
    const initKeys = {
      admin: admin.publicKey,
      program: PROGRAM_ID,
      programData,
      config: configAddress,
      tokenMint: mint.publicKey,
      adminTokens: adminAta,
      faucetVault: faucetVaultAddress,
    };
    const rent = await bank.getRent();
    await ok(
      [
        SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: mint.publicKey,
          space: MINT_SIZE,
          lamports: Number(rent.minimumBalance(BigInt(MINT_SIZE))),
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(
          mint.publicKey,
          CATSHIT_DECIMALS,
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
          FAUCET_GLOBAL_CAP,
          CATSHIT_DECIMALS,
        ),
      ],
      [admin, mint],
    );
    await t.test(
      "Mint must be fixed supply; non-admin cannot initialize",
      async () => {
        await fails(
          [instruction("initializeConfig", initKeys)],
          /InvalidMint/,
          [admin],
        );
        await ok(
          [
            createSetAuthorityInstruction(
              mint.publicKey,
              admin.publicKey,
              AuthorityType.MintTokens,
              null,
            ),
          ],
          [admin],
        );
        await fails(
          [
            instruction("initializeConfig", {
              ...initKeys,
              admin: attacker.publicKey,
            }),
          ],
          /Unauthorized/,
          [attacker],
        );
      },
    );
    await t.test("Config initializes once with capped inventory", async () => {
      await ok([instruction("initializeConfig", initKeys)], [admin]);
      const config = coder.decode(
        "config",
        Buffer.from((await bank.getAccount(configAddress))!.data),
      );
      assert.equal(config.minLockAmount.toString(), MIN_LOCK.toString());
      assert.equal(
        config.unlockCooldownSeconds.toString(),
        UNLOCK_COOLDOWN.toString(),
      );
      assert.equal(await tokenBalance(faucetVaultAddress), FAUCET_GLOBAL_CAP);
      await fails(
        [instruction("initializeConfig", initKeys)],
        /already in use|custom program error: 0x0/,
        [admin],
      );
      await fails(
        [
          createMintToCheckedInstruction(
            mint.publicKey,
            adminAta,
            admin.publicKey,
            1n,
            CATSHIT_DECIMALS,
          ),
        ],
        /fixed supply|0x5|FixedSupply/i,
        [admin],
      );
    });
    const keys = ownerAccounts(owner.publicKey, mint.publicKey);
    await t.test("Faucet claim is atomic and once per wallet", async () => {
      await ok([
        ensureAta(owner.publicKey, mint.publicKey),
        instruction("claimFaucet", keys),
      ]);
      assert.equal(
        await tokenBalance(keys.ownerTokens),
        FAUCET_AMOUNT_PER_WALLET,
      );
      await fails(
        [instruction("claimFaucet", keys)],
        /already in use|custom program error: 0x0/,
      );
      assert.equal(
        await tokenBalance(keys.ownerTokens),
        FAUCET_AMOUNT_PER_WALLET,
      );
    });
    await t.test("Exactly one position and PDA-controlled vault", async () => {
      await ok([instruction("createPosition", keys)]);
      assert.equal((await position()).lockedAmount.toString(), "0");
      await fails(
        [instruction("createPosition", keys)],
        /already in use|custom program error: 0x0/,
      );
      assert.ok(
        AccountLayout.decode(
          Buffer.from((await bank.getAccount(keys.vault))!.data),
        ).owner.equals(keys.position),
      );
    });
    await t.test("Deposit transfers custody and derives CALM", async () => {
      const result = await ok([instruction("deposit", keys, MIN_LOCK)]);
      assert.ok(
        result.meta?.logMessages.some((line) =>
          line.startsWith("Program data:"),
        ),
      );
      assert.equal(await tokenBalance(keys.vault), MIN_LOCK);
      assert.equal(await tokenBalance(keys.ownerTokens), MIN_LOCK);
      assert.equal(
        getMiningTier(BigInt((await position()).lockedAmount.toString())).id,
        "CALM",
      );
      await fails([instruction("deposit", keys, 0n)], /ZeroAmount/);
      await fails([instruction("deposit", keys, (1n << 64n) - 1n)], /Overflow/);
    });
    await t.test(
      "Reject account substitution, wrong mint and unauthorized release",
      async () => {
        const unsigned = instruction("requestWithdraw", keys, 1n);
        unsigned.keys = unsigned.keys.map((key) =>
          key.pubkey.equals(owner.publicKey)
            ? { ...key, isSigner: false }
            : key,
        );
        await fails([unsigned], /AccountNotSigner/, [attacker]);
        const attackerKeys = ownerAccounts(attacker.publicKey, mint.publicKey);
        const wrongMint = Keypair.generate();
        await ok(
          [
            SystemProgram.createAccount({
              fromPubkey: attacker.publicKey,
              newAccountPubkey: wrongMint.publicKey,
              space: MINT_SIZE,
              lamports: Number(rent.minimumBalance(BigInt(MINT_SIZE))),
              programId: TOKEN_PROGRAM_ID,
            }),
            createInitializeMint2Instruction(
              wrongMint.publicKey,
              CATSHIT_DECIMALS,
              attacker.publicKey,
              null,
            ),
          ],
          [attacker, wrongMint],
        );
        await fails(
          [
            instruction(
              "deposit",
              { ...keys, tokenMint: wrongMint.publicKey },
              1n,
            ),
          ],
          /ConstraintHasOne/,
        );
        await ok([ensureAta(attacker.publicKey, mint.publicKey)], [attacker]);
        await fails(
          [
            instruction(
              "deposit",
              { ...keys, ownerTokens: attackerKeys.ownerTokens },
              1n,
            ),
          ],
          /ConstraintTokenOwner|ConstraintAssociated|ConstraintToken/,
        );
        await fails(
          [
            instruction(
              "deposit",
              { ...keys, tokenMint: attacker.publicKey },
              1n,
            ),
          ],
          /AccountOwnedByWrongProgram|AccountNotInitialized|AccountDiscriminator/,
        );
        await fails(
          [instruction("deposit", { ...keys, vault: keys.ownerTokens }, 1n)],
          /ConstraintSeeds/,
        );
        await fails(
          [
            instruction(
              "requestWithdraw",
              { ...keys, owner: attacker.publicKey },
              1n,
            ),
          ],
          /ConstraintSeeds|ConstraintHasOne/,
          [attacker],
        );
        await fails(
          [
            instruction("executeWithdraw", {
              ...keys,
              owner: attacker.publicKey,
            }),
          ],
          /ConstraintSeeds|ConstraintHasOne/,
          [attacker],
        );
        await fails(
          [
            createTransferCheckedInstruction(
              keys.vault,
              mint.publicKey,
              attackerKeys.ownerTokens,
              attacker.publicKey,
              1n,
              CATSHIT_DECIMALS,
            ),
          ],
          /owner does not match|0x4|OwnerMismatch/i,
          [attacker],
        );
      },
    );
    await t.test(
      "Withdrawal reduces mining immediately and permits deposits during cooldown",
      async () => {
        await fails(
          [instruction("requestWithdraw", keys, MIN_LOCK + 1n)],
          /InsufficientLocked/,
        );
        await fails([instruction("requestWithdraw", keys, 0n)], /ZeroAmount/);
        await ok([instruction("requestWithdraw", keys, MIN_LOCK)]);
        assert.equal((await position()).lockedAmount.toString(), "0");
        assert.equal(
          (await position()).pendingWithdrawAmount.toString(),
          MIN_LOCK.toString(),
        );
        assert.equal(await tokenBalance(keys.vault), MIN_LOCK);
        await fails(
          [instruction("requestWithdraw", keys, 1n)],
          /WithdrawalPending/,
        );
        await fails([instruction("executeWithdraw", keys)], /Cooldown/);
        await ok([instruction("deposit", keys, MIN_LOCK)]);
        assert.equal(
          (await position()).lockedAmount.toString(),
          MIN_LOCK.toString(),
        );
        assert.equal(
          (await position()).pendingWithdrawAmount.toString(),
          MIN_LOCK.toString(),
        );
      },
    );
    await t.test(
      "Cooldown boundary, owner payout and replay prevention",
      async () => {
        const requested = BigInt(
          (await position()).withdrawRequestedAt.toString(),
        );
        const old = await bank.getClock();
        ctx.setClock(
          new Clock(
            old.slot,
            old.epochStartTimestamp,
            old.epoch,
            old.leaderScheduleEpoch,
            requested + UNLOCK_COOLDOWN - 1n,
          ),
        );
        await fails([instruction("executeWithdraw", keys)], /Cooldown/);
        ctx.setClock(
          new Clock(
            old.slot,
            old.epochStartTimestamp,
            old.epoch,
            old.leaderScheduleEpoch,
            requested + UNLOCK_COOLDOWN,
          ),
        );
        await ok([instruction("executeWithdraw", keys)]);
        assert.equal(await tokenBalance(keys.ownerTokens), MIN_LOCK);
        assert.equal(await tokenBalance(keys.vault), MIN_LOCK);
        assert.equal((await position()).pendingWithdrawAmount.toString(), "0");
        assert.equal((await position()).withdrawRequestedAt.toString(), "0");
        await fails([instruction("executeWithdraw", keys)], /NoWithdrawal/);
      },
    );
    await t.test(
      "500 real claims exhaust the cap; wallet 501 cannot receive tokens",
      async () => {
        for (let i = 1; i < 500; i++) {
          const wallet = Keypair.generate();
          fund(wallet.publicKey);
          await ok(
            [
              ensureAta(wallet.publicKey, mint.publicKey),
              instruction(
                "claimFaucet",
                ownerAccounts(wallet.publicKey, mint.publicKey),
              ),
            ],
            [wallet],
          );
        }
        assert.equal(await tokenBalance(faucetVaultAddress), 0n);
        const wallet = Keypair.generate();
        fund(wallet.publicKey);
        await fails(
          [
            ensureAta(wallet.publicKey, mint.publicKey),
            instruction(
              "claimFaucet",
              ownerAccounts(wallet.publicKey, mint.publicKey),
            ),
          ],
          /FaucetExhausted/,
          [wallet],
        );
        assert.equal(
          await bank.getAccount(pda("faucet", wallet.publicKey)),
          null,
        );
        const config = coder.decode(
          "config",
          Buffer.from((await bank.getAccount(configAddress))!.data),
        );
        assert.equal(
          config.faucetDistributed.toString(),
          FAUCET_GLOBAL_CAP.toString(),
        );
      },
    );
  },
);
