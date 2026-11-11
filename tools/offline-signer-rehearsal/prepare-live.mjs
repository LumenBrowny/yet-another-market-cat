// Run on the connected development PC, not on the offline signer.
import { Buffer } from "node:buffer";
import console from "node:console";
import process from "node:process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { expectedMessage, publicBytes, sha256 } from "./signer.mjs";
import { inspectLive } from "./live-signer.mjs";

async function main() {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !["--prepare", "--check"].includes(mode))
    throw Error("Use --check or --prepare");
  const policy = JSON.parse(readFileSync(".dev/offline-live-current.json"));
  const identity = JSON.parse(
    readFileSync("temp/offline-signer-return/identity.public.json"),
  );
  const livePolicy = { ...policy, kind: "YAMC_LOCAL_LIVE_ROTATION_V1" };
  if (policy.rpc !== "http://127.0.0.1:8993")
    throw Error("Only pinned local RPC");
  const c = new Connection(policy.rpc, "finalized");
  if ((await c.getGenesisHash()) !== policy.genesis)
    throw Error("Ledger changed");
  const info = await c.getAccountInfo(new PublicKey(policy.config));
  if (!info?.owner.equals(new PublicKey(policy.programId)))
    throw Error("Wrong Config owner");
  const idl = JSON.parse(readFileSync("packages/shared/src/idl.json"));
  if (idl.address !== policy.programId) throw Error("Wrong IDL");
  const config = new BorshAccountsCoder(idl).decode("config", info.data);
  if (
    config.admin.toBase58() !== identity.admin ||
    config.faucetIssuer.toBase58() !== policy.oldIssuer ||
    !config.launchMode ||
    config.activatedAt.toString() === "0"
  )
    throw Error("Unexpected current state");
  const latest = await c.getLatestBlockhash("confirmed");
  const message = expectedMessage(identity);
  publicBytes(latest.blockhash).copy(message, 132);
  const request = {
    kind: livePolicy.kind,
    genesis: policy.genesis,
    oldIssuer: policy.oldIssuer,
    ...latest,
    preparedAtMs: Date.now(),
    messageBase64: message.toString("base64"),
    messageSha256: sha256(message),
  };
  inspectLive(request, identity, livePolicy);
  const unsigned = Buffer.concat([
    Buffer.from([2]),
    Buffer.alloc(128),
    message,
  ]);
  const tx = Transaction.from(unsigned);
  if (tx.instructions.length !== 1) throw Error("Wrong message");
  const simulated = await globalThis
    .fetch(policy.rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "simulateTransaction",
        params: [
          unsigned.toString("base64"),
          {
            encoding: "base64",
            sigVerify: false,
            commitment: "confirmed",
            accounts: { encoding: "base64", addresses: [policy.config] },
          },
        ],
      }),
    })
    .then((r) => r.json());
  if (simulated.error || simulated.result?.value?.err)
    throw Error("Local simulation failed");
  const after = simulated.result?.value?.accounts?.[0];
  const expected = Buffer.from(info.data);
  new PublicKey(identity.newIssuer)
    .toBuffer()
    .copy(expected, expected.length - 32);
  if (
    !after ||
    after.owner !== policy.programId ||
    !Buffer.from(after.data[0], "base64").equals(expected)
  )
    throw Error("Simulation changed unexpected Config fields");
  if (mode === "--check") {
    console.log(
      "PASS: local genesis, authority, Config, and unsigned rotation simulation. No request exported or transaction sent.",
    );
    return;
  }
  const output = "temp/offline-live-export";
  mkdirSync(output, { recursive: true });
  if (existsSync(output + "/request.live.json"))
    throw Error(
      "Previous request exists; archive it before a new timed attempt",
    );
  writeFileSync(
    output + "/request.live.json",
    JSON.stringify(request, null, 2) + "\n",
    { flag: "wx" },
  );
  writeFileSync(
    policy.directory + "/request.live.json",
    JSON.stringify(request, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify(
      {
        status: "READY_FOR_TIMED_TRANSFER",
        file: output + "/request.live.json",
        ...latest,
        preparedAtMs: request.preparedAtMs,
        messageSha256: request.messageSha256,
      },
      null,
      2,
    ),
  );
}
main().catch(() => {
  console.error(
    "FAILED: local state/policy/simulation or existing request. No transaction sent.",
  );
  process.exitCode = 1;
});
