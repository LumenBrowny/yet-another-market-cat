export const CATSHIT_DECIMALS = 6;
export const TOKEN_SCALE = 10n ** BigInt(CATSHIT_DECIMALS);
export const MIN_LOCK = 1_000n * TOKEN_SCALE;
export const UNLOCK_COOLDOWN = 86_400n;
export const FAUCET_GLOBAL_CAP = 1_000_000n * TOKEN_SCALE;
export const FAUCET_AMOUNT_PER_WALLET = 2_000n * TOKEN_SCALE;
export const U64_MAX = (1n << 64n) - 1n;
export type CatState =
  | "DEAD_INSIDE"
  | "CALM"
  | "SUSPICIOUS"
  | "ACTIVE"
  | "CONCERNED"
  | "DISTRESSED"
  | "AIRBORNE"
  | "PANIC"
  | "OVERDRIVE"
  | "TRANSCENDENT";
export type MiningTier = Readonly<{
  id: CatState;
  minimumLocked: bigint;
  multiplierNumerator: bigint;
  multiplierDenominator: bigint;
  displayMultiplier: string;
  catState: CatState;
}>;
function tier(
  id: CatState,
  minimum: bigint,
  numerator: bigint,
  denominator = 1n,
): MiningTier {
  return Object.freeze({
    id,
    minimumLocked: minimum * TOKEN_SCALE,
    multiplierNumerator: numerator,
    multiplierDenominator: denominator,
    displayMultiplier:
      numerator === 3n && denominator === 2n ? "×1.5" : `×${numerator}`,
    catState: id,
  });
}
export const MINING_TIERS: readonly MiningTier[] = Object.freeze([
  tier("DEAD_INSIDE", 0n, 0n),
  tier("CALM", 1000n, 1n),
  tier("SUSPICIOUS", 2500n, 3n, 2n),
  tier("ACTIVE", 5000n, 2n),
  tier("CONCERNED", 10000n, 3n),
  tier("DISTRESSED", 25000n, 5n),
  tier("AIRBORNE", 50000n, 8n),
  tier("PANIC", 100000n, 12n),
  tier("OVERDRIVE", 250000n, 20n),
  tier("TRANSCENDENT", 500000n, 25n),
]);
export function assertAmount(amount: bigint): bigint {
  if (amount < 0n || amount > U64_MAX)
    throw new RangeError("Amount must fit unsigned 64-bit base units");
  return amount;
}
export function parseTokens(value: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(value))
    throw new Error(
      "Use a positive decimal amount with at most 6 decimal places",
    );
  const [whole, fraction = ""] = value.split(".");
  return assertAmount(
    BigInt(whole) * TOKEN_SCALE + BigInt(fraction.padEnd(6, "0")),
  );
}
export function formatTokens(value: bigint): string {
  assertAmount(value);
  const fraction = (value % TOKEN_SCALE)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${(value / TOKEN_SCALE).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? "." + fraction : ""}`;
}
export function getMiningTier(lockedAmount: bigint): MiningTier {
  assertAmount(lockedAmount);
  return [...MINING_TIERS]
    .reverse()
    .find((t) => lockedAmount >= t.minimumLocked)!;
}
export function getNextTier(lockedAmount: bigint): MiningTier | undefined {
  assertAmount(lockedAmount);
  return MINING_TIERS.find((t) => lockedAmount < t.minimumLocked);
}
