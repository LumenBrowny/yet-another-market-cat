// Container transport/storage fixture ONLY. Not included in runtime image target.
// Never connects to RPC, signs grants, validates real SGT or calls real CAPTCHA.
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import { AdmissionStore } from "../../scripts/admission/core.ts";
import { createAdmissionServer } from "../../scripts/admission/http.ts";
const config = JSON.parse(readFileSync("/run/secrets/admission.json", "utf8"));
const issuer = Keypair.generate();
const key = issuer.publicKey;
const now = BigInt(Math.floor(Date.now() / 1000));
const store = new AdmissionStore("/data/admission.db", config.rateSalt);
const unavailable = async (): Promise<never> => {
  throw new Error("Fixture cannot authorize grants");
};
const server = createAdmissionServer({
  origin: "https://rehearsal.invalid",
  proxySecret: config.proxySecret,
  siteKey: "fixture-not-live",
  turnstileSecret: "fixture-not-live",
  store,
  issuer,
  mint: key,
  chain: {
    config: async () => ({
      admin: key,
      tokenMint: key,
      faucetIssuer: key,
      minLockAmount: 1000000000n,
      unlockCooldownSeconds: 86400n,
      faucetDistributed: 0n,
      launchMode: true,
      activatedAt: now + 7200n,
      ppCutoff: 0n,
      totalAllocated: 0n,
      faucetOpensAt: now - 60n,
      waveTwoAt: now + 3600n,
    }),
    claimed: unavailable,
    usedSubject: unavailable,
    seekerMints: unavailable,
    blockhash: unavailable,
  },
});
server.listen(5091, "127.0.0.1", () =>
  console.log("ADMISSION_TRANSPORT_FIXTURE_READY"),
);
process.on("SIGTERM", () =>
  server.close(() => {
    store.close();
    process.exit(0);
  }),
);
