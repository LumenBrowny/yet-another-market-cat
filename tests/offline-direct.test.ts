import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, SystemInstruction } from "@solana/web3.js";
import {
  buildDirect,
  inspectDirect,
  PROGRAM,
  DATA,
  digest,
  type DirectPolicy,
  type DirectOperation,
} from "../tools/offline-signer-rehearsal/direct-policy";
const k = () => Keypair.generate().publicKey.toBase58();
const fixture = (): DirectPolicy => ({
  kind: "YAMC_LOCAL_DIRECT_DEPLOY_V1",
  rpc: "http://127.0.0.1:9033",
  genesis: k(),
  programId: PROGRAM.toBase58(),
  programData: DATA.toBase58(),
  payer: k(),
  bufferAuthority: k(),
  admin: k(),
  buffer: k(),
  nonceAccount: k(),
  binarySha256: "a".repeat(64),
  binarySize: 608160,
  programRentLamports: 1141440,
});
for (const operation of ["accept-buffer", "deploy"] as DirectOperation[])
  test(`direct ${operation}: exact nonce and operation, reject byte changes`, () => {
    const p = fixture(),
      nonceValue = k(),
      tx = buildDirect(p, operation, nonceValue),
      b = tx.serializeMessage(),
      r = {
        operation,
        nonceValue,
        messageBase64: b.toString("base64"),
        messageSha256: digest(b),
      };
    inspectDirect(p, r);
    assert.equal(tx.compileMessage().header.numRequiredSignatures, 3);
    assert.equal(
      SystemInstruction.decodeInstructionType(tx.instructions[0]),
      "AdvanceNonceAccount",
    );
    assert(tx.serialize({ requireAllSignatures: false }).length < 1232);
    if (operation === "deploy") {
      assert.equal(tx.instructions.length, 4);
      assert.equal(
        SystemInstruction.decodeCreateAccount(
          tx.instructions[2],
        ).newAccountPubkey.toBase58(),
        p.programId,
      );
      assert.equal(tx.instructions[3].keys[7].pubkey.toBase58(), p.admin);
      assert.equal(tx.instructions[3].data.readUInt32LE(0), 2);
      assert.equal(tx.instructions[3].data.readBigUInt64LE(4), 608160n);
    } else assert.equal(tx.instructions[1].keys[0].pubkey.toBase58(), p.buffer);
    for (let i = 0; i < b.length; i++) {
      const m = Buffer.from(b);
      m[i] ^= 1;
      assert.throws(() =>
        inspectDirect(p, {
          ...r,
          messageBase64: m.toString("base64"),
          messageSha256: digest(m),
        }),
      );
    }
  });
test("direct policy rejects public RPC, role collisions, rent and size changes", () => {
  const p = fixture(),
    n = k();
  for (const x of [
    { rpc: "https://api.mainnet-beta.solana.com" },
    { payer: p.admin },
    { programId: k() },
    { binarySize: 1 },
    { programRentLamports: 2_000_001 },
    { admin: "11111111111111111111111111111111" },
  ])
    assert.throws(() => buildDirect({ ...p, ...x }, "deploy", n));
});
