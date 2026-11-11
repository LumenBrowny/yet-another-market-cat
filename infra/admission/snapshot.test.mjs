import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshot } from "./snapshot.mjs";
import { restore } from "./restore.mjs";
test("online WAL backup preserves committed state and restore invalidates authorizations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yamc-admission-"));
  const source = join(dir, "live.db"),
    copy = join(dir, "backup.db"),
    out = join(dir, "restored.db");
  const live = new DatabaseSync(source);
  try {
    live.exec(
      "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE challenges(nonce TEXT PRIMARY KEY,consumed INTEGER,captcha INTEGER); CREATE TABLE limits(key TEXT PRIMARY KEY,hits INTEGER); INSERT INTO challenges VALUES('pending',0,1),('used',1,0); INSERT INTO limits VALUES('salted-key',9);",
    );
    await snapshot(source, copy);
    live.exec("INSERT INTO limits VALUES('after-backup',1);");
    const before = readFileSync(copy);
    await assert.rejects(snapshot(source, copy));
    assert.deepEqual(readFileSync(copy), before);
    await restore(copy, out);
    const restored = new DatabaseSync(out, { readOnly: true });
    try {
      assert.equal(
        restored
          .prepare(
            "SELECT count(*) AS n FROM challenges WHERE consumed=0 OR captcha!=0",
          )
          .get().n,
        0,
      );
      assert.equal(restored.prepare("SELECT hits FROM limits").get().hits, 9);
      assert.equal(
        restored.prepare("SELECT count(*) AS n FROM limits").get().n,
        1,
      );
    } finally {
      restored.close();
    }
    assert.equal(
      live
        .prepare("SELECT consumed FROM challenges WHERE nonce='pending'")
        .get().consumed,
      0,
    );
  } finally {
    live.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
