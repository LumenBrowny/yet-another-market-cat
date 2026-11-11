import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, SystemInstruction } from "@solana/web3.js";
import {
  buildUpgrade,
  inspectUpgrade,
  digest,
  PROGRAM,
  DATA,
  type UpgradePolicy,
} from "../tools/offline-signer-rehearsal/upgrade-policy";
const key = () => Keypair.generate().publicKey.toBase58();
const fixture = (): UpgradePolicy => ({
  kind: "YAMC_LOCAL_LOADER_HANDOFF_V1",
  rpc: "http://127.0.0.1:9033",
  genesis: key(),
  programId: PROGRAM.toBase58(),
  programData: DATA.toBase58(),
  payer: key(),
  oldAuthority: key(),
  newAuthority: key(),
  nonceAccount: key(),
  binarySha256: "a".repeat(64),
  programDataSha256: "b".repeat(64),
});
test("checked upgrade transfer: exact two instructions and all three signers", () => {
  const p = fixture(),
    n = key(),
    tx = buildUpgrade(p, n),
    m = tx.compileMessage();
  assert.equal(tx.instructions.length, 2);
  assert.equal(
    SystemInstruction.decodeInstructionType(tx.instructions[0]),
    "AdvanceNonceAccount",
  );
  assert.equal(tx.instructions[1].data.toString("hex"), "07000000");
  assert.equal(m.header.numRequiredSignatures, 3);
  assert.equal(m.accountKeys[0].toBase58(), p.payer);
  assert(tx.instructions[1].keys[1].isSigner);
  assert(tx.instructions[1].keys[2].isSigner);
  const b = tx.serializeMessage(),
    r = {
      nonceValue: n,
      messageBase64: b.toString("base64"),
      messageSha256: digest(b),
    };
  inspectUpgrade(p, r);
  for (let i = 0; i < b.length; i++) {
    const changed = Buffer.from(b);
    changed[i] ^= 1;
    assert.throws(() =>
      inspectUpgrade(p, {
        ...r,
        messageBase64: changed.toString("base64"),
        messageSha256: digest(changed),
      }),
    );
  }
});
test("upgrade transfer forbids public endpoints, authority collisions, other program and revocation", () => {
  const p = fixture(),
    n = key();
  for (const changes of [
    { rpc: "https://api.mainnet-beta.solana.com" },
    { oldAuthority: p.newAuthority },
    { programId: key() },
    { programData: key() },
    { newAuthority: "11111111111111111111111111111111" },
    { binarySha256: "bad" },
  ])
    assert.throws(() => buildUpgrade({ ...p, ...changes }, n));
});
