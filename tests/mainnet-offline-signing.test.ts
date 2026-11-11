import test from "node:test";
import assert from "node:assert/strict";
import { Keypair, Transaction } from "@solana/web3.js";
import {
  MAINNET_GENESIS,
  digest,
  expectedDeploymentMessage,
  type DeploymentPins,
  type DeploymentRequest,
} from "../tools/offline-mainnet/deployment-policy";
import {
  pinsDigest,
  reviewRequest,
  signRequest,
  verifyResult,
} from "../tools/offline-mainnet/signing";
for (const operation of ["accept-buffer", "deploy"] as const)
  test(`offline ${operation}: exact message, independent pins, correct role and verifiable partial signature`, () => {
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
    const elf = Buffer.from("TEST ELF, not deployable");
    const p = {
      schema: "yamc-mainnet-deployment-pins-v1",
      genesis: MAINNET_GENESIS,
      ...Object.fromEntries(
        Object.entries(keys).map(([k, v]) => [k, v.publicKey.toBase58()]),
      ),
      binarySha256: digest(elf),
      binarySize: elf.length,
      programRentLamports: 833120,
    } as DeploymentPins;
    const nonceValue = Keypair.generate().publicKey.toBase58();
    const tx = expectedDeploymentMessage(p, operation, nonceValue),
      bytes = tx.serializeMessage();
    const r: DeploymentRequest = {
      operation,
      nonceValue,
      messageBase64: bytes.toString("base64"),
      messageSha256: digest(bytes),
    };
    assert.equal(reviewRequest(p, r, elf).transactionAuthorization, false);
    const result = signRequest(
      p,
      r,
      elf,
      "admin",
      [...keys.admin.secretKey],
      r.messageSha256,
      pinsDigest(p),
    );
    assert.equal(verifyResult(p, r, elf, result).broadcastAuthorization, false);
    tx.addSignature(
      keys.admin.publicKey,
      Buffer.from(result.signatureBase64, "base64"),
    );
    if (operation === "deploy") {
      const programResult = signRequest(
        p,
        r,
        elf,
        "program",
        [...keys.program.secretKey],
        r.messageSha256,
        pinsDigest(p),
      );
      verifyResult(p, r, elf, programResult);
      tx.addSignature(
        keys.program.publicKey,
        Buffer.from(programResult.signatureBase64, "base64"),
      );
      tx.partialSign(keys.payer);
    } else {
      tx.partialSign(keys.payer, keys.bufferAuthority);
      assert.throws(() =>
        signRequest(
          p,
          r,
          elf,
          "program",
          [...keys.program.secretKey],
          r.messageSha256,
          pinsDigest(p),
        ),
      );
    }
    assert(tx.verifySignatures());
    assert(Transaction.from(tx.serialize()).verifySignatures());
    assert.throws(() =>
      signRequest(
        p,
        r,
        elf,
        "admin",
        [...keys.payer.secretKey],
        r.messageSha256,
        pinsDigest(p),
      ),
    );
    assert.throws(() =>
      signRequest(
        p,
        r,
        elf,
        "admin",
        [...keys.admin.secretKey],
        "not-confirmed",
        pinsDigest(p),
      ),
    );
    assert.throws(() =>
      signRequest(
        p,
        r,
        elf,
        "admin",
        [...keys.admin.secretKey],
        r.messageSha256,
        "not-confirmed",
      ),
    );
    assert.throws(() =>
      reviewRequest(p, { ...r, pins: p } as DeploymentRequest, elf),
    );
    assert.throws(() =>
      verifyResult(p, r, elf, { ...result, role: "program" }),
    );
    assert.throws(() =>
      verifyResult(p, r, elf, {
        ...result,
        signatureBase64: Buffer.alloc(64).toString("base64"),
      }),
    );
    assert.throws(() =>
      verifyResult(
        p,
        { ...r, nonceValue: keys.buffer.publicKey.toBase58() },
        elf,
        result,
      ),
    );
    assert.throws(() => verifyResult(p, r, Buffer.alloc(elf.length), result));
    const corrupted = [...keys.admin.secretKey];
    corrupted[63] ^= 1;
    assert.throws(() =>
      signRequest(
        p,
        r,
        elf,
        "admin",
        corrupted,
        r.messageSha256,
        pinsDigest(p),
      ),
    );
    const changedPins = {
      ...p,
      programRentLamports: p.programRentLamports + 1,
    };
    assert.throws(() => verifyResult(changedPins, r, elf, result));
    assert.throws(() =>
      verifyResult(p, r, elf, {
        ...result,
        signatureBase64: result.signatureBase64 + "\n",
      }),
    );
  });
