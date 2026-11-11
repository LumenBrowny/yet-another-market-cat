import { DatabaseSync } from "node:sqlite";
import process from "node:process";
import console from "node:console";
import { snapshot } from "./snapshot.mjs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, linkSync, unlinkSync } from "node:fs";
export async function restore(source, destination) {
  destination = resolve(destination);
  const staged = destination + ".restore.partial";
  if (existsSync(destination) || existsSync(staged))
    throw new Error("Fresh restore destination required");
  await snapshot(source, staged);
  try {
    const db = new DatabaseSync(staged);
    try {
      // Publish no restored database until old authorizations are invalidated.
      db.exec(
        "PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE; UPDATE challenges SET consumed=1,captcha=0; COMMIT;",
      );
    } finally {
      db.close();
    }
    linkSync(staged, destination);
  } finally {
    unlinkSync(staged);
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.umask(0o077);
  try {
    if (process.argv.length !== 4) throw new Error("Arguments required");
    await restore(process.argv[2], process.argv[3]);
    console.log(
      "ADMISSION_RESTORE_OK; old challenges invalidated; keep issuer stopped until chain reconciliation",
    );
  } catch {
    console.error("ADMISSION_RESTORE_FAILED; do not start issuer");
    process.exitCode = 1;
  }
}
