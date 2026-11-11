// Generates a non-runnable review bundle. No private files, RPC or transactions.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { reviewProfile } from "./check-mainnet-profile";
const [profileFile, candidateDir, outDir] = process.argv.slice(2);
if (!profileFile || !candidateDir || !outDir)
  throw Error(
    "Usage: prepare-mainnet-review PROFILE CANDIDATE NEW_OUTPUT_DIRECTORY",
  );
const profile = JSON.parse(readFileSync(profileFile, "utf8"));
const completeness = reviewProfile(profile);
const candidate = resolve(candidateDir),
  out = resolve(outDir);
const idlPath = join(candidate, "evidence/fresh-idl.normalized.json");
const idlBytes = readFileSync(idlPath),
  elf = readFileSync(join(candidate, "program/cat_shit_mining.so"));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const idl = JSON.parse(idlBytes.toString());
if (
  idl.address !== profile.addresses.program ||
  sha(idlBytes) !== profile.release.normalizedIdlSha256 ||
  sha(elf) !== profile.release.programBinarySha256
)
  throw Error("Candidate identity/hash mismatch");
for (const role of ["program", "mint", "admin", "initialUpgradeAuthority"])
  if (typeof profile.addresses[role] !== "string")
    throw Error("Verified public identity required");
if (profile.addresses.admin !== profile.addresses.initialUpgradeAuthority)
  throw Error("Initialization requires matching initial authority/admin");
const prefix = `mainnet-${profile.addresses.program}`;
const configuration = {
  schema: "yamc-mainnet-config-review-v1",
  runnable: false,
  transactionAuthorization: false,
  phase: "PREPARED_NOT_DEPLOYED",
  genesis: profile.genesis,
  addresses: profile.addresses,
  client: {
    EXPO_PUBLIC_BUILD_PROFILE: "mainnet",
    EXPO_PUBLIC_CLUSTER: "mainnet-beta",
    EXPO_PUBLIC_PROGRAM_ID: profile.addresses.program,
    EXPO_PUBLIC_TOKEN_MINT: profile.addresses.mint,
    EXPO_PUBLIC_API_URL: "https://yetanothermarket.cat",
    EXPO_PUBLIC_RPC_URL: null,
    EXPO_PUBLIC_DEMO_CONTROLS: "false",
    EXPO_PUBLIC_ADMISSION_LAB: "false",
    EXPO_PUBLIC_REHEARSAL_GENESIS: null,
  },
  backend: {
    YAC_CLUSTER: "mainnet-beta",
    SOLANA_PROGRAM_ID: profile.addresses.program,
    SOLANA_START_SLOT: null,
    YAC_DEPLOYMENT_FILE: "/run/yac-mainnet/deployment.json",
    YAC_SETTLEMENT_ENABLED: "false",
    YAC_ADMISSION_ENABLED: "false",
    DATABASE_PROVIDER: "postgres",
    databaseName: "yamc_mainnet_accounting",
    YAC_MANIFEST_PREFIX: prefix + "/",
    YAC_RPC_PRIMARY: null,
    YAC_RPC_VERIFY: null,
  },
  admission: {
    enabled: false,
    origin: "https://yetanothermarket.cat",
    expectedGenesis: profile.genesis,
    mint: profile.addresses.mint,
    localRehearsal: false,
    database: "/data/yamc-mainnet-admission.db",
    grantRpc: null,
    sgtRpc: null,
    issuerKeyFile: "/run/secrets/mainnet-issuer.json",
  },
  privateInputsRequired: [
    "server RPC URLs",
    "database credentials",
    "issuer private key (admission only)",
    "publisher private key (publisher only)",
    "persistent rateSalt",
    "shared proxySecret",
    "Turnstile keys",
  ],
  prohibitedInputs: [
    "admin/program/mint private keys in server images or mounts",
    "private server RPC credentials in EXPO_PUBLIC fields",
    "devnet DB or manifest namespace",
  ],
  release: profile.release,
  schedule: profile.schedule,
  openLaunchGates: completeness.blockers,
};
const pins = {
  schema: "yamc-mainnet-deployment-pins-v1",
  genesis: profile.genesis,
  program: profile.addresses.program,
  admin: profile.addresses.admin,
  payer: profile.addresses.payer,
  bufferAuthority: null,
  buffer: null,
  nonceAccount: null,
  binarySha256: sha(elf),
  binarySize: elf.length,
  programRentLamports: null,
};
const programData = PublicKey.findProgramAddressSync(
  [new PublicKey(pins.program).toBuffer()],
  new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
)[0].toBase58();
mkdirSync(out, { recursive: false });
writeFileSync(
  join(out, "configuration.review.json"),
  JSON.stringify(configuration, null, 2) + "\n",
);
writeFileSync(
  join(out, "deployment-pins.INCOMPLETE.json"),
  JSON.stringify(pins, null, 2) + "\n",
);
writeFileSync(
  join(out, "identities.json"),
  JSON.stringify({ ...profile.addresses, programData }, null, 2) + "\n",
);
copyFileSync(idlPath, join(out, "candidate-idl.json"));
console.log(
  JSON.stringify({
    status: "REVIEW_BUNDLE_ONLY",
    output: out,
    programData,
    transactionAuthorization: false,
    openLaunchGates: completeness.blockers.length,
  }),
);
