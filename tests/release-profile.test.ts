import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import { reviewProfile } from "../scripts/release/check-mainnet-profile";
const fixture = () =>
  JSON.parse(
    readFileSync("infra/mainnet/release-profile.template.json", "utf8"),
  );
test("mainnet draft stays blocked and never grants transaction authorization", () => {
  const r = reviewProfile(fixture());
  assert.equal(r.status, "BLOCKED_INCOMPLETE");
  assert.equal(r.transactionAuthorization, false);
  assert(r.blockers.includes("addresses.admin"));
  assert(r.blockers.includes("evidence.independentBuildVerification"));
});
test("mainnet review rejects automatic launch, wrong economics and reused test identities", () => {
  for (const field of ["deployAutomatically", "activateAutomatically"]) {
    const p = fixture();
    p[field] = true;
    assert.throws(() => reviewProfile(p));
  }
  const p = fixture();
  p.economics.faucetGrantTokens = "2000";
  assert.throws(() => reviewProfile(p));
  const q = fixture();
  q.addresses.program = "BfNiASrYNqmARu2TQ1eBa1PJ6KgVHTNn44ATk5rJe6zW";
  assert.throws(() => reviewProfile(q));
});
test("mainnet role collisions, incomplete schedule and mutable image tags fail", () => {
  const p = fixture(),
    key = Keypair.generate().publicKey.toBase58();
  p.addresses.payer = key;
  p.addresses.publisher = key;
  assert.throws(() => reviewProfile(p));
  const q = fixture();
  q.schedule.faucetOpensAt = 1;
  assert.throws(() => reviewProfile(q));
  const r = fixture();
  r.release.apiImage = "yac-api:latest";
  assert.throws(() => reviewProfile(r));
});
