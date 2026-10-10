import { BorshAccountsCoder, BorshEventCoder } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { IDL } from "../packages/shared/src/client";
import { FinalizedBlockCache } from "./finalized-block-cache";

export type ChainEvent = {
  cycleId?: string;
  id: string;
  signature: string;
  slot: number;
  transactionIndex: number;
  eventIndex: number;
  blockTime: number;
  eventType: string;
  wallet: string;
  position: string;
  amount: string;
  effectiveLockedAmount: string;
  rawPayload: string;
};
const coder = new BorshEventCoder(IDL);
// Only retain events from successfully committed invocation frames. A caught failed
// CPI may leave logs in an otherwise successful transaction: those events roll back.
export function decodeLogs(logs: string[], programId: string) {
  const stack: {
    program: string;
    events: {
      index: number;
      name: string;
      data: Record<string, unknown>;
      raw: string;
    }[];
  }[] = [];
  const accepted: (typeof stack)[number]["events"] = [];
  logs.forEach((line, index) => {
    const invoke = /^Program (\w+) invoke \[(\d+)\]$/.exec(line);
    if (invoke) {
      if (Number(invoke[2]) !== stack.length + 1)
        throw new Error("Incomplete invocation log");
      stack.push({ program: invoke[1], events: [] });
      return;
    }
    const done = /^Program (\w+) (success|failed:.*)$/.exec(line);
    if (done) {
      const frame = stack.pop();
      if (!frame || frame.program !== done[1])
        throw new Error("Unbalanced invocation log");
      if (done[2] === "success")
        (stack.at(-1)?.events ?? accepted).push(...frame.events);
      return;
    }
    if (line.includes("Log truncated"))
      throw new Error("Truncated transaction logs");
    if (
      stack.at(-1)?.program === programId &&
      line.startsWith("Program data: ")
    ) {
      const raw = line.slice(14);
      const event = coder.decode(raw);
      if (!event)
        throw new Error("Unknown program event; update IDL before advancing");
      stack.at(-1)!.events.push({ index, ...event, raw });
    }
  });
  if (stack.length) throw new Error("Incomplete transaction logs");
  return accepted.sort((a, b) => a.index - b.index);
}

export async function readHistory(input: {
  checkpoint: number;
  startSlot?: number;
  endpoint: string;
  programId: string;
  deploymentSignature?: string;
  blockCacheDirectory?: string;
  operationalTip?: {
    slot: number;
    blockTime: number;
    genesisHash: string;
    fetchedAt: number;
  };
}) {
  const methods: Record<string, number> = {};
  const timings = { coverageMs: 0, cacheLookupMs: 0, networkBlockMs: 0, decodeMs: 0, retryDelayMs: 0 };
  let retries = 0;
  // Raw RPC preserves canonical transaction order from the full block response.
  // web3 PublicKey + Anchor IDL handle PDA derivation and wire decoding only.
  async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      methods[method] = (methods[method] ?? 0) + 1;
      if (
        method === "getBlock" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(
          new URL(input.endpoint).hostname,
        )
      )
        await new Promise((resolve) => setTimeout(resolve, 500));
      const response = await fetch(input.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(30_000),
      });
      if ([429, 502, 503, 504].includes(response.status) && attempt < 4) {
        retries++;
        const retryAfter = Number(response.headers.get("retry-after"));
        const delay = Math.min(30_000, Math.max(1000 * 2 ** attempt + Math.floor(Math.random() * 250), Number.isFinite(retryAfter) ? retryAfter * 1000 : 0));
        await response.body?.cancel();
        timings.retryDelayMs += delay;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      if (!response.ok)
        throw new Error(`RPC ${method}: HTTP ${response.status}`);
      const body = (await response.json()) as {
        result: T;
        error?: { message: string };
      };
      if (body.error) throw new Error(`RPC ${method}: ${body.error.message}`);
      return body.result;
    }
    throw new Error(`RPC ${method}: retry budget exhausted`);
  }
  const program = new PublicKey(input.programId);
  const shared = input.operationalTip;
  if (
    shared &&
    (Date.now() - shared.fetchedAt > 15_000 ||
      shared.fetchedAt > Date.now() + 1000)
  )
    throw new Error("Stale operational tip");
  const [genesisHash, tip] = shared
    ? [shared.genesisHash, shared.slot]
    : await Promise.all([
        rpc<string>("getGenesisHash"),
        rpc<number>("getSlot", [{ commitment: "finalized" }]),
      ]);
  let startSlot = input.startSlot ?? undefined;
  if (startSlot === undefined) {
    if (!input.deploymentSignature)
      throw new Error("SOLANA_START_SLOT or deployment signature required");
    const status = await rpc<{ slot: number } | null>("getTransaction", [
      input.deploymentSignature,
      { commitment: "finalized", maxSupportedTransactionVersion: 1 },
    ]);
    if (!status)
      throw new Error("Deployment history unavailable or not finalized");
    startSlot = status.slot;
  }
  if (
    !Number.isSafeInteger(startSlot) ||
    startSlot < 1 ||
    startSlot > tip ||
    tip < input.checkpoint
  )
    throw new Error("Invalid start/checkpoint slot or ledger changed");
  const coverageStarted = performance.now();
  const firstAvailable = await rpc<number>("getFirstAvailableBlock");
  timings.coverageMs = performance.now() - coverageStarted;
  if (firstAvailable > Math.max(startSlot, input.checkpoint + 1))
    throw new Error("Required history pruned; use archival RPC");
  const from = Math.max(startSlot, input.checkpoint - 32, firstAvailable);
  const configKey = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program,
  )[0];
  const configInfo = await rpc<{
    value: { owner: string; data: [string, string] } | null;
  }>("getAccountInfo", [
    configKey.toBase58(),
    { commitment: "finalized", encoding: "base64" },
  ]);
  if (!configInfo.value || configInfo.value.owner !== program.toBase58())
    throw new Error("Missing or invalid program config");
  const config = new BorshAccountsCoder(IDL).decode(
    "config",
    Buffer.from(configInfo.value.data[0], "base64"),
  );
  const slots = new Set<number>();
  let before: string | undefined;
  for (;;) {
    const page = await rpc<{ signature: string; slot: number; err: unknown }[]>(
      "getSignaturesForAddress",
      [
        input.programId,
        { commitment: "finalized", limit: 1000, ...(before ? { before } : {}) },
      ],
    );
    for (const s of page)
      if (s.slot >= from && s.slot <= tip && !s.err) slots.add(s.slot);
    if (!page.length || page.at(-1)!.slot < from) break;
    if (before === page.at(-1)!.signature)
      throw new Error("RPC pagination did not advance");
    before = page.at(-1)!.signature;
  }
  const tipTime = shared
    ? shared.blockTime
    : await rpc<number | null>("getBlockTime", [tip]);
  if (tipTime === null || !Number.isSafeInteger(tipTime) || tipTime < 0)
    throw new Error("Finalized timestamp unavailable; retry without advancing");
  const events: ChainEvent[] = [];
  const cacheDirectory =
    input.blockCacheDirectory ?? process.env.YAC_FINALIZED_BLOCK_CACHE;
  const blockCache = cacheDirectory
    ? new FinalizedBlockCache(cacheDirectory, input.endpoint, genesisHash)
    : undefined;
  let cachedBlocks = 0,
    downloadedBlocks = 0;
  type Block = {
    blockTime: number | null;
    transactions: {
      transaction: { signatures: string[] };
      meta: { err: unknown; logMessages: string[] | null } | null;
    }[];
  };
  for (const slot of [...slots].sort((a, b) => a - b)) {
    const lookupStarted = performance.now();
    const cached = await blockCache?.get<Block>(slot);
    timings.cacheLookupMs += performance.now() - lookupStarted;
    const fetchStarted = performance.now();
    const block =
      cached ??
      (await rpc<Block | null>("getBlock", [
        slot,
        {
          commitment: "finalized",
          transactionDetails: "full",
          rewards: false,
          maxSupportedTransactionVersion: 1,
        },
      ]));
    if (!cached) timings.networkBlockMs += performance.now() - fetchStarted;
    const decodeStarted = performance.now();
    if (cached) cachedBlocks++;
    else downloadedBlocks++;
    if (
      !block ||
      block.blockTime === null ||
      !Number.isSafeInteger(block.blockTime) ||
      block.blockTime < 0
    )
      throw new Error(`Block/time unavailable at ${slot}`);
    for (const [transactionIndex, tx] of block.transactions.entries()) {
      if (!tx.meta) throw new Error(`Missing metadata at ${slot}`);
      if (tx.meta.err) continue;
      const logs = tx.meta.logMessages;
      if (!logs) throw new Error(`Missing logs at ${slot}`);
      if (!logs.some((l) => l.startsWith(`Program ${input.programId} invoke`)))
        continue;
      for (const e of decodeLogs(logs, input.programId)) {
        const data = e.data;
        const owner = new PublicKey(String(data.owner ?? PublicKey.default));
        const position = PublicKey.findProgramAddressSync(
          [Buffer.from("position"), owner.toBuffer()],
          program,
        )[0];
        const signature = tx.transaction.signatures[0];
        events.push({
          id: `${signature}:${e.index}`,
          signature,
          slot,
          transactionIndex,
          eventIndex: e.index,
          blockTime: block.blockTime,
          eventType: e.name,
          wallet: owner.toBase58(),
          position: position.toBase58(),
          amount: String(data.amount ?? data.rewardAmount ?? "0"),
          effectiveLockedAmount: String(data.effectiveLockedAmount ?? "0"),
          rawPayload: e.raw,
          cycleId: String(data.cycleId ?? ""),
        });
      }
    }
    timings.decodeMs += performance.now() - decodeStarted;
    if (!cached && blockCache) await blockCache.put(slot, block);
  }
  const rpcMetrics = { methods, cachedBlocks, downloadedBlocks, retries, timings };
  if (process.env.YAC_RPC_METRICS === "true")
    console.error("YAC_RPC_METRICS " + JSON.stringify(rpcMetrics));
  return {
    genesisHash,
    programId: input.programId,
    mint: String(config.tokenMint),
    startSlot,
    throughSlot: tip,
    throughTime: tipTime,
    events,
    rpcBlocks: { cached: cachedBlocks, downloaded: downloadedBlocks },
    rpcMetrics,
  };
}

if (process.argv.includes("--stdio")) {
  (async () => {
    let input = "";
    for await (const chunk of process.stdin) input += String(chunk);
    return readHistory(JSON.parse(input));
  })()
    .then((result) => process.stdout.write(JSON.stringify(result)))
    .catch((e) => {
      console.error(String(e));
      process.exitCode = 1;
    });
}
