import { readFileSync, writeFileSync } from "node:fs";
import { reviewInitialization } from "./initialization-policy";
import {
  signInitialization,
  type InitializationRole,
} from "./initialization-signing";
const read = (p: string) => {
  const b = readFileSync(p);
  if (b.length > 32768) throw Error("Input too large");
  return JSON.parse(b.toString("utf8"));
};
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
    !["review", "sign"].includes(mode) ||
    (mode === "review" && role !== undefined) ||
    (mode === "sign" &&
      (!output ||
        !keyFile ||
        !messageHash ||
        !pinsHash ||
        !["admin", "mint"].includes(role)))
  )
    throw Error("Arguments");
  const pins = read("trusted/initialization-pins.json"),
    request = read(requestFile),
    elf = readFileSync("trusted/cat_shit_mining.so");
  console.log(
    JSON.stringify(reviewInitialization(pins, request, elf), null, 2),
  );
  if (mode === "sign") {
    const result = signInitialization(
      pins,
      request,
      elf,
      role as InitializationRole,
      read(keyFile),
      messageHash,
      pinsHash,
    );
    writeFileSync(output, JSON.stringify(result, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log("INITIALIZATION_PARTIAL_SIGNATURE_WRITTEN. Nothing sent.");
  }
} catch {
  console.error(
    "INITIALIZATION_FAILED. Check inputs, trusted pins and role. No transaction sent.",
  );
  process.exitCode = 1;
}
