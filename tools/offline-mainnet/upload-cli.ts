import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Connection } from "@solana/web3.js";
import { advanceUpload, fileUploadJournal } from "./upload";
function read(file: string) {
  const b = readFileSync(file);
  if (b.length > 65536) throw Error("Oversize JSON");
  return JSON.parse(b.toString("utf8"));
}
async function main() {
  const [
    directory,
    pinsFile,
    elfFile,
    planFile,
    keyDirectory,
    approval,
    ...extra
  ] = process.argv.slice(2);
  if (!approval || extra.length) throw Error("Arguments");
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
  const elf = readFileSync(elfFile);
  if (elf.length > 10 * 1024 * 1024) throw Error("ELF size");
  if (!existsSync(directory)) mkdirSync(directory);
  const result = await advanceUpload(
    rpc,
    read(pinsFile),
    elf,
    read(planFile),
    fileUploadJournal(directory),
    approval,
    (role) =>
      read(
        join(
          keyDirectory,
          `${role === "bufferAuthority" ? "uploadAuthority" : role}.json`,
        ),
      ),
  );
  console.log(JSON.stringify(result));
}
main().catch(() => {
  console.error(
    "UPLOAD_STOPPED. RPC details suppressed. Keep the original journal. An existing attempt may have been sent; never delete it or change directories to retry.",
  );
  process.exitCode = 1;
});
