import { Connection, PublicKey } from "@solana/web3.js";
import { address, createSolanaRpc } from "@solana/kit";
import { getSeekerGenesisTokens } from "@solana-mobile/skr-genesis-token";
import { pda, readConfig } from "../../packages/shared/src/client.ts";
import { admissionAddress } from "../../packages/shared/src/admission.ts";
import { type AdmissionChain } from "./issuer.ts";

/** Startup verification is mandatory; callers cannot switch RPC via HTTP inputs. */
export async function createAdmissionChain(
  grantRpc: string,
  expectedGenesis: string,
  sgtRpc: string,
): Promise<AdmissionChain> {
  if (!expectedGenesis)
    throw new Error("Expected grant network genesis required");
  const connection = new Connection(grantRpc, {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
    fetch: (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(8000) }),
  });
  const seeker = createSolanaRpc(sgtRpc);
  if ((await connection.getGenesisHash()) !== expectedGenesis)
    throw new Error("Wrong grant network");
  if (
    (await seeker
      .getGenesisHash()
      .send({ abortSignal: AbortSignal.timeout(8000) })) !==
    "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
  )
    throw new Error("SGT verification requires mainnet");
  return {
    async config() {
      const config = await readConfig(connection, "finalized");
      if (!config?.launchMode) throw new Error("Launch deployment required");
      return config;
    },
    async claimed(wallet) {
      return !!(await connection.getAccountInfo(
        pda("faucet", wallet),
        "finalized",
      ));
    },
    async usedSubject(wave, subject) {
      return !!(await connection.getAccountInfo(
        admissionAddress(wave, subject),
        "finalized",
      ));
    },
    async seekerMints(wallet) {
      const tokens = await getSeekerGenesisTokens(
        seeker,
        address(wallet.toBase58()),
        { commitment: "finalized", abortSignal: AbortSignal.timeout(8000) },
      );
      return tokens.map((token) => new PublicKey(token.mint));
    },
    blockhash: () => connection.getLatestBlockhash("finalized"),
  };
}
