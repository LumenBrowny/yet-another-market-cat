import { Buffer } from "node:buffer";
import console from "node:console";
import process from "node:process";
import { readFileSync, writeFileSync } from "node:fs";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { verifyLive } from "./live-signer.mjs";
async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== "--send")
    throw Error("Explicit --send required for this LOCAL test");
  const policy = JSON.parse(readFileSync(".dev/offline-live-current.json"));
  const identity = JSON.parse(
    readFileSync("temp/offline-signer-return/identity.public.json"),
  );
  const original = JSON.parse(
    readFileSync(policy.directory + "/request.live.json"),
  );
  const result = JSON.parse(
    readFileSync("temp/offline-signer-live-return/result.live.json"),
  );
  if (policy.rpc !== "http://127.0.0.1:8993") throw Error("Wrong RPC");
  for (const key of Object.keys(original))
    if (original[key] !== result[key]) throw Error("Returned request changed");
  verifyLive(result, identity, {
    ...policy,
    kind: "YAMC_LOCAL_LIVE_ROTATION_V1",
  });
  const tx = Transaction.from(Buffer.from(result.transactionBase64, "base64"));
  if (!tx.verifySignatures()) throw Error("Signature verification failed");
  const c = new Connection(policy.rpc, "finalized");
  if ((await c.getGenesisHash()) !== policy.genesis)
    throw Error("Ledger changed");
  const coder = new BorshAccountsCoder(
    JSON.parse(readFileSync("packages/shared/src/idl.json")),
  );
  const get = async () => {
    const account = await c.getAccountInfo(
      new PublicKey(policy.config),
      "finalized",
    );
    if (!account?.owner.equals(new PublicKey(policy.programId)))
      throw Error("Wrong Config owner");
    return {
      data: account.data,
      decoded: coder.decode("config", account.data),
    };
  };
  const before = await get();
  if (
    before.decoded.admin.toBase58() !== identity.admin ||
    before.decoded.faucetIssuer.toBase58() !== policy.oldIssuer
  )
    throw Error("Authority changed; do not resend blindly");
  const elapsedMs = Date.now() - original.preparedAtMs;
  const height = await c.getBlockHeight("confirmed");
  if (
    height > original.lastValidBlockHeight ||
    !(await c.isBlockhashValid(original.blockhash, "confirmed")).value
  ) {
    const report = {
      status: "EXPIRED_NOT_SENT",
      elapsedMs,
      currentBlockHeight: height,
      lastValidBlockHeight: original.lastValidBlockHeight,
    };
    writeFileSync(
      policy.directory + "/result-report.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  // Signed simulation validates both signatures before any submission.
  const simulated = await globalThis.fetch(policy.rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "simulateTransaction",
      params: [
        result.transactionBase64,
        { encoding: "base64", sigVerify: true, commitment: "confirmed" },
      ],
    }),
  }).then((r) => r.json());
  if (simulated.error || simulated.result?.value?.err)
    throw Error("Signed simulation failed");
  const signature = await c.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 0,
  });
  writeFileSync(
    policy.directory + "/submission.json",
    JSON.stringify(
      { signature, elapsedMs, status: "SUBMITTED_CHECK_BEFORE_RETRY" },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: "SUBMITTED", signature, elapsedMs }));
  const confirmation = await c.confirmTransaction(
    {
      signature,
      blockhash: original.blockhash,
      lastValidBlockHeight: original.lastValidBlockHeight,
    },
    "finalized",
  );
  if (confirmation.value.err) throw Error("Finalized transaction failed");
  const after = await get();
  const expected = Buffer.from(before.data);
  new PublicKey(identity.newIssuer)
    .toBuffer()
    .copy(expected, expected.length - 32);
  if (
    !expected.equals(after.data) ||
    after.decoded.faucetIssuer.toBase58() !== identity.newIssuer
  )
    throw Error("Finalized Config mismatch");
  const report = {
    status: "FINALIZED_LOCAL_ROTATION",
    signature,
    elapsedMs,
    genesis: policy.genesis,
    oldIssuer: policy.oldIssuer,
    newIssuer: identity.newIssuer,
    onlyIssuerChanged: true,
  };
  writeFileSync(
    policy.directory + "/result-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
main().catch(() => {
  console.error(
    "STOP: input/state/simulation/submission check failed. Check local submission.json and signature status before any retry. Never replace keys or resend blindly.",
  );
  process.exitCode = 1;
});
