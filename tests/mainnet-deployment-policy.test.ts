import test from "node:test";
import assert from "node:assert/strict";
import { Keypair, SystemInstruction, SystemProgram } from "@solana/web3.js";
import {
  digest,
  MAINNET_GENESIS,
  expectedDeploymentMessage,
  inspectDeployment,
  type DeploymentPins,
} from "../tools/offline-mainnet/deployment-policy";
const key = () => Keypair.generate().publicKey.toBase58();
const elf = Buffer.from("synthetic ELF fixture, never deploy");
const pins = (): DeploymentPins => ({
  schema: "yamc-mainnet-deployment-pins-v1",
  genesis: MAINNET_GENESIS,
  program: key(),
  admin: key(),
  payer: key(),
  bufferAuthority: key(),
  buffer: key(),
  nonceAccount: key(),
  binarySize: elf.length,
  binarySha256: digest(elf),
  programRentLamports: 1141440,
});
for (const operation of ["accept-buffer", "deploy"] as const)
  test(`mainnet ${operation}: exact message and local ELF, never authorizes`, () => {
    const p = pins(),
      nonceValue = key(),
      tx = expectedDeploymentMessage(p, operation, nonceValue),
      bytes = tx.serializeMessage();
    const request = {
      operation,
      nonceValue,
      messageBase64: bytes.toString("base64"),
      messageSha256: digest(bytes),
    };
    const result = inspectDeployment(p, request, elf);
    assert.equal(result.transactionAuthorization, false);
    assert.deepEqual(
      new Set(result.expectedSigners),
      new Set(
        operation === "deploy"
          ? [p.admin, p.payer, p.program]
          : [p.admin, p.payer, p.bufferAuthority],
      ),
    );
    assert.equal(
      SystemInstruction.decodeNonceAdvance(
        tx.instructions[0],
      ).authorizedPubkey.toBase58(),
      p.admin,
    );
    if (operation === "deploy") {
      assert.equal(
        SystemInstruction.decodeCreateAccount(
          tx.instructions[2],
        ).newAccountPubkey.toBase58(),
        p.program,
      );
      assert.equal(tx.instructions[3].keys[7].pubkey.toBase58(), p.admin);
      assert.equal(
        tx.instructions[3].data.readBigUInt64LE(4),
        BigInt(elf.length),
      );
    } else assert.equal(tx.instructions[1].data.readUInt32LE(), 7);
    for (let i = 0; i < bytes.length; i++) {
      const altered = Buffer.from(bytes);
      altered[i] ^= 1;
      assert.throws(() =>
        inspectDeployment(
          p,
          {
            ...request,
            messageBase64: altered.toString("base64"),
            messageSha256: digest(altered),
          },
          elf,
        ),
      );
    }
    assert.throws(() =>
      inspectDeployment(p, request, Buffer.from("different executable")),
    );
    // Program is not in accept-buffer bytes; old buffer authority is not in deploy
    // bytes. Those facts require the independent online account-state checks.
    for (const role of [
      "admin",
      "payer",
      "buffer",
      "nonceAccount",
      operation === "deploy" ? "program" : "bufferAuthority",
    ] as const)
      assert.throws(() =>
        inspectDeployment({ ...p, [role]: key() }, request, elf),
      );
  });
test("mainnet deployment rejects incomplete pins, collisions, devnet and mutable ELF", () => {
  const p = pins(),
    n = key();
  for (const override of [
    { genesis: key() },
    { admin: p.payer },
    { program: "BfNiASrYNqmARu2TQ1eBa1PJ6KgVHTNn44ATk5rJe6zW" },
    { buffer: SystemProgram.programId.toBase58() },
    { binarySize: NaN },
    { programRentLamports: 2000001 },
    { binarySha256: "latest" },
  ])
    assert.throws(() =>
      expectedDeploymentMessage({ ...p, ...override }, "deploy", n),
    );
  assert.throws(() =>
    expectedDeploymentMessage(
      { ...p, payer: null } as unknown as DeploymentPins,
      "deploy",
      n,
    ),
  );
});
