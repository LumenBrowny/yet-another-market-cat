import { test } from "node:test";
import assert from "node:assert/strict";
import vectors from "../protocol/settlement-vectors.json";
import { PublicKey, Transaction } from "@solana/web3.js";
import { claimInstruction } from "../packages/shared/src/cycles";
import {
  allocateRewards,
  canonicalManifest,
  leafHash,
  leafPreimage,
  verifyManifest,
  verifyProof,
} from "../packages/shared/src/settlement";
for (const vector of vectors)
  test(`Merkle golden vector: ${vector.leaves.length} leaves`, () => {
    const verified = verifyManifest(vector.manifest);
    assert.equal(verified.manifestHash, vector.manifestHash);
    assert.equal(canonicalManifest(vector.manifest), vector.canonical);
    for (const leaf of vector.leaves) {
      assert.equal(leafPreimage("42", leaf).toString("hex"), leaf.preimage);
      assert.equal(leafHash("42", leaf), leaf.hash);
      assert(verifyProof(leaf.hash, leaf.proof, vector.manifest.merkleRoot));
      assert(
        !verifyProof(
          leafHash("43", leaf),
          leaf.proof,
          vector.manifest.merkleRoot,
        ),
      );
      assert(
        !verifyProof(
          leafHash("42", {
            ...leaf,
            pointUnits: (BigInt(leaf.pointUnits) + 1n).toString(),
          }),
          leaf.proof,
          vector.manifest.merkleRoot,
        ),
      );
      assert(
        !verifyProof(
          leafHash("42", {
            ...leaf,
            rewardBaseUnits: (BigInt(leaf.rewardBaseUnits) + 1n).toString(),
          }),
          leaf.proof,
          vector.manifest.merkleRoot,
        ),
      );
      if (leaf.proof.length) {
        assert(
          !verifyProof(
            leaf.hash,
            [
              { ...leaf.proof[0], hash: "00".repeat(32) },
              ...leaf.proof.slice(1),
            ],
            vector.manifest.merkleRoot,
          ),
        );
        if (leaf.proof[0].hash !== leaf.hash)
          assert(
            !verifyProof(
              leaf.hash,
              [
                { ...leaf.proof[0], left: !leaf.proof[0].left },
                ...leaf.proof.slice(1),
              ],
              vector.manifest.merkleRoot,
            ),
          );
      }
    }
  });
test("Manifest reward/PP/wallet/root tampering fails independently", () => {
  for (const field of [
    "rewardBaseUnits",
    "pointUnits",
    "wallet",
    "merkleRoot",
  ] as const) {
    const m = structuredClone(vectors[3].manifest);
    if (field === "merkleRoot") m.merkleRoot = "00".repeat(32);
    else
      m.miners[0][field] =
        field === "wallet" ? "11111111111111111111111111111111" : "1";
    assert.throws(() => verifyManifest(m));
  }
});
test("Exact dust budget and canonical wallet-byte tie-break", () => {
  const wallets = vectors[3].manifest.miners.map((p) => p.wallet);
  const result = allocateRewards(
    wallets.reverse().map((wallet) => ({ wallet, pointUnits: "1" })),
    2n,
  );
  assert.deepEqual(
    result.map((r) => r.rewardBaseUnits),
    ["1", "1", "0"],
  );
  assert.equal(
    result.reduce((s, r) => s + BigInt(r.rewardBaseUnits), 0n),
    2n,
  );
});

test("Maximum depth claim fits a signed legacy Solana transaction", () => {
  const owner = new PublicKey(vectors[1].manifest.miners[0].wallet);
  const mint = new PublicKey(vectors[1].manifest.mint);
  const transaction = new Transaction({
    feePayer: owner,
    recentBlockhash: PublicKey.default.toBase58(),
  }).add(
    claimInstruction(
      owner,
      mint,
      42n,
      1n,
      1n,
      Array.from({ length: 16 }, () => ({
        hash: "01".repeat(32),
        left: false,
      })),
    ),
  );
  const size = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }).length;
  assert(size <= 1232);
  console.log(`Maximum-depth claim: ${size}/1232 transaction bytes`);
});

test("Manifest rejects noncanonical numeric strings", () => {
  const manifest = structuredClone(vectors[1].manifest);
  manifest.cycleId = "042";
  assert.throws(() => verifyManifest(manifest), /Noncanonical/);
});
