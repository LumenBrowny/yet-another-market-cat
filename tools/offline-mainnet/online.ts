// Read-only CLI. RPC endpoint is private environment input, never exported.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Connection } from "@solana/web3.js";
import { prepareReview, checkReturnedSignatures } from "./online-review";
function read(file: string) {
  const b = readFileSync(file);
  if (b.length > 65536) throw Error("Oversize JSON");
  return JSON.parse(b.toString("utf8"));
}
async function main() {
  const [mode, subject, pinsFile, elfFile, limitsFile, out, ...resultFiles] =
    process.argv.slice(2);
  if (
    !out ||
    !["prepare", "check"].includes(mode) ||
    (mode === "prepare" &&
      (resultFiles.length || !["accept-buffer", "deploy"].includes(subject))) ||
    (mode === "check" && !resultFiles.length)
  )
    throw Error("Arguments");
  const endpoint = process.env.YAMC_MAINNET_REVIEW_RPC;
  if (!endpoint) throw Error("Missing RPC");
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw Error("HTTPS RPC required");
  // Suppress SDK HTTP retries and credential-bearing exception logging.
  const rpc = new Connection(endpoint, {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
    fetch: async (input, init) =>
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
  const result =
    mode === "prepare"
      ? await prepareReview(
          rpc,
          pins,
          elf,
          subject as "accept-buffer" | "deploy",
          limits,
        )
      : await checkReturnedSignatures(
          rpc,
          pins,
          elf,
          read(subject),
          resultFiles.map(read),
          limits,
        );
  mkdirSync(out); // Never overwrite an earlier request/result directory.
  const save = (name: string, value: unknown) =>
    writeFileSync(join(out, name), JSON.stringify(value, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  save("review.json", result);
  if ("request" in result) save("request.json", result.request);
  console.log(
    mode === "prepare"
      ? "PREPARED_FOR_REVIEW. No signatures or transactions sent."
      : "RETURNED_SIGNATURES_CHECKED. Partial transaction saved; no online signatures or send.",
  );
}
main().catch(() => {
  console.error(
    "REVIEW_FAILED. Check local inputs, state and RPC availability. Endpoint/error details suppressed to protect credentials. Nothing sent.",
  );
  process.exitCode = 1;
});
