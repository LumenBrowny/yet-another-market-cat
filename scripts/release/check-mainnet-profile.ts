// Read-only completeness checks, NEVER transaction authorization or deployment.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PublicKey, SystemProgram } from "@solana/web3.js";
type RecordValue = Record<string, unknown>;
const object = (v: unknown): RecordValue => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Expected object");
  return v as RecordValue;
};
export function reviewProfile(value: unknown) {
  const p = object(value),
    blockers: string[] = [];
  if (
    p.schema !== "yamc-production-preflight-v1" ||
    p.cluster !== "mainnet-beta" ||
    p.genesis !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" ||
    p.deployAutomatically !== false ||
    p.activateAutomatically !== false ||
    p.deploymentMethod !== "offline-buffer-acceptance-then-direct-deploy"
  )
    throw Error("Unsupported or automatic-execution profile");
  const expected = {
    decimals: 6,
    supplyTokens: "100000000",
    faucetReserveTokens: "1000000",
    faucetGrantTokens: "1000",
    rewardReserveTokens: "99000000",
    emissionTokens: "250000",
    cycleSeconds: 86400,
    withdrawalCooldownSeconds: 86400,
  };
  const economics = object(p.economics);
  for (const [k, v] of Object.entries(expected))
    if (economics[k] !== v) throw Error(`Economics mismatch: ${k}`);
  const addresses = object(p.addresses),
    roles = [
      "program",
      "mint",
      "admin",
      "initialUpgradeAuthority",
      "payer",
      "publisher",
      "faucetIssuer",
    ];
  const used = new Set<string>();
  for (const role of roles) {
    const v = addresses[role];
    if (v === null) {
      blockers.push(`addresses.${role}`);
      continue;
    }
    if (
      typeof v !== "string" ||
      new PublicKey(v).toBase58() !== v ||
      v === SystemProgram.programId.toBase58()
    )
      throw Error(`Invalid address: ${role}`);
    if (role !== "initialUpgradeAuthority") {
      if (used.has(v)) throw Error("Roles must be distinct");
      used.add(v);
    }
  }
  if (
    addresses.admin !== null &&
    addresses.initialUpgradeAuthority !== null &&
    addresses.admin !== addresses.initialUpgradeAuthority
  )
    throw Error("Initial admin must equal upgrade authority");
  if (
    addresses.program === "BfNiASrYNqmARu2TQ1eBa1PJ6KgVHTNn44ATk5rJe6zW" ||
    Object.values(addresses).includes(
      "5Kgy6TMeTAhyZZNPdhgEkRkGKw5riMgFZoqyGtFi9Cjk",
    )
  )
    throw Error("Known devnet/rehearsal identity forbidden");
  const release = object(p.release);
  for (const key of [
    "sourceCommit",
    "programBinarySha256",
    "normalizedIdlSha256",
    "apkSha256",
    "androidCertificateSha256",
  ]) {
    const v = release[key];
    if (v === null) blockers.push(`release.${key}`);
    else if (
      typeof v !== "string" ||
      !(key === "sourceCommit" ? /^[a-f0-9]{40}$/ : /^[a-f0-9]{64}$/).test(v)
    )
      throw Error(`Invalid release pin: ${key}`);
  }
  for (const key of ["apiImage", "admissionImage"]) {
    const v = release[key];
    if (v === null) blockers.push(`release.${key}`);
    else if (typeof v !== "string" || !/^\S+@sha256:[a-f0-9]{64}$/.test(v))
      throw Error("Image digest required");
  }
  for (const [section, fields] of Object.entries({
    serviceIsolation: [
      "accountingDatabase",
      "admissionDatabase",
      "manifestPrefix",
    ],
    evidence: [
      "independentBuildVerification",
      "currentReleaseSecurityReview",
      "mainnetArchivalReplay",
      "productionRestoreDrill",
      "offlineKeyBackupVerification",
      "androidSigningDecision",
      "operatorLegalIdentityReview",
    ],
  })) {
    const record = object(p[section]);
    for (const key of fields) {
      const v = record[key];
      if (v === null) blockers.push(`${section}.${key}`);
      else if (
        typeof v !== "string" ||
        !v.trim() ||
        /^(pending|todo|tbd)$/i.test(v.trim())
      )
        throw Error(`Evidence/reference missing: ${section}.${key}`);
    }
  }
  if (p.storeListingUrl === null) blockers.push("storeListingUrl");
  else if (
    typeof p.storeListingUrl !== "string" ||
    !p.storeListingUrl.startsWith("https://")
  )
    throw Error("HTTPS Store listing required");
  const schedule = object(p.schedule),
    times = ["faucetOpensAt", "waveTwoAt", "miningStartsAt"].map(
      (k) => schedule[k],
    );
  if (times.every((v) => v === null))
    blockers.push("schedule (separate activation review)");
  else if (
    !times.every(
      (v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0,
    ) ||
    !(
      Number(times[0]) < Number(times[1]) && Number(times[1]) < Number(times[2])
    )
  )
    throw Error("Explicit ordered schedule required");
  return {
    status: blockers.length
      ? "BLOCKED_INCOMPLETE"
      : "COMPLETE_FIELDS_REQUIRE_MANUAL_EVIDENCE_REVIEW",
    transactionAuthorization: false,
    blockers,
    note: "Checks syntax/completeness only. Does not authenticate evidence, verify binaries or authorize mainnet.",
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const report = reviewProfile(
      JSON.parse(
        readFileSync(
          process.argv[2] ?? "infra/mainnet/release-profile.template.json",
          "utf8",
        ),
      ),
    );
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.blockers.length ? 2 : 0;
  } catch (e) {
    console.error(String(e));
    process.exitCode = 1;
  }
}
