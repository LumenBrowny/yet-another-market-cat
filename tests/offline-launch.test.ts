import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, SystemInstruction, Transaction } from "@solana/web3.js";
import {
  build,
  KIND,
  inspect,
  hash,
  type Policy,
  type Operation,
} from "../tools/offline-signer-rehearsal/launch-policy";
const key = () => Keypair.generate().publicKey.toBase58();
function fixture(): Policy {
  return {
    kind: KIND,
    rpc: "http://127.0.0.1:9013",
    genesis: key(),
    programId: "BfNiASrYNqmARu2TQ1eBa1PJ6KgVHTNn44ATk5rJe6zW",
    admin: key(),
    mint: key(),
    publisher: key(),
    issuer: key(),
    nonceAccount: key(),
    mintRentLamports: 1461600,
    schedule: {
      faucetOpensAt: 2000000000,
      waveTwoAt: 2000003600,
      miningStartsAt: 2000007200,
    },
  };
}
for (const operation of ["initialize", "rewards", "schedule"] as Operation[]) {
  test(`offline launch ${operation}: exact bytes, nonce first, packet and signers`, () => {
    const p = fixture(),
      nonceValue = key(),
      tx = build(p, operation, nonceValue),
      bytes = tx.serializeMessage();
    const req = {
      operation,
      nonceValue,
      messageBase64: bytes.toString("base64"),
      messageSha256: hash(bytes),
    };
    assert.equal(
      SystemInstruction.decodeInstructionType(tx.instructions[0]),
      "AdvanceNonceAccount",
    );
    assert.equal(
      tx.compileMessage().header.numRequiredSignatures,
      operation === "initialize" ? 2 : 1,
    );
    assert.equal(tx.compileMessage().accountKeys[0].toBase58(), p.admin);
    assert(tx.serialize({ requireAllSignatures: false }).length <= 1232);
    inspect(p, req);
    for (let i = 0; i < bytes.length; i++) {
      const b = Buffer.from(bytes);
      b[i] ^= 1;
      assert.throws(() =>
        inspect(p, {
          ...req,
          messageBase64: b.toString("base64"),
          messageSha256: hash(b),
        }),
      );
    }
    const changed = Transaction.from(
      tx.serialize({ requireAllSignatures: false }),
    );
    changed.add(tx.instructions[0]);
    assert.throws(() =>
      inspect(p, {
        ...req,
        messageBase64: changed.serializeMessage().toString("base64"),
        messageSha256: hash(changed.serializeMessage()),
      }),
    );
    for (const field of [
      "admin",
      "mint",
      "publisher",
      "issuer",
      "nonceAccount",
    ] as const) {
      const modified = { ...p, [field]: key() };
      // Non-participating service roles do not affect an earlier step's message.
      if (
        (field === "publisher" && operation !== "rewards") ||
        (field === "issuer" && operation !== "schedule") ||
        (field === "mint" && operation === "schedule")
      )
        continue;
      assert.throws(() => inspect(modified, req));
    }
  });
}
test("offline launch forbids public endpoint, colliding roles, excessive rent and ambiguous schedule", () => {
  const p = fixture(),
    n = key();
  for (const change of [
    { rpc: "https://api.mainnet-beta.solana.com" },
    { admin: p.publisher },
    { mintRentLamports: 10000001 },
    { programId: key() },
    { schedule: { ...p.schedule, waveTwoAt: p.schedule.faucetOpensAt } },
    { genesis: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" },
  ])
    assert.throws(() => build({ ...p, ...change }, "initialize", n));
});
