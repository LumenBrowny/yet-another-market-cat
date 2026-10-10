import { sha256 } from "@noble/hashes/sha256";
import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";

export type CycleMiner = {
  wallet: string;
  pointUnits: string;
  rewardBaseUnits: string;
};
export type ProofNode = { hash: string; left: boolean };
export type CycleManifest = {
  version: number;
  project: string;
  programId: string;
  mint: string;
  genesisHash: string;
  cycleId: string;
  startTime: string;
  endTime: string;
  pointScale: string;
  totalPointUnits: string;
  rewardBudgetBaseUnits: string;
  totalAllocatedBaseUnits: string;
  leafCount: number;
  merkleRoot: string;
  miners: CycleMiner[];
};
export function unsigned(
  value: bigint,
  bytes: number,
  bigEndian = false,
): Buffer {
  if (value < 0n || value >= 1n << BigInt(bytes * 8))
    throw new Error("Integer outside wire bounds");
  const result = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++) {
    result[bigEndian ? bytes - i - 1 : i] = Number(value & 255n);
    value >>= 8n;
  }
  return result;
}
export const digest = (bytes: Uint8Array) =>
  Buffer.from(sha256(bytes)).toString("hex");
export const emptyRoot = digest(Buffer.from("YAC_EMPTY_CYCLE_V1", "ascii"));
export function leafPreimage(cycleId: string, miner: CycleMiner) {
  return Buffer.concat([
    Buffer.from([0]),
    Buffer.from("YAC_CYCLE_REWARD_V1", "ascii"),
    unsigned(BigInt(cycleId), 8),
    new PublicKey(miner.wallet).toBuffer(),
    unsigned(BigInt(miner.pointUnits), 32, true),
    unsigned(BigInt(miner.rewardBaseUnits), 8),
  ]);
}
export const leafHash = (cycleId: string, miner: CycleMiner) =>
  digest(leafPreimage(cycleId, miner));
export const nodeHash = (left: string, right: string) =>
  digest(
    Buffer.concat([
      Buffer.from([1]),
      Buffer.from(left, "hex"),
      Buffer.from(right, "hex"),
    ]),
  );
export function verifyProof(leaf: string, proof: ProofNode[], root: string) {
  if (
    proof.length > 16 ||
    !/^[0-9a-f]{64}$/.test(root) ||
    !/^[0-9a-f]{64}$/.test(leaf)
  )
    return false;
  for (const p of proof) {
    if (!/^[0-9a-f]{64}$/.test(p.hash) || typeof p.left !== "boolean")
      return false;
    leaf = p.left ? nodeHash(p.hash, leaf) : nodeHash(leaf, p.hash);
  }
  return leaf === root;
}
export const walletOrder = (a: string, b: string) =>
  Buffer.compare(new PublicKey(a).toBuffer(), new PublicKey(b).toBuffer());
export function allocateRewards(
  input: { wallet: string; pointUnits: string }[],
  budget: bigint,
): CycleMiner[] {
  unsigned(budget, 8);
  if (new Set(input.map((p) => p.wallet)).size !== input.length)
    throw new Error("Duplicate wallet");
  input.forEach((p) => unsigned(BigInt(p.pointUnits), 32, true));
  const rows = input
    .filter((p) => BigInt(p.pointUnits) > 0n)
    .sort((a, b) => walletOrder(a.wallet, b.wallet));
  const total = rows.reduce((s, p) => s + BigInt(p.pointUnits), 0n);
  if (!total) return [];
  const result = rows.map((p) => ({
    ...p,
    reward: (budget * BigInt(p.pointUnits)) / total,
    remainder: (budget * BigInt(p.pointUnits)) % total,
  }));
  let dust = budget - result.reduce((s, p) => s + p.reward, 0n);
  for (const row of [...result].sort((a, b) =>
    a.remainder === b.remainder
      ? walletOrder(a.wallet, b.wallet)
      : a.remainder > b.remainder
        ? -1
        : 1,
  )) {
    if (!dust) break;
    row.reward++;
    dust--;
  }
  return result.map((p) => ({
    wallet: p.wallet,
    pointUnits: p.pointUnits,
    rewardBaseUnits: p.reward.toString(),
  }));
}
export function buildTree(cycleId: string, miners: CycleMiner[]) {
  const leaves = miners.filter((m) => BigInt(m.rewardBaseUnits) > 0n);
  if (leaves.length > 65536) throw new Error("Tree exceeds supported depth");
  const levels = [leaves.map((m) => leafHash(cycleId, m))];
  while (levels.at(-1)!.length > 1) {
    const previous = levels.at(-1)!;
    const next: string[] = [];
    for (let i = 0; i < previous.length; i += 2)
      next.push(nodeHash(previous[i], previous[i + 1] ?? previous[i]));
    levels.push(next);
  }
  return {
    root: leaves.length ? levels.at(-1)![0] : emptyRoot,
    proofs: Object.fromEntries(
      leaves.map((m, i) => {
        let index = i;
        const proof: ProofNode[] = [];
        for (const level of levels.slice(0, -1)) {
          proof.push({
            hash: level[Math.min(index ^ 1, level.length - 1)],
            left: (index & 1) === 1,
          });
          index >>= 1;
        }
        return [m.wallet, proof];
      }),
    ),
  };
}
export function canonicalManifest(m: CycleManifest) {
  return JSON.stringify({
    version: m.version,
    project: m.project,
    programId: m.programId,
    mint: m.mint,
    genesisHash: m.genesisHash,
    cycleId: m.cycleId,
    startTime: m.startTime,
    endTime: m.endTime,
    pointScale: m.pointScale,
    totalPointUnits: m.totalPointUnits,
    rewardBudgetBaseUnits: m.rewardBudgetBaseUnits,
    totalAllocatedBaseUnits: m.totalAllocatedBaseUnits,
    leafCount: m.leafCount,
    merkleRoot: m.merkleRoot,
    miners: m.miners.map((p) => ({
      wallet: p.wallet,
      pointUnits: p.pointUnits,
      rewardBaseUnits: p.rewardBaseUnits,
    })),
  });
}
export function verifyManifest(m: CycleManifest) {
  const integers = [
    m.cycleId,
    m.startTime,
    m.endTime,
    m.totalPointUnits,
    m.rewardBudgetBaseUnits,
    m.totalAllocatedBaseUnits,
    ...m.miners.flatMap((p) => [p.pointUnits, p.rewardBaseUnits]),
  ];
  if (
    integers.some((p) => typeof p !== "string" || !/^(0|[1-9][0-9]*)$/.test(p))
  )
    throw new Error("Noncanonical unsigned integer");
  if (BigInt(m.endTime) > (1n << 63n) - 1n)
    throw new Error("Timestamp overflow");
  if (
    m.version !== 1 ||
    m.project !== "yet-another-cat" ||
    m.pointScale !== "1000" ||
    BigInt(m.endTime) <= BigInt(m.startTime) ||
    BigInt(m.startTime) < 0n ||
    BigInt(m.rewardBudgetBaseUnits) <= 0n
  )
    throw new Error("Invalid manifest metadata");
  [m.programId, m.mint, m.genesisHash].forEach((p) => new PublicKey(p));
  unsigned(BigInt(m.cycleId), 8);
  const expected = allocateRewards(m.miners, BigInt(m.rewardBudgetBaseUnits));
  if (JSON.stringify(expected) !== JSON.stringify(m.miners))
    throw new Error("Noncanonical ordering, points or reward allocation");
  const total = m.miners.reduce((s, p) => s + BigInt(p.pointUnits), 0n);
  unsigned(total, 32, true);
  if (
    total.toString() !== m.totalPointUnits ||
    (total > 0n ? m.rewardBudgetBaseUnits : "0") !== m.totalAllocatedBaseUnits
  )
    throw new Error("Wrong totals");
  const tree = buildTree(m.cycleId, m.miners);
  if (
    tree.root !== m.merkleRoot ||
    m.leafCount !== Object.keys(tree.proofs).length
  )
    throw new Error("Root/count mismatch");
  return {
    valid: true,
    manifestHash: digest(Buffer.from(canonicalManifest(m))),
    merkleRoot: tree.root,
    proofs: tree.proofs,
  };
}
