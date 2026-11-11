import { type Connection, PublicKey } from "@solana/web3.js";
import { type AppConfiguration } from "./app-config";
import { PROGRAM_ID, readConfig } from "./client";
import { checkBackendIdentity } from "./backend-identity";

export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

// Keep the program pinned to the compiled IDL: changing an environment variable
// must never silently redirect instructions or PDA derivations to another program.
export async function readChainCheckedConfig(
  connection: Connection,
  app: AppConfiguration,
) {
  if (app.profile === "mainnet") {
    if (!app.programId || !PROGRAM_ID.equals(new PublicKey(app.programId)))
      throw new Error("Mainnet program does not match the compiled IDL");
    if ((await connection.getGenesisHash()) !== MAINNET_GENESIS)
      throw new Error("Mainnet genesis mismatch");
  }
  const config = await readConfig(connection);
  if (
    app.profile === "mainnet" &&
    (!config ||
      !config.launchMode ||
      !app.tokenMint ||
      !config.tokenMint.equals(new PublicKey(app.tokenMint)))
  )
    throw new Error("Mainnet deployment config/mint mismatch");
  return config;
}

export async function readCheckedConfig(
  connection: Connection,
  app: AppConfiguration,
) {
  const config = await readChainCheckedConfig(connection, app);
  if (app.profile === "mainnet")
    await checkBackendIdentity(app, MAINNET_GENESIS);
  return config;
}
