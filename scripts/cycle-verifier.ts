import { PROGRAM_ID } from "../packages/shared/src/client";
import { Connection } from "@solana/web3.js";
import {
  canonicalManifest,
  verifyManifest,
  walletOrder,
  type CycleManifest,
} from "../packages/shared/src/settlement";
import { fetchCycle, fetchRewards } from "../packages/shared/src/cycles";
import { getMiningTier } from "../packages/shared/src/index";
import {
  readHistory,
  type ChainEvent as NormalizedEvent,
} from "./chain-history";

export type VerificationCheck = {
  id: string;
  label: string;
  status: "PASS" | "FAIL" | "UNAVAILABLE" | "SKIPPED";
  detail?: string;
};
export type VerificationReport = {
  cycleId: string;
  verifiedAt: string;
  result: "VALID" | "INVALID" | "UNVERIFIABLE";
  internalConsistency: boolean;
  chainRecomputation: boolean;
  checks: VerificationCheck[];
  manifestHash?: string;
  onChainRoot?: string;
  recomputedRoot?: string;
  sourceWatermark?: number;
  sourceTime?: number;
  minersVerified?: number;
  pendingPublication?: boolean;
  rpcSourceCategory?: string;
  sourceStartSlot?: number;
  sourceBlocks?: { cached: number; downloaded: number };
  historyMetrics?: unknown;
};

// Independent TypeScript integration retained from Prompt 04, with no project DB dependency.
export function recomputePoints(
  events: NormalizedEvent[],
  start: number,
  end: number,
) {
  const groups = new Map<string, NormalizedEvent[]>();
  for (const e of events.filter((e) =>
    [
      "positionCreated",
      "deposited",
      "withdrawRequested",
      "withdrawExecuted",
    ].includes(e.eventType),
  )) {
    const list = groups.get(e.wallet) ?? [];
    list.push(e);
    groups.set(e.wallet, list);
  }
  return [...groups]
    .map(([wallet, rows]) => {
      let time = 0,
        rate = 0n,
        units = 0n;
      for (const e of rows.sort(
        (a, b) =>
          a.slot - b.slot ||
          a.transactionIndex - b.transactionIndex ||
          a.eventIndex - b.eventIndex,
      )) {
        const next = Math.max(time, e.blockTime);
        units +=
          BigInt(Math.max(0, Math.min(end, next) - Math.max(start, time))) *
          rate;
        time = next;
        const tier = getMiningTier(BigInt(e.effectiveLockedAmount));
        rate = (1000n * tier.multiplierNumerator) / tier.multiplierDenominator;
      }
      units += BigInt(Math.max(0, end - Math.max(start, time))) * rate;
      return { wallet, pointUnits: units.toString() };
    })
    .filter((p) => p.pointUnits !== "0")
    .sort((a, b) => walletOrder(a.wallet, b.wallet));
}

export async function verifyCycleReport(
  text: string,
  endpoint?: string,
  startSlot?: number,
  allowUnpublished = false,
): Promise<VerificationReport> {
  return verifyWithHistory(text, endpoint, startSlot, allowUnpublished);
}

// One independent history scan, shared inside this invocation. Immutable blocks
// may use the explicitly configured RPC cache; never the accounting DB or HTTP
// client data. Every cycle still checks its current on-chain PDA.
export async function verifyCyclesReport(
  texts: string[],
  endpoint: string,
  startSlot: number,
) {
  let history: Awaited<ReturnType<typeof readHistory>> | undefined;
  try {
    history = await readHistory({
      checkpoint: 0,
      endpoint,
      startSlot,
      programId: PROGRAM_ID.toBase58(),
      blockCacheDirectory: process.env.YAC_FINALIZED_BLOCK_CACHE,
    });
  } catch {
    return Promise.all(
      texts.map((text) => verifyWithHistory(text, undefined, startSlot, false)),
    );
  }
  const reports: VerificationReport[] = [];
  for (const text of texts)
    reports.push(
      await verifyWithHistory(text, endpoint, startSlot, false, history),
    );
  return reports;
}

async function verifyWithHistory(
  text: string,
  endpoint?: string,
  startSlot?: number,
  allowUnpublished = false,
  replayed?: Awaited<ReturnType<typeof readHistory>>,
): Promise<VerificationReport> {
  const r: VerificationReport = {
    cycleId: "",
    verifiedAt: new Date().toISOString(),
    result: "UNVERIFIABLE",
    internalConsistency: false,
    chainRecomputation: false,
    checks: [],
    rpcSourceCategory: endpoint ? new URL(endpoint).hostname : "not-configured",
    sourceStartSlot: startSlot,
  };
  const check = (id: string, label: string, pass: boolean, detail?: string) => {
    r.checks.push({ id, label, status: pass ? "PASS" : "FAIL", detail });
    return pass;
  };
  let m: CycleManifest;
  try {
    m = JSON.parse(text);
    r.cycleId = m.cycleId;
    if (
      !check(
        "format",
        "Canonical manifest format",
        text === canonicalManifest(m),
      )
    ) {
      r.result = "INVALID";
      return r;
    }
  } catch {
    check("format", "Canonical manifest format", false, "Malformed manifest");
    r.result = "INVALID";
    return r;
  }
  try {
    const result = verifyManifest(m);
    r.manifestHash = result.manifestHash;
    r.recomputedRoot = result.merkleRoot;
    check(
      "allocation",
      "Reward allocation and total emission recomputed",
      true,
    );
    check("merkle", "Leaf encoding and Merkle root recomputed", true);
    r.internalConsistency = true;
    r.minersVerified = m.miners.length;
  } catch (e) {
    check(
      "internal",
      "Manifest allocation / Merkle consistency",
      false,
      String(e).slice(0, 200),
    );
    r.result = "INVALID";
    return r;
  }
  if (!endpoint || !Number.isSafeInteger(startSlot) || startSlot! <= 0) {
    r.checks.push({
      id: "history",
      label: "Finalized mining history",
      status: "UNAVAILABLE",
      detail: "Chain recomputation requires RPC and deployment start slot",
    });
    return r;
  }
  const c = new Connection(endpoint, "finalized");
  try {
    const [config, cycle, genesis] = await Promise.all([
      fetchRewards(c),
      fetchCycle(c, BigInt(m.cycleId)),
      c.getGenesisHash(),
    ]);
    if (!config) throw new Error("Reward configuration unavailable");
    if (
      !check(
        "identity",
        "Chain identity and fixed cycle schedule",
        m.programId === PROGRAM_ID.toBase58() &&
          genesis === m.genesisHash &&
          config.tokenMint === m.mint &&
          config.emission === m.rewardBudgetBaseUnits &&
          BigInt(m.startTime) ===
            BigInt(config.genesis) +
              BigInt(m.cycleId) * BigInt(config.duration) &&
          BigInt(m.endTime) === BigInt(m.startTime) + BigInt(config.duration),
      )
    ) {
      r.result = "INVALID";
      return r;
    }
    if (!cycle && !allowUnpublished) {
      r.checks.push({
        id: "cycle",
        label: "Published cycle exists on Solana",
        status: "UNAVAILABLE",
        detail: "Cycle is not published on this RPC",
      });
      return r;
    }
    if (cycle) {
      check("cycle", "Published cycle exists on Solana", true);
      r.onChainRoot = Buffer.from(cycle.root).toString("hex");
      const hash = check(
        "manifestHash",
        "Manifest hash matches Solana",
        Buffer.from(cycle.manifestHash).toString("hex") === r.manifestHash,
      );
      const root = check(
        "chainRoot",
        "Merkle root matches Solana",
        r.onChainRoot === r.recomputedRoot,
      );
      if (!hash || !root) {
        r.result = "INVALID";
        return r;
      }
    } else {
      r.pendingPublication = true;
      r.checks.push({
        id: "cycle",
        label: "Prepublication verification",
        status: "SKIPPED",
        detail: "No on-chain commitment yet",
      });
    }
  } catch {
    r.checks.push({
      id: "rpc",
      label: "Read finalized Solana state",
      status: "UNAVAILABLE",
      detail: "RPC unavailable or account data could not be read",
    });
    return r;
  }
  try {
    const history =
      replayed ??
      (await readHistory({
        checkpoint: 0,
        startSlot,
        endpoint,
        programId: m.programId,
        blockCacheDirectory: process.env.YAC_FINALIZED_BLOCK_CACHE,
      }));
    if (
      !check(
        "historyIdentity",
        "History chain and mint match manifest",
        history.genesisHash === m.genesisHash && history.mint === m.mint,
      )
    ) {
      r.result = "INVALID";
      return r;
    }
    r.sourceWatermark = history.throughSlot;
    r.sourceTime = history.throughTime;
    r.sourceBlocks = history.rpcBlocks;
    r.historyMetrics = history.rpcMetrics;
    if (history.throughTime < Number(m.endTime) + 5)
      throw new Error("Insufficient finalized history");
    check("history", "Required finalized mining history available", true);
    const points = recomputePoints(
      history.events,
      Number(m.startTime),
      Number(m.endTime),
    );
    if (
      !check(
        "points",
        "Poop Points recomputed from public chain history",
        JSON.stringify(points) ===
          JSON.stringify(
            m.miners.map((p) => ({
              wallet: p.wallet,
              pointUnits: p.pointUnits,
            })),
          ),
        "Independent TypeScript interval integration; no backend DB",
      )
    ) {
      r.result = "INVALID";
      return r;
    }
    r.chainRecomputation = true;
    r.result = "VALID";
  } catch {
    r.checks.push({
      id: "history",
      label: "Finalized mining history",
      status: "UNAVAILABLE",
      detail:
        "UNVERIFIABLE WITH THIS RPC: required history is unavailable; this does not prove invalidity",
    });
  }
  return r;
}
