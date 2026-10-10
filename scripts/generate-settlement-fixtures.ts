import { writeFile } from "node:fs/promises";
import { PublicKey } from "@solana/web3.js";
import {
  allocateRewards,
  buildTree,
  leafHash,
  leafPreimage,
  canonicalManifest,
  verifyManifest,
  type CycleManifest,
} from "../packages/shared/src/settlement";
async function main() {
  const vectors = [0, 1, 2, 3, 5, 33].map((count) => {
    const points = Array.from({ length: count }, (_, i) => ({
      wallet: new PublicKey(new Uint8Array(32).fill(i + 1)).toBase58(),
      pointUnits: ((BigInt(i) + 1n) * 1500n).toString(),
    }));
    const miners = allocateRewards(points, 10001n);
    const tree = buildTree("42", miners);
    const key = new PublicKey(new Uint8Array(32).fill(9)).toBase58();
    const manifest: CycleManifest = {
      version: 1,
      project: "yet-another-cat",
      programId: key,
      mint: key,
      genesisHash: key,
      cycleId: "42",
      startTime: "1000",
      endTime: "1100",
      pointScale: "1000",
      totalPointUnits: points
        .reduce((s, p) => s + BigInt(p.pointUnits), 0n)
        .toString(),
      rewardBudgetBaseUnits: "10001",
      totalAllocatedBaseUnits: count ? "10001" : "0",
      leafCount: count,
      merkleRoot: tree.root,
      miners,
    };
    const verified = verifyManifest(manifest);
    return {
      manifest,
      canonical: canonicalManifest(manifest),
      manifestHash: verified.manifestHash,
      leaves: miners.map((m) => ({
        ...m,
        preimage: leafPreimage("42", m).toString("hex"),
        hash: leafHash("42", m),
        proof: tree.proofs[m.wallet],
      })),
    };
  });
  await writeFile(
    "protocol/settlement-vectors.json",
    JSON.stringify(vectors, null, 2) + "\n",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
