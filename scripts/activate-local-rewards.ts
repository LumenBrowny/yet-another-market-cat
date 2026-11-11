// Experimental lifecycle rehearsal only. Never a mainnet deployment command.
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { readFile } from "node:fs/promises";
import {
  Connection,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  instruction,
  readConfig,
  configAddress,
} from "../packages/shared/src/client";
import {
  rewardsPda,
  rewardVaultPda,
  fetchRewards,
} from "../packages/shared/src/cycles";
async function main() {
  const endpoint = process.env.RPC_URL ?? "http://127.0.0.1:8899";
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname))
    throw new Error("Local rehearsal only");
  const c = new Connection(endpoint, "finalized");
  const config = await readConfig(c, "finalized");
  if (!config?.launchMode || config.activatedAt !== 0n)
    throw new Error("Expected prepared launch deployment");
  const admin = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        await readFile(process.env.ANCHOR_WALLET ?? ".dev/admin.json", "utf8"),
      ),
    ),
  );
  if (!admin.publicKey.equals(config.admin))
    throw new Error("Wrong activation signer");
  const opens = Number(process.env.YAC_FAUCET_OPENS_AT);
  const waveTwo = Number(process.env.YAC_WAVE_TWO_AT);
  const starts = Number(process.env.YAC_MINING_STARTS_AT);
  if (
    ![opens, waveTwo, starts].every(Number.isSafeInteger) ||
    !(opens > 0 && opens < waveTwo && waveTwo < starts)
  )
    throw new Error("Explicit ordered launch timestamps required");
  const issuer = new PublicKey(process.env.YAC_FAUCET_ISSUER_PUBLIC_KEY ?? "");
  const signature = await sendAndConfirmTransaction(
    c,
    new Transaction().add(
      instruction(
        "activateRewards",
        {
          admin: admin.publicKey,
          config: configAddress,
          rewards: rewardsPda,
          rewardVault: rewardVaultPda,
        },
        undefined,
        {
          faucetOpensAt: new BN(opens),
          waveTwoAt: new BN(waveTwo),
          miningStartsAt: new BN(starts),
          issuer,
        },
      ),
    ),
    [admin],
    { commitment: "finalized" },
  );
  const [after, rewards] = await Promise.all([
    readConfig(c, "finalized"),
    fetchRewards(c),
  ]);
  if (
    !after ||
    after.activatedAt <= 0n ||
    rewards?.genesis !== after.activatedAt.toString()
  )
    throw new Error("Finalized activation mismatch");
  console.log({ signature, genesis: rewards.genesis });
}
main().catch((e) => {
  console.error(String(e));
  process.exitCode = 1;
});
