import { BorshAccountsCoder, BN } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import { IDL, PROGRAM_ID, instruction, ownerAccounts } from "./client";
import { unsigned, type ProofNode } from "./settlement";

const coder = new BorshAccountsCoder(IDL);
export const rewardsPda = PublicKey.findProgramAddressSync(
  [Buffer.from("rewards")],
  PROGRAM_ID,
)[0];
export const rewardVaultPda = PublicKey.findProgramAddressSync(
  [Buffer.from("reward_vault")],
  PROGRAM_ID,
)[0];
export const deriveCyclePda = (id: bigint) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("cycle"), unsigned(id, 8)],
    PROGRAM_ID,
  )[0];
export const deriveClaimReceiptPda = (id: bigint, owner: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("claim"), unsigned(id, 8), owner.toBuffer()],
    PROGRAM_ID,
  )[0];
export function publicValue(value: unknown): unknown {
  if (BN.isBN(value)) return String(value);
  if (value instanceof PublicKey) return value.toBase58();
  if (Array.isArray(value)) return value.map(publicValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, publicValue(v)]),
    );
  return value;
}
export type RewardConfig = {
  tokenMint: string;
  publisher: string;
  genesis: string;
  duration: string;
  emission: string;
  committedUnclaimed: string;
  nextCycle: string;
  bump: number;
};
export type OnChainCycle = {
  cycleId: string;
  start: string;
  end: string;
  root: number[];
  manifestHash: number[];
  totalPoints: number[];
  budget: string;
  totalAllocated: string;
  claimedAmount: string;
  leafCount: number;
  publishedAt: string;
  publisher: string;
  bump: number;
};
export async function fetchAccount<T>(
  connection: Connection,
  key: PublicKey,
  name: string,
): Promise<T | null> {
  const account = await connection.getAccountInfo(key, "finalized");
  if (!account) return null;
  if (!account.owner.equals(PROGRAM_ID)) throw new Error("Wrong account owner");
  return publicValue(coder.decode(name, account.data)) as T;
}
export const fetchRewards = (c: Connection) =>
  fetchAccount<RewardConfig>(c, rewardsPda, "rewardConfig");
export const fetchCycle = (c: Connection, id: bigint) =>
  fetchAccount<OnChainCycle>(c, deriveCyclePda(id), "shitCycle");
export async function fetchPublishedCycles(
  c: Connection,
  nextCycle: bigint,
  fromCycle = 0n,
) {
  if (fromCycle < 0n || fromCycle > nextCycle)
    throw new Error("Invalid cycle discovery range");
  const cycles: (OnChainCycle & { address: string })[] = [];
  for (let first = fromCycle; first < nextCycle; first += 100n) {
    const count = Number(nextCycle - first > 100n ? 100n : nextCycle - first);
    const keys = Array.from({ length: count }, (_, index) =>
      deriveCyclePda(first + BigInt(index)),
    );
    const accounts = await c.getMultipleAccountsInfo(keys, "finalized");
    for (const [index, account] of accounts.entries()) {
      if (!account || !account.owner.equals(PROGRAM_ID))
        throw new Error("Missing or invalid finalized cycle");
      const cycle = publicValue(
        coder.decode("shitCycle", account.data),
      ) as OnChainCycle;
      if (BigInt(cycle.cycleId) !== first + BigInt(index))
        throw new Error("Cycle identity mismatch");
      cycles.push({ ...cycle, address: keys[index].toBase58() });
    }
  }
  return cycles;
}
export const fetchClaimReceipt = (
  c: Connection,
  id: bigint,
  wallet: PublicKey,
) =>
  fetchAccount<{
    cycleId: string;
    owner: string;
    rewardAmount: string;
    claimedAt: string;
  }>(c, deriveClaimReceiptPda(id, wallet), "claimReceipt");
export function claimInstruction(
  owner: PublicKey,
  mint: PublicKey,
  cycleId: bigint,
  points: bigint,
  amount: bigint,
  proof: ProofNode[],
) {
  return instruction(
    "claimCycle",
    {
      ...ownerAccounts(owner, mint),
      rewards: rewardsPda,
      rewardVault: rewardVaultPda,
      cycle: deriveCyclePda(cycleId),
      receipt: deriveClaimReceiptPda(cycleId, owner),
    },
    undefined,
    {
      cycleId: new BN(cycleId.toString()),
      pointUnits: [...unsigned(points, 32, true)],
      rewardAmount: new BN(amount.toString()),
      proof: proof.map((p) => ({
        hash: [...Buffer.from(p.hash, "hex")],
        left: p.left,
      })),
    },
  );
}
