// Offline CLI: fixed trusted paths; no RPC, wallet connection or send method.
import { readFileSync, writeFileSync } from "node:fs";
import { reviewRequest, signRequest, type OfflineRole } from "./signing";
function read(path: string, limit = 32768) {
  const bytes = readFileSync(path);
  if (bytes.length > limit) throw Error("Input too large");
  return JSON.parse(bytes.toString("utf8"));
}
try {
  const [
    mode,
    requestFile,
    role,
    keyFile,
    messageHash,
    pinsHash,
    output,
    ...extra
  ] = process.argv.slice(2);
  if (
    extra.length ||
    !requestFile ||
    (mode !== "review" && mode !== "sign") ||
    (mode === "review" && role !== undefined) ||
    (mode === "sign" &&
      (!output ||
        !keyFile ||
        !messageHash ||
        !pinsHash ||
        !["admin", "program"].includes(role)))
  )
    throw Error("Arguments");
  const p = read("trusted/deployment-pins.json"),
    r = read(requestFile);
  const elf = readFileSync("trusted/cat_shit_mining.so");
  const review = reviewRequest(p, r, elf);
  console.log(JSON.stringify(review, null, 2));
  if (mode === "sign") {
    const result = signRequest(
      p,
      r,
      elf,
      role as OfflineRole,
      read(keyFile, 4096),
      messageHash,
      pinsHash,
    );
    writeFileSync(output, JSON.stringify(result, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log(
      "PARTIAL_SIGNATURE_WRITTEN. Nothing sent. Keep private key files offline.",
    );
  }
} catch {
  console.error(
    "FAILED: invalid arguments, policy/request/key mismatch or output already exists. Nothing sent. Do not share private key files.",
  );
  process.exitCode = 1;
}
