import { readFile } from "node:fs/promises";
import { Keypair, PublicKey } from "@solana/web3.js";
import { AdmissionStore } from "./admission/core.ts";
import { createAdmissionChain } from "./admission/chain.ts";
import { createAdmissionServer } from "./admission/http.ts";

async function main() {
  // Explicit opt-in, private loopback transport. No secret is read by the app.
  if (process.env.YAC_ADMISSION_ENABLED !== "true")
    throw new Error("Admission service disabled");
  const config = JSON.parse(
    await readFile(
      process.env.YAC_ADMISSION_CONFIG ?? ".dev/admission-secrets.json",
      "utf8",
    ),
  );
  const issuer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(await readFile(config.issuerKeyFile, "utf8"))),
  );
  if (
    config.localRehearsal &&
    (config.grantRpc !== "http://127.0.0.1:8929" ||
      config.origin !== "http://localhost:5088")
  )
    throw new Error("Rehearsal requires isolated local endpoints");
  if (typeof config.rateSalt !== "string" || config.rateSalt.length < 32)
    throw new Error("Persistent rate salt required");
  const chain = await createAdmissionChain(
    config.grantRpc,
    config.expectedGenesis,
    config.sgtRpc,
  );
  const mint = new PublicKey(config.mint);
  const onchain = await chain.config();
  if (
    !onchain.faucetIssuer.equals(issuer.publicKey) ||
    !onchain.tokenMint.equals(mint)
  )
    throw new Error("Issuer/mint does not match on-chain config");
  const store = new AdmissionStore(
    config.database ?? ".dev/admission.db",
    config.rateSalt,
  );
  const server = createAdmissionServer({
    origin: config.origin,
    proxySecret: config.proxySecret,
    siteKey: config.turnstile.siteKey,
    turnstileSecret: config.turnstile.secretKey,
    store,
    chain,
    issuer,
    mint,
    localRehearsal: config.localRehearsal === true,
    publicApiPath: config.publicApiPath,
  });
  server.listen(5091, "127.0.0.1", () =>
    console.log("Admission service listening on private loopback port 5091"),
  );
  const stop = () =>
    server.close(() => {
      store.close();
      process.exit(0);
    });
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
main().catch(() => {
  console.error(
    "Admission startup failed; check private configuration and RPC availability.",
  );
  process.exitCode = 1;
});
