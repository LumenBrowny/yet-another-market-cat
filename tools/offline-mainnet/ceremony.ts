// Explicit online co-sign / send / status commands; no default private keys.
import {
  readFileSync,
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { Connection } from "@solana/web3.js";
import { cosignReviewed } from "./cosign";
import { fileAttemptStore, submitOnce, reconcileAttempt } from "./submission";

function read(file: string) {
  const data = readFileSync(file);
  if (data.length > 65536) throw Error("Oversize JSON");
  return JSON.parse(data.toString("utf8"));
}
function save(file: string, data: string | Buffer) {
  const fd = openSync(file, "wx", 0o600);
  try {
    writeFileSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
async function main() {
  const [mode, dir, pinsFile, elfFile, limitsFile, ...args] =
    process.argv.slice(2);
  if (!limitsFile || !["cosign", "send", "status"].includes(mode))
    throw Error("Arguments");
  // cosign: REVIEW MSG_HASH PINS_HASH PAYER UPLOAD_OR_DASH ADMIN_RESULT [PROGRAM_RESULT]
  if (
    (mode === "cosign" && ![6, 7].includes(args.length)) ||
    (mode === "send" && args.length !== 2) ||
    (mode === "status" && args.length)
  )
    throw Error("Arguments");
  const endpoint = process.env.YAMC_MAINNET_REVIEW_RPC;
  if (!endpoint) throw Error("Missing RPC");
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw Error("HTTPS required");
  const rpc = new Connection(endpoint, {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      }),
  });
  const pins = read(pinsFile),
    elf = readFileSync(elfFile),
    limits = read(limitsFile);
  if (elf.length > 10 * 1024 * 1024) throw Error("ELF size");
  if (mode === "cosign") {
    const [reviewFile, messageSha256, pinsSha256, payer, upload, ...results] =
      args;
    const prepared = read(reviewFile);
    if ((prepared.request.operation === "deploy") !== (upload === "-"))
      throw Error("Online role arguments");
    mkdirSync(dir); // Reserve unique operation directory BEFORE reading keys.
    const raw = await cosignReviewed(
      rpc,
      pins,
      elf,
      prepared,
      results.map(read),
      limits,
      { messageSha256, pinsSha256 },
      (role) => read(role === "payer" ? payer : upload),
    );
    save(join(dir, "review.json"), JSON.stringify(prepared, null, 2));
    save(join(dir, "signed.bin"), raw);
    // Marker written last; incomplete output must not be submitted.
    save(
      join(dir, "ready.json"),
      JSON.stringify({ messageSha256, pinsSha256 }),
    );
    console.log(
      "COSIGNED_NOT_SENT. Keep this operation directory for send and status.",
    );
    return;
  }
  const approval = read(join(dir, "ready.json"));
  const prepared = read(join(dir, "review.json")),
    raw = readFileSync(join(dir, "signed.bin"));
  const store = fileAttemptStore(join(dir, "attempt.json"));
  if (mode === "send" && existsSync(join(dir, "attempt.json")))
    throw Error("Attempt exists; use status");
  if (
    mode === "send" &&
    (args[0] !== approval.messageSha256 || args[1] !== approval.pinsSha256)
  )
    throw Error("Approval mismatch");
  const result =
    mode === "send"
      ? await submitOnce(rpc, pins, elf, prepared, raw, limits, store, approval)
      : await reconcileAttempt(rpc, pins, elf, prepared, raw, store);
  save(
    join(dir, `${mode}-${Date.now()}.json`),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
}
main().catch(() => {
  console.error(
    "CEREMONY_FAILED. Details suppressed to protect credentials. If attempt.json exists, delivery may have occurred: use status; do not resend or recreate the operation directory.",
  );
  process.exitCode = 1;
});
