import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  fileAttemptStore,
  type Attempt,
} from "../tools/offline-mainnet/submission";
test("attempt journal persists and refuses replacement", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yamc-attempt-test-")),
    file = path.join(dir, "attempt.json");
  const record: Attempt = {
    schema: "yamc-deployment-attempt-v1",
    pinsSha256: "pins",
    messageSha256: "message",
    wireSha256: "wire",
    signature: "signature",
    nonce: "nonce",
    operation: "deploy",
    preparedSlot: 100,
  };
  try {
    const store = fileAttemptStore(file);
    store.create(record);
    assert.deepEqual(fileAttemptStore(file).read(), record);
    assert.throws(() => store.create({ ...record, signature: "different" }));
    assert.deepEqual(store.read(), record);
    assert.throws(() =>
      fileAttemptStore(path.join(dir, "absent", "attempt.json")).create(record),
    );
  } finally {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
});
