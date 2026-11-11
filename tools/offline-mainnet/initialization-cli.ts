// No private keys. Assemble offline signatures, then explicitly send once.
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
import {
  prepareInitialization,
  assembleInitialization,
  initializationStore,
  submitInitializationOnce,
  reconcileInitialization,
} from "./initialization-online";
function read(file: string) {
  const b = readFileSync(file);
  if (b.length > 65536) throw Error("Oversize JSON");
  return JSON.parse(b.toString("utf8"));
}
function save(file: string, value: Buffer | unknown) {
  const fd = openSync(file, "wx", 0o600);
  try {
    writeFileSync(
      fd,
      Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + "\n",
    );
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
async function main() {
  const [mode, subject, pinsFile, elfFile, limitsFile, ...args] =
    process.argv.slice(2);
  if (
    !limitsFile ||
    !["prepare", "assemble", "send", "status"].includes(mode) ||
    (mode === "prepare" &&
      (!["initialize", "rewards"].includes(subject) || args.length !== 1)) ||
    (mode === "assemble" && ![2, 3].includes(args.length)) ||
    (mode === "send" && args.length !== 2) ||
    (mode === "status" && args.length !== 0)
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
    fetch: (i, o) =>
      fetch(i, { ...o, redirect: "error", signal: AbortSignal.timeout(20000) }),
  });
  const p = read(pinsFile),
    elf = readFileSync(elfFile),
    limits = read(limitsFile);
  if (elf.length > 10 * 1024 * 1024) throw Error("Oversize ELF");
  if (mode === "prepare") {
    const review = await prepareInitialization(
      rpc,
      p,
      elf,
      subject as "initialize" | "rewards",
      limits,
    );
    mkdirSync(args[0]);
    save(join(args[0], "review.json"), review);
    save(join(args[0], "request.json"), review.request);
    console.log("INITIALIZATION_PREPARED_NOT_SIGNED_OR_SENT");
    return;
  }
  if (mode === "assemble") {
    const prepared = read(subject),
      raw = await assembleInitialization(
        rpc,
        p,
        elf,
        prepared,
        args.slice(1).map(read),
        limits,
      );
    mkdirSync(args[0]);
    save(join(args[0], "review.json"), prepared);
    save(join(args[0], "signed.bin"), raw);
    save(join(args[0], "ready.json"), {
      messageSha256: prepared.request.messageSha256,
      pinsSha256: prepared.pinsSha256,
    });
    console.log("INITIALIZATION_ASSEMBLED_NOT_SENT");
    return;
  }
  const ready = read(join(subject, "ready.json")),
    prepared = read(join(subject, "review.json")),
    raw = readFileSync(join(subject, "signed.bin")),
    journal = initializationStore(join(subject, "attempt.json"));
  if (
    mode === "send" &&
    (existsSync(join(subject, "attempt.json")) ||
      args[0] !== ready.messageSha256 ||
      args[1] !== ready.pinsSha256)
  )
    throw Error("Existing attempt or missing approval");
  const result =
    mode === "send"
      ? await submitInitializationOnce(
          rpc,
          p,
          elf,
          prepared,
          raw,
          limits,
          journal,
          ready,
        )
      : await reconcileInitialization(rpc, p, elf, prepared, raw, journal);
  save(join(subject, `${mode}-${Date.now()}.json`), result);
  console.log(JSON.stringify(result));
}
main().catch(() => {
  console.error(
    "INITIALIZATION_STOPPED. Credential details suppressed. If attempt.json exists, use status only: never delete journal or change directories to retry.",
  );
  process.exitCode = 1;
});
