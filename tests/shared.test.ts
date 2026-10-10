import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CATSHIT_DECIMALS,
  MIN_LOCK,
  UNLOCK_COOLDOWN,
  FAUCET_GLOBAL_CAP,
  FAUCET_AMOUNT_PER_WALLET,
  MINING_TIERS,
  U64_MAX,
  parseTokens,
  formatTokens,
  getMiningTier,
  getNextTier,
} from "@yac/shared";

test("Every tier boundary and preceding base unit, including fractional 1.5", () => {
  const thresholds = [
    "0",
    "1000",
    "2500",
    "5000",
    "10000",
    "25000",
    "50000",
    "100000",
    "250000",
    "500000",
  ];
  const multipliers = [
    "×0",
    "×1",
    "×1.5",
    "×2",
    "×3",
    "×5",
    "×8",
    "×12",
    "×20",
    "×25",
  ];
  thresholds.forEach((threshold, i) => {
    const amount = parseTokens(threshold);
    assert.equal(getMiningTier(amount).displayMultiplier, multipliers[i]);
    if (i)
      assert.equal(
        getMiningTier(amount - 1n).displayMultiplier,
        multipliers[i - 1],
      );
  });
  assert.equal(getMiningTier(parseTokens("999.999999")).id, "DEAD_INSIDE");
  assert.equal(getMiningTier(parseTokens("2499.999999")).id, "CALM");
  assert.equal(MINING_TIERS[2].multiplierNumerator, 3n);
  assert.equal(MINING_TIERS[2].multiplierDenominator, 2n);
  assert.equal(getNextTier(MIN_LOCK)?.minimumLocked, parseTokens("2500"));
  assert.equal(getNextTier(U64_MAX), undefined);
});
test("Amounts never round or overflow", () => {
  assert.equal(parseTokens("1.000001"), 1000001n);
  assert.equal(formatTokens(parseTokens("1000.000001")), "1,000.000001");
  assert.equal(parseTokens("18446744073709.551615"), U64_MAX);
  for (const value of [
    "-1",
    "1e3",
    "0.0000001",
    "NaN",
    "Infinity",
    "",
    "18446744073709.551616",
  ])
    assert.throws(() => parseTokens(value));
  assert.throws(() => getMiningTier(-1n));
});
test("Rust protocol constants match shared definitions", () => {
  const rust = readFileSync("programs/cat_shit_mining/src/lib.rs", "utf8");
  for (const [name, expected] of Object.entries({
    CATSHIT_DECIMALS,
    MIN_LOCK,
    UNLOCK_COOLDOWN,
    FAUCET_GLOBAL_CAP,
    FAUCET_AMOUNT_PER_WALLET,
  })) {
    const match = rust.match(
      new RegExp(`pub const ${name}: [^=]+ = ([\\d_]+);`),
    );
    assert.ok(match, name);
    assert.equal(BigInt(match[1].replaceAll("_", "")), BigInt(expected), name);
  }
});
