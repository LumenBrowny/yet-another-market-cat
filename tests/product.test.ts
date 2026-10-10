import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAppConfiguration } from "../packages/shared/src/app-config";
import {
  verifyCycleReport,
  verifyCyclesReport,
  recomputePoints,
} from "../scripts/cycle-verifier";
import vectors from "../protocol/settlement-vectors.json";
test("Standalone profiles reject emulator, credentials, mainnet and insecure staging", () => {
  const base = {
    profile: "local",
    cluster: "localnet",
    apiUrl: "http://192.168.1.2:5080",
    rpcUrl: "http://192.168.1.2:9099",
    standalone: true,
  };
  assert.equal(parseAppConfiguration(base).cluster, "localnet");
  for (const change of [
    { rpcUrl: "http://10.0.2.2:9099" },
    { apiUrl: "http://localhost:5080" },
    { apiUrl: "http://user:secret@example.com" },
    { cluster: "mainnet-beta" },
    { apiUrl: "" },
    { profile: "staging", cluster: "devnet" },
  ])
    assert.throws(() => parseAppConfiguration({ ...base, ...change }));
  assert.equal(
    parseAppConfiguration({
      profile: "staging",
      cluster: "devnet",
      rpcUrl: "https://api.devnet.solana.com",
      apiUrl: "https://example.com",
      standalone: true,
    }).demoControls,
    false,
  );
  assert.throws(() =>
    parseAppConfiguration({
      profile: "staging",
      cluster: "devnet",
      apiUrl: "https://example.com",
      demoControls: "true",
    }),
  );
});
test("Internal consistency without chain history is UNVERIFIABLE, never VALID", async () => {
  const report = await verifyCycleReport(vectors[3].canonical);
  assert.equal(report.result, "UNVERIFIABLE");
  assert(report.internalConsistency);
  assert(!report.chainRecomputation);
  assert(report.checks.some((c) => c.status === "UNAVAILABLE"));
});
test("Malformed/tampered/noncanonical manifests have concrete INVALID checks", async () => {
  for (const input of [
    "{",
    vectors[3].canonical + "\n",
    vectors[3].canonical.replace(
      vectors[3].manifest.merkleRoot,
      "00".repeat(32),
    ),
  ]) {
    const report = await verifyCycleReport(input);
    assert.equal(report.result, "INVALID");
    assert(report.checks.some((c) => c.status === "FAIL"));
  }
});
test("Independent verifier empty history gives zero miners", () =>
  assert.deepEqual(recomputePoints([], 1000, 1100), []));
test("Batch RPC failure preserves INVALID for tampering and never asserts VALID", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    throw new Error("offline");
  });
  const reports = await verifyCyclesReport(
    [vectors[3].canonical, "{"],
    "http://rpc.invalid",
    1,
  );
  assert.equal(reports.length, 2);
  assert.equal(reports[0].result, "UNVERIFIABLE");
  assert.equal(reports[1].result, "INVALID");
  assert(reports.every((r) => !r.chainRecomputation));
  assert.equal(requests, 2); // One replay's parallel genesis/tip reads, no per-cycle replay.
});
test("Unavailable RPC does not turn an internally valid manifest into VALID or INVALID", async () => {
  const report = await verifyCycleReport(
    vectors[3].canonical,
    "http://127.0.0.1:1",
    1,
  );
  assert.equal(report.result, "UNVERIFIABLE");
  assert(report.internalConsistency);
  assert(!report.chainRecomputation);
  assert(
    report.checks.some((c) => c.id === "rpc" && c.status === "UNAVAILABLE"),
  );
});
