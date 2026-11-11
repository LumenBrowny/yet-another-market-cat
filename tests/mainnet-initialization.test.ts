import test from "node:test";
import assert from "node:assert/strict";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { BN, BorshInstructionCoder } from "@coral-xyz/anchor";
import { IDL } from "../packages/shared/src/client";
import {
  digest,
  MAINNET_GENESIS,
} from "../tools/offline-mainnet/deployment-policy";
import {
  buildInitialization,
  initializationAddresses,
  initializationPinsDigest,
  reviewInitialization,
  type InitializationPins,
  type InitializationRequest,
} from "../tools/offline-mainnet/initialization-policy";
import {
  signInitialization,
  verifyInitializationSignature,
} from "../tools/offline-mainnet/initialization-signing";
for (const operation of ["initialize", "rewards"] as const)
  test(`mainnet ${operation}: exact unscheduled policy and offline signatures`, () => {
    const roles = Object.fromEntries(
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
    const elf = Buffer.from("fixture ELF"),
      p: InitializationPins = {
        schema: "yamc-mainnet-initialization-v1",
        deployment: {
          schema: "yamc-mainnet-deployment-pins-v1",
          genesis: MAINNET_GENESIS,
          program: roles.program.publicKey.toBase58(),
          admin: roles.admin.publicKey.toBase58(),
          payer: roles.payer.publicKey.toBase58(),
          buffer: roles.buffer.publicKey.toBase58(),
          bufferAuthority: roles.bufferAuthority.publicKey.toBase58(),
          nonceAccount: roles.nonceAccount.publicKey.toBase58(),
          binarySha256: digest(elf),
          binarySize: elf.length,
          programRentLamports: 833120,
        },
        mint: roles.mint.publicKey.toBase58(),
        publisher: roles.publisher.publicKey.toBase58(),
        issuer: roles.issuer.publicKey.toBase58(),
        mintRentLamports: 1461600,
      };
    const nonceValue = Keypair.generate().publicKey.toBase58();
    const tx = buildInitialization(p, operation, nonceValue),
      message = tx.serializeMessage();
    const r: InitializationRequest = {
      operation,
      nonceValue,
      messageBase64: message.toString("base64"),
      messageSha256: digest(message),
    };
    const review = reviewInitialization(p, r, elf);
    assert.equal(review.activationAllowed, false);
    assert.equal(review.feePayer, p.deployment.admin);
    assert.equal(review.mintAuthorityAfter, null);
    const coder = new BorshInstructionCoder(IDL),
      name =
        operation === "initialize"
          ? "initializeLaunchConfig"
          : "initializeRewards";
    const expectedData = coder.encode(
      name,
      operation === "initialize"
        ? {}
        : {
            genesis: new BN(0),
            duration: new BN(86400),
            emission: new BN("250000000000"),
            publisher: new PublicKey(p.publisher),
          },
    );
    const custom = tx.instructions.at(-1)!;
    assert(custom.data.equals(expectedData));
    const a = initializationAddresses(p);
    const definition = IDL.instructions.find((x) => x.name === name)!;
    assert.deepEqual(
      custom.keys,
      definition.accounts.map((x) => {
        if (!("name" in x) || "accounts" in x) throw Error();
        return {
          pubkey: a[x.name as keyof typeof a],
          isWritable: x.writable ?? false,
          isSigner: x.signer ?? false,
        };
      }),
    );
    const expectedRoles =
      operation === "initialize"
        ? (["admin", "mint"] as const)
        : (["admin"] as const);
    const m = tx.compileMessage();
    assert.deepEqual(
      m.accountKeys
        .slice(0, m.header.numRequiredSignatures)
        .map((x) => x.toBase58())
        .sort(),
      expectedRoles.map((x) => roles[x].publicKey.toBase58()).sort(),
    );
    for (const role of expectedRoles) {
      const result = signInitialization(
        p,
        r,
        elf,
        role,
        [...roles[role].secretKey],
        r.messageSha256,
        initializationPinsDigest(p),
      );
      verifyInitializationSignature(p, r, elf, result);
      tx.addSignature(
        roles[role].publicKey,
        Buffer.from(result.signatureBase64, "base64"),
      );
      assert.throws(() =>
        verifyInitializationSignature(p, r, elf, {
          ...result,
          signatureBase64: Buffer.alloc(64).toString("base64"),
        }),
      );
    }
    assert(tx.verifySignatures());
    assert(tx.serialize().length <= 1232);
    assert.throws(() =>
      signInitialization(
        p,
        r,
        elf,
        "admin",
        [...roles.payer.secretKey],
        r.messageSha256,
        initializationPinsDigest(p),
      ),
    );
    assert.throws(() =>
      signInitialization(
        p,
        r,
        elf,
        "admin",
        [...roles.admin.secretKey],
        "wrong",
        initializationPinsDigest(p),
      ),
    );
    assert.throws(() => reviewInitialization(p, r, Buffer.from("bad ELF")));
    assert.throws(() =>
      buildInitialization(p, "schedule" as never, nonceValue),
    );
    assert.throws(() =>
      buildInitialization(
        { ...p, mint: p.deployment.admin },
        operation,
        nonceValue,
      ),
    );
    assert.throws(() =>
      reviewInitialization(
        p,
        {
          ...r,
          operation: operation === "initialize" ? "rewards" : "initialize",
        },
        elf,
      ),
    );
    const altered = Transaction.from(tx.serialize());
    altered.add(
      SystemProgram.transfer({
        fromPubkey: roles.admin.publicKey,
        toPubkey: roles.payer.publicKey,
        lamports: 1,
      }),
    );
    const b = altered.serializeMessage();
    assert.throws(() =>
      reviewInitialization(
        p,
        { ...r, messageBase64: b.toString("base64"), messageSha256: digest(b) },
        elf,
      ),
    );
    if (operation === "rewards")
      assert.throws(() =>
        signInitialization(
          p,
          r,
          elf,
          "mint",
          [...roles.mint.secretKey],
          r.messageSha256,
          initializationPinsDigest(p),
        ),
      );
  });
