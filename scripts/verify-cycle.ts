import { readFile } from "node:fs/promises";
import { verifyCycleReport } from "./cycle-verifier";
async function main() {
  const path = process.argv[2];
  if (!path)
    throw new Error("verify-cycle <manifest.json> [--rpc URL --start-slot N]");
  const rpcIndex = process.argv.indexOf("--rpc"),
    slotIndex = process.argv.indexOf("--start-slot");
  const report = await verifyCycleReport(
    await readFile(path, "utf8"),
    rpcIndex >= 0 ? process.argv[rpcIndex + 1] : undefined,
    slotIndex >= 0 ? Number(process.argv[slotIndex + 1]) : undefined,
  );
  const valid =
    rpcIndex >= 0 ? report.result === "VALID" : report.internalConsistency;
  console.log(
    JSON.stringify(
      {
        ...report,
        valid,
        chainRecalculated: report.chainRecomputation,
        root: report.recomputedRoot,
      },
      null,
      2,
    ),
  );
  if (!valid) {
    console.error(
      report.checks
        .filter((c) => c.status === "FAIL" || c.status === "UNAVAILABLE")
        .map((c) => `${c.label}: ${c.detail ?? c.status}`)
        .join("; "),
    );
    process.exitCode = 1;
  }
}
main().catch((e) => {
  console.error(String(e));
  process.exitCode = 1;
});
