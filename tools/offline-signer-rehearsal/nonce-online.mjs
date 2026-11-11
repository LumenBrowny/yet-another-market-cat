// Connected PC only. Hard pinned to the disposable local validator.
import { Buffer } from "node:buffer";
import console from "node:console";
import process from "node:process";
import { setTimeout } from "node:timers";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import {
  Connection,
  PublicKey,
  SystemProgram,
  NonceAccount,
  Transaction,
} from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { base58, sha256 } from "./signer.mjs";
import { nonceMessage, inspectNonce } from "./nonce-message.mjs";
import { verifyNonce } from "./nonce-signer.mjs";
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const save = (p, v, exclusive = false) =>
  writeFileSync(
    p,
    JSON.stringify(v, null, 2) + "\n",
    exclusive ? { flag: "wx" } : {},
  );
export function checkedNonce(info, policy) {
  if (
    !info ||
    info.executable ||
    !info.owner.equals(SystemProgram.programId) ||
    info.data.length !== 80 ||
    info.data.readUInt32LE(0) !== 1 ||
    info.data.readUInt32LE(4) !== 1
  )
    throw Error("Invalid nonce account");
  const nonce = NonceAccount.fromAccountData(info.data);
  if (nonce.authorizedPubkey.toBase58() !== policy.nonceAuthority)
    throw Error("Nonce authority changed");
  return nonce;
}
async function main() {
  const mode = process.argv[2];
  if (
    process.argv.length !== 3 ||
    !["--prepare", "--send", "--status"].includes(mode)
  )
    throw Error("Use --prepare, --send or --status");
  const meta = read(".dev/offline-live-current.json"),
    policy = read(meta.directory + "/nonce-meta.json");
  const identity = read("temp/offline-signer-return/identity.public.json");
  if (
    meta.rpc !== "http://127.0.0.1:8993" ||
    policy.rpc !== meta.rpc ||
    policy.genesis !== meta.genesis
  )
    throw Error("Local pin mismatch");
  const message = nonceMessage(identity, policy),
    c = new Connection(policy.rpc, "finalized");
  if ((await c.getGenesisHash()) !== policy.genesis)
    throw Error("Ledger changed");
  const idl = read("packages/shared/src/idl.json");
  if (idl.address !== policy.programId) throw Error("Wrong IDL");
  const coder = new BorshAccountsCoder(idl);
  const state = async () => {
    const s = await c.getMultipleAccountsInfoAndContext(
      [new PublicKey(policy.nonceAccount), new PublicKey(policy.config)],
      { commitment: "finalized", minContextSlot: policy.nonceContextSlot },
    );
    const nonce = checkedNonce(s.value[0], policy),
      config = s.value[1];
    if (!config || !config.owner.equals(new PublicKey(policy.programId)))
      throw Error("Wrong Config owner");
    const decoded = coder.decode("config", config.data);
    if (
      decoded.admin.toBase58() !== identity.admin ||
      !decoded.launchMode ||
      decoded.activatedAt.toString() === "0"
    )
      throw Error("Wrong Config/admin");
    return { nonce, config, decoded, slot: s.context.slot };
  };
  const originalPath = meta.directory + "/request.nonce.json",
    attemptPath = meta.directory + "/nonce-submission.json";
  const status = async () => {
    if (!existsSync(attemptPath)) {
      console.log("NO_SUBMISSION_ATTEMPT");
      return false;
    }
    const attempt = read(attemptPath),
      observed = await c.getSignatureStatuses([attempt.signature], {
        searchTransactionHistory: true,
      });
    const sig = observed.value[0];
    if (sig?.confirmationStatus === "finalized") {
      const after = await state(),
        before = Buffer.from(
          read(meta.directory + "/nonce-before.json").configBase64,
          "base64",
        );
      new PublicKey(identity.newIssuer)
        .toBuffer()
        .copy(before, before.length - 32);
      const success =
        !sig.err &&
        before.equals(after.config.data) &&
        after.nonce.nonce !== policy.nonceValue;
      const report = {
        status: success
          ? "FINALIZED_LOCAL_NONCE_ROTATION"
          : "FINALIZED_REQUIRES_REVIEW",
        signature: attempt.signature,
        transactionError: sig.err,
        nonceAdvanced: after.nonce.nonce !== policy.nonceValue,
        onlyIssuerChanged: before.equals(after.config.data),
        elapsedMs: attempt.elapsedMs,
      };
      save(meta.directory + "/nonce-result-report.json", report);
      console.log(JSON.stringify(report, null, 2));
      return true;
    }
    console.log(
      JSON.stringify({
        status: "PENDING_OR_UNKNOWN_DO_NOT_RESIGN",
        signature: attempt.signature,
        confirmationStatus: sig?.confirmationStatus ?? null,
      }),
    );
    return false;
  };
  if (mode === "--status") {
    await status();
    return;
  }
  if (mode === "--send" && existsSync(attemptPath)) {
    await status();
    return;
  }
  const before = await state();
  if (before.nonce.nonce !== policy.nonceValue) {
    console.log(
      "NONCE_CHANGED_NOT_SENT: reconcile before creating any new request",
    );
    return;
  }
  if (before.decoded.faucetIssuer.toBase58() !== policy.oldIssuer)
    throw Error("Issuer changed");
  const simulate = async (raw, sigVerify) => {
    const r = await globalThis
      .fetch(policy.rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "simulateTransaction",
          params: [
            raw,
            {
              encoding: "base64",
              sigVerify,
              commitment: "finalized",
              minContextSlot: before.slot,
              accounts: {
                encoding: "base64",
                addresses: [policy.config, policy.nonceAccount],
              },
            },
          ],
        }),
      })
      .then((r) => r.json());
    if (r.error || r.result?.value?.err) throw Error("Simulation failed");
    const [config, nonce] = r.result.value.accounts;
    const expected = Buffer.from(before.config.data);
    new PublicKey(identity.newIssuer)
      .toBuffer()
      .copy(expected, expected.length - 32);
    if (
      !config ||
      config.owner !== policy.programId ||
      !Buffer.from(config.data[0], "base64").equals(expected)
    )
      throw Error("Unexpected simulated Config");
    const advanced = checkedNonce(
      {
        ...nonce,
        owner: new PublicKey(nonce.owner),
        data: Buffer.from(nonce.data[0], "base64"),
      },
      policy,
    );
    if (advanced.nonce === policy.nonceValue)
      throw Error("Nonce did not advance in simulation");
  };
  if (mode === "--prepare") {
    if (
      existsSync(originalPath) ||
      existsSync("temp/offline-nonce-export/request.nonce.json")
    )
      throw Error("Request already exists");
    const request = {
      kind: policy.kind,
      genesis: policy.genesis,
      oldIssuer: policy.oldIssuer,
      nonceAccount: policy.nonceAccount,
      nonceAuthority: policy.nonceAuthority,
      nonceValue: policy.nonceValue,
      preparedAtMs: Date.now(),
      messageBase64: message.toString("base64"),
      messageSha256: sha256(message),
    };
    inspectNonce(request, identity, policy);
    await simulate(
      Buffer.concat([Buffer.from([2]), Buffer.alloc(128), message]).toString(
        "base64",
      ),
      false,
    );
    save(
      meta.directory + "/nonce-before.json",
      {
        configBase64: before.config.data.toString("base64"),
        slot: before.slot,
      },
      true,
    );
    save(originalPath, request, true);
    mkdirSync("temp/offline-nonce-export", { recursive: true });
    save("temp/offline-nonce-export/request.nonce.json", request, true);
    console.log(
      "READY: temp/offline-nonce-export/request.nonce.json; nonce remains valid until advanced. No rotation sent.",
    );
    return;
  }
  const original = read(originalPath),
    result = read("temp/offline-signer-nonce-return/result.nonce.json");
  for (const key of Object.keys(original))
    if (original[key] !== result[key]) throw Error("Returned request changed");
  verifyNonce(result, identity, policy);
  const tx = Transaction.from(Buffer.from(result.transactionBase64, "base64"));
  if (!tx.verifySignatures()) throw Error("Bad signatures");
  await simulate(result.transactionBase64, true);
  const signature = base58(tx.signatures[0].signature);
  save(
    attemptPath,
    {
      signature,
      elapsedMs: Date.now() - original.preparedAtMs,
      status: "ATTEMPT_RECORDED_BEFORE_RPC",
    },
    true,
  );
  const sent = await c.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "finalized",
    minContextSlot: before.slot,
    maxRetries: 0,
  });
  if (sent !== signature) throw Error("RPC signature mismatch");
  console.log(JSON.stringify({ status: "SUBMITTED_LOCAL_NONCE", signature }));
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await status()) return;
  }
  console.log(
    "Still uncertain: use --status, never create a replacement request blindly.",
  );
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/nonce-online.mjs"))
  main().catch(() => {
    console.error(
      "STOP: local input/state/simulation/RPC check failed. If nonce-submission.json exists use --status. No automatic replacement or resend.",
    );
    process.exitCode = 1;
  });
