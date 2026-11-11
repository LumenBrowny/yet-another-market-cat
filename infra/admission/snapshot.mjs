// Consistent online SQLite snapshot, including committed WAL. No key/config logging.
import process from "node:process";
import console from "node:console";
import { DatabaseSync, backup } from "node:sqlite";
import { existsSync, linkSync, chmodSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export async function snapshot(source, destination) {
  source = resolve(source);
  destination = resolve(destination);
  const part = destination + ".partial";
  if (
    source === destination ||
    !existsSync(source) ||
    existsSync(destination) ||
    existsSync(part)
  )
    throw new Error("Snapshot paths must be fresh and separate");
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, part);
    chmodSync(part, 0o600);
    const check = new DatabaseSync(part, { readOnly: true });
    try {
      if (
        check.prepare("PRAGMA integrity_check").get().integrity_check !== "ok"
      )
        throw new Error("Integrity check failed");
    } finally {
      check.close();
    }
    linkSync(part, destination);
    unlinkSync(part);
  } catch (error) {
    if (existsSync(part)) unlinkSync(part);
    throw error;
  } finally {
    db.close();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.umask(0o077);
  try {
    if (process.argv.length !== 4) throw new Error("Arguments required");
    await snapshot(process.argv[2], process.argv[3]);
    console.log("ADMISSION_SNAPSHOT_OK");
  } catch {
    console.error("ADMISSION_SNAPSHOT_FAILED");
    process.exitCode = 1;
  }
}
