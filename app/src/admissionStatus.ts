import type { Config } from "@yac/shared/src/client";
import { FAUCET_GLOBAL_CAP } from "@yac/shared";

// Display hints only: the program and issuer enforce eligibility independently.
export function admissionStatus(config: Config, now: bigint, claimed: boolean) {
  const scheduled = config.faucetOpensAt > 0n;
  const locksClosed =
    !scheduled || now < config.faucetOpensAt || config.ppCutoff > 0n;
  const exhausted = config.faucetDistributed >= FAUCET_GLOBAL_CAP;
  const date = (seconds: bigint) =>
    new Date(Number(seconds) * 1000).toUTCString();
  const waveOne = now < config.waveTwoAt;
  const title =
    config.ppCutoff > 0n
      ? "DISTRIBUTION COMPLETE"
      : !scheduled
        ? "LAUNCH NOT SCHEDULED"
        : now < config.faucetOpensAt
          ? "THE CATS ARE COMING"
          : exhausted
            ? "FAUCET FULLY CLAIMED"
            : waveOne
              ? "WAVE 1 · THE CHOSEN CATS"
              : "WAVE 2 · THE GREAT SHIT RUSH";
  const detail =
    config.ppCutoff > 0n
      ? "New allocations and locks are closed. Historical reward claims and withdrawals remain available."
      : !scheduled
        ? "The on-chain launch schedule has not been set."
        : now < config.faucetOpensAt
          ? `Faucet and pre-lock open ${date(config.faucetOpensAt)}.`
          : exhausted
            ? "All faucet allocations have been claimed. Faucet exhaustion does not end mining or reward claims."
            : waveOne
              ? `Sign in with a wallet holding an unused Seeker Genesis Token. One allocation per SGT and wallet. Open wave starts ${date(config.waveTwoAt)}.`
              : "Remaining allocations are first-come, first-served. Sign in, complete the browser check, then return here. One allocation per wallet.";
  const miningPending = !config.activatedAt || now < config.activatedAt;
  const mining =
    config.ppCutoff > 0n
      ? "EMISSION COMPLETE · PP FROZEN"
      : miningPending
        ? "PRE-LAUNCH · PP NOT ACCRUING"
        : null;
  const schedule =
    scheduled && config.activatedAt > 0n
      ? `Mining starts ${date(config.activatedAt)}. Pre-lock earns no PP before this time.`
      : null;
  return {
    title,
    detail,
    mining,
    miningPending,
    schedule,
    locksClosed,
    disabled: locksClosed || exhausted || claimed,
    label: claimed
      ? "ALLOCATION ALREADY RECEIVED"
      : "FEED THE CAT · 1,000 CATSHIT",
  };
}
