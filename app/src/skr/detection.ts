// Cosmetic mainnet read only. Never use the devnet wallet connection here.
export const SKR_MINT = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";
export const SKR_RPC = "https://api.mainnet-beta.solana.com";
export const SKR_TTL = 5 * 60_000;
export type Detection = {
  status: "found" | "absent" | "unavailable";
  checkedAt: number;
  amount: string;
};
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export function parseSkrBalance(value: unknown, owner: string): bigint {
  if (!Array.isArray(value)) throw Error("Malformed token response");
  let amount = 0n;
  const seen = new Set<string>();
  for (const item of value) {
    const account = item?.account;
    const info = account?.data?.parsed?.info;
    if (
      account?.owner !== TOKEN_PROGRAM ||
      account?.data?.parsed?.type !== "account" ||
      info?.mint !== SKR_MINT ||
      info?.owner !== owner ||
      info?.tokenAmount?.decimals !== 6 ||
      !/^\d+$/.test(info?.tokenAmount?.amount ?? "") ||
      typeof item.pubkey !== "string" ||
      seen.has(item.pubkey)
    )
      throw Error("Invalid SKR account");
    seen.add(item.pubkey);
    amount += BigInt(info.tokenAmount.amount);
  }
  return amount;
}

export function createSkrDetector(
  request: typeof fetch = fetch,
  now = Date.now,
) {
  const cache = new Map<string, Detection>();
  const pending = new Map<string, Promise<Detection>>();
  return async (owner: string, force = false): Promise<Detection> => {
    const old = cache.get(owner);
    const ttl =
      old?.status === "unavailable" ? 60_000 : force ? 15_000 : SKR_TTL;
    if (old && now() - old.checkedAt < ttl) return old;
    if (pending.has(owner)) return pending.get(owner)!;
    const job = (async () => {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 8000);
      let result: Detection;
      try {
        const response = await request(SKR_RPC, {
          method: "POST",
          signal: abort.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 13,
            method: "getTokenAccountsByOwner",
            params: [
              owner,
              { mint: SKR_MINT },
              { encoding: "jsonParsed", commitment: "confirmed" },
            ],
          }),
        });
        if (!response.ok) throw Error("SKR RPC unavailable");
        const payload = await response.json();
        if (payload.error) throw Error("SKR RPC error");
        const amount = parseSkrBalance(payload.result?.value, owner);
        result = {
          status: amount > 0n ? "found" : "absent",
          amount: amount.toString(),
          checkedAt: now(),
        };
      } catch {
        result = { status: "unavailable", amount: "0", checkedAt: now() };
      } finally {
        clearTimeout(timer);
      }
      if (cache.size >= 16) cache.delete(cache.keys().next().value!);
      cache.set(owner, result);
      return result;
    })();
    pending.set(owner, job);
    try {
      return await job;
    } finally {
      pending.delete(owner);
    }
  };
}
export const detectSkr = createSkrDetector();

export class DetectorGesture {
  private taps: number[] = [];
  reset() {
    this.taps = [];
  }
  tap(eligible: boolean, now: number): boolean {
    if (!eligible) {
      this.reset();
      return false;
    }
    this.taps = this.taps.filter((t) => now - t <= 4000 && now >= t);
    this.taps.push(now);
    if (this.taps.length < 9) return false;
    this.reset();
    return true;
  }
}
