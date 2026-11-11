import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  instruction,
  configAddress,
  readConfig,
} from "../packages/shared/src/client";
import { rewardsPda, fetchRewards } from "../packages/shared/src/cycles";

// Rehearsal only. Production offline signing/custody is a separate release gate.
async function main() {
  const { values: v } = parseArgs({
    options: {
      rpc: { type: "string" },
      genesis: { type: "string" },
      role: { type: "string" },
      admin: { type: "string" },
      "new-key": { type: "string" },
      "expected-current": { type: "string" },
      send: { type: "boolean", default: false },
    },
  });
  if (
    !v.rpc ||
    !v.genesis ||
    !v.admin ||
    !v["new-key"] ||
    !v["expected-current"] ||
    !["publisher", "issuer"].includes(v.role ?? "")
  )
    throw new Error(
      "Required: --rpc --genesis --role publisher|issuer --admin FILE --new-key FILE --expected-current PUBKEY; optional --send",
    );
  const url = new URL(v.rpc);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.pathname !== "/"
  )
    throw new Error("Only a plain loopback rehearsal RPC is allowed");
  const c = new Connection(v.rpc, "finalized");
  if ((await c.getGenesisHash()) !== v.genesis)
    throw new Error("Wrong ledger genesis");
  const config = await readConfig(c, "finalized");
  if (!config?.launchMode) throw new Error("Launch deployment required");
  const key = async (path: string) =>
    Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(await readFile(path, "utf8"))),
    );
  const admin = await key(v.admin),
    next = await key(v["new-key"]);
  if (!admin.publicKey.equals(config.admin)) throw new Error("Wrong admin");
  const rewards = await fetchRewards(c);
  const current =
    v.role === "issuer" ? config.faucetIssuer.toBase58() : rewards?.publisher;
  if (current !== new PublicKey(v["expected-current"]).toBase58())
    throw new Error("Current authority changed; review before retrying");
  if (next.publicKey.toBase58() === current)
    throw new Error("Replacement equals current authority");
  const ix =
    v.role === "issuer"
      ? instruction("rotateFaucetIssuer", {
          admin: admin.publicKey,
          newIssuer: next.publicKey,
          config: configAddress,
        })
      : instruction("rotatePublisher", {
          admin: admin.publicKey,
          newPublisher: next.publicKey,
          config: configAddress,
          rewards: rewardsPda,
        });
  const tx = new Transaction().add(ix);
  const signers = admin.publicKey.equals(next.publicKey)
    ? [admin]
    : [admin, next];
  const simulated = await c.simulateTransaction(tx, signers);
  if (simulated.value.err)
    throw new Error(
      "Rotation simulation rejected; check signers and deployment",
    );
  if (!v.send) {
    console.log(
      JSON.stringify({
        status: "SIMULATED_ONLY",
        role: v.role,
        old: current,
        new: next.publicKey.toBase58(),
      }),
    );
    return;
  }
  const signature = await sendAndConfirmTransaction(c, tx, signers, {
    commitment: "finalized",
  });
  const actual =
    v.role === "issuer"
      ? (await readConfig(c, "finalized"))?.faucetIssuer.toBase58()
      : (await fetchRewards(c))?.publisher;
  if (actual !== next.publicKey.toBase58())
    throw new Error("Finalized authority mismatch");
  console.log(
    JSON.stringify({
      status: "FINALIZED",
      role: v.role,
      old: current,
      new: actual,
      signature,
    }),
  );
}
main().catch((e) => {
  console.error(String(e));
  process.exitCode = 1;
});
