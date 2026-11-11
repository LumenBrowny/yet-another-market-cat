import type { Connection } from "@solana/web3.js";
import { getBase58Decoder } from "@solana/kit";

type Rpc = Pick<Connection, "sendRawTransaction" | "getSignatureStatuses" | "getBlockHeight">;
type Timing = { now: () => number; sleep: (ms: number) => Promise<void>; timeoutMs: number };
const timing: Timing = { now: Date.now, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs: 120_000 };

/** HTTP only. No resend/re-sign after an ambiguous response. Recent-blockhash transactions only. */
export async function submitAndConfirm(
  rpc: Rpc,
  wire: Uint8Array,
  signatureBytes: Uint8Array,
  lastValidBlockHeight: number,
  onSubmitted: (signature: string) => void,
  commitment: "confirmed" | "finalized" = "confirmed",
  clock: Timing = timing,
): Promise<string> {
  if (signatureBytes.length !== 64 || !signatureBytes.some(v => v !== 0) || !Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight < 0)
    throw new Error("Invalid signed transaction");
  const signature = getBase58Decoder().decode(signatureBytes);
  // Expose the signed transaction ID even when submission loses its response.
  onSubmitted(signature);
  try {
    const returned = await rpc.sendRawTransaction(wire, {
      skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 2,
    });
    if (returned !== signature) throw new Error("Unexpected RPC signature");
  } catch {
    // A network failure cannot prove non-submission. Query this exact signature.
  }
  const until = clock.now() + clock.timeoutMs;
  while (clock.now() < until) {
    let status;
    try { status = (await rpc.getSignatureStatuses([signature], { searchTransactionHistory: false })).value[0]; }
    catch { await clock.sleep(3000); continue; }
    if (status?.err) throw new Error(`Transaction failed (${signature}); refresh before retrying`);
    if (status?.confirmationStatus === "finalized" || (commitment === "confirmed" && status?.confirmationStatus === "confirmed")) return signature;
    // A processed/confirmed transaction may still finalize after its blockhash expires.
    if (!status) {
      try {
        if (await rpc.getBlockHeight("finalized") > lastValidBlockHeight) {
          // Recheck after the height observation to avoid a status/height race.
          const final = (await rpc.getSignatureStatuses([signature], { searchTransactionHistory: false })).value[0];
          if (!final) throw new ExpiredTransaction(signature);
        }
      } catch (error) { if (error instanceof ExpiredTransaction) throw error; }
    }
    await clock.sleep(3000);
  }
  throw new Error(`Confirmation unavailable (${signature}); check its status before retrying`);
}

class ExpiredTransaction extends Error {
  constructor(signature: string) { super(`Blockhash expired; transaction not observed (${signature}). Refresh and check before retrying`); }
}
