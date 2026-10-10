import { readFile } from "node:fs/promises";
import { verifyCycleReport, verifyCyclesReport } from "./cycle-verifier";
import { BN, BorshAccountsCoder } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { unpackAccount } from "@solana/spl-token";
import {
  PROGRAM_ID,
  instruction,
  configAddress,
  IDL,
} from "../packages/shared/src/client";
import {
  fetchRewards,
  fetchCycle,
  fetchPublishedCycles,
  deriveCyclePda,
  rewardsPda,
  rewardVaultPda,
} from "../packages/shared/src/cycles";
import {
  unsigned,
  verifyManifest,
  canonicalManifest,
  type CycleManifest,
} from "../packages/shared/src/settlement";

async function main() {
  let text = "";
  for await (const chunk of process.stdin) text += String(chunk);
  const input = JSON.parse(text) as {
    command: string;
    endpoint: string;
    manifest?: CycleManifest;
    publisherFile?: string;
    startSlot?: number;
    canonical?: string;
    fromCycle?: string;
    toCycle?: string;
    operationalTip?: {
      slot: number;
      blockTime: number;
      genesisHash: string;
      fetchedAt: number;
    };
  };
  if (input.command === "verify") return verifyManifest(input.manifest!);
  if (input.command === "verify-batch")
    return verifyCyclesReport(
      JSON.parse(input.canonical!),
      input.endpoint,
      input.startSlot!,
    );
  if (
    input.command === "verify-chain" ||
    input.command === "verify-before-publish"
  )
    return verifyCycleReport(
      input.canonical ?? canonicalManifest(input.manifest!),
      input.endpoint,
      input.startSlot,
      input.command === "verify-before-publish",
    );
  const connection = new Connection(input.endpoint, "finalized");
  if (input.command === "cycle-discovery" || input.command === "cycle-audit")
    return fetchPublishedCycles(
      connection,
      BigInt(input.toCycle!),
      BigInt(input.fromCycle!),
    );
  const config = await fetchRewards(connection);
  if (!config) throw new Error("Reward config unavailable");
  const shared = input.command === "state" ? input.operationalTip : undefined;
  if (
    shared &&
    (Date.now() - shared.fetchedAt > 15_000 ||
      shared.fetchedAt > Date.now() + 1000)
  )
    throw new Error("Stale operational tip");
  const genesisHash =
    shared?.genesisHash ?? (await connection.getGenesisHash());
  if (input.command === "state") {
    const began = Date.now();
    const latestFinalizedSlot =
      shared?.slot ?? (await connection.getSlot("finalized"));
    const finalizedTime =
      shared?.blockTime ?? (await connection.getBlockTime(latestFinalizedSlot));
    const rpcLatencyMs = Date.now() - began;
    const [program, vaultInfo, miningInfo] =
      await connection.getMultipleAccountsInfo(
        [PROGRAM_ID, rewardVaultPda, configAddress],
        "finalized",
      );
    if (!miningInfo || !miningInfo.owner.equals(PROGRAM_ID))
      throw new Error("Mining config owner mismatch");
    const miningConfig = new BorshAccountsCoder(IDL).decode(
      "config",
      miningInfo.data,
    );
    const vault = unpackAccount(rewardVaultPda, vaultInfo);
    const programData =
      program?.data.length === 36
        ? await connection.getAccountInfo(
            new PublicKey(program.data.subarray(4, 36)),
            "finalized",
          )
        : null;
    const upgradeAuthority =
      programData?.data[12] === 1
        ? new PublicKey(programData.data.subarray(13, 45)).toBase58()
        : null;
    // Historical accounts are discovered separately and persisted by the backend.
    const cycles: unknown[] = [];
    return {
      config,
      genesisHash,
      programId: PROGRAM_ID.toBase58(),
      vaultBalance: vault.amount.toString(),
      cycles,
      latestFinalizedSlot,
      finalizedTime,
      rpcLatencyMs,
      upgradeAuthority,
      faucetDistributed: miningConfig?.faucetDistributed.toString(),
    };
  }
  if (input.command !== "publish") throw new Error("Unknown bridge operation");
  const m = input.manifest!;
  const verified = verifyManifest(m);
  const id = BigInt(m.cycleId);
  if (
    m.programId !== PROGRAM_ID.toBase58() ||
    m.mint !== config.tokenMint ||
    m.genesisHash !== genesisHash ||
    BigInt(m.startTime) !==
      BigInt(config.genesis) + id * BigInt(config.duration) ||
    BigInt(m.endTime) !== BigInt(m.startTime) + BigInt(config.duration) ||
    m.rewardBudgetBaseUnits !== config.emission
  )
    throw new Error("Manifest/chain configuration mismatch");
  const existing = await fetchCycle(connection, id);
  const matches = (c: NonNullable<typeof existing>) =>
    Buffer.from(c.root).toString("hex") === m.merkleRoot &&
    Buffer.from(c.manifestHash).toString("hex") === verified.manifestHash &&
    c.totalAllocated === m.totalAllocatedBaseUnits &&
    c.budget === m.rewardBudgetBaseUnits &&
    c.start === m.startTime &&
    c.end === m.endTime &&
    c.leafCount === m.leafCount &&
    Buffer.from(c.totalPoints).equals(
      unsigned(BigInt(m.totalPointUnits), 32, true),
    );
  if (existing) {
    if (!matches(existing))
      throw new Error("Published cycle conflicts with manifest");
    return { reconciled: true, cycle: existing };
  }
  if (!input.publisherFile) throw new Error("Publisher key not configured");
  // The key is read only after calculation, verification and immutable-state checks.
  const publisher = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(await readFile(input.publisherFile, "utf8"))),
  );
  if (publisher.publicKey.toBase58() !== config.publisher)
    throw new Error("Wrong publisher signer");
  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      instruction(
        "publishCycle",
        {
          publisher: publisher.publicKey,
          rewards: rewardsPda,
          rewardVault: rewardVaultPda,
          cycle: deriveCyclePda(id),
        },
        undefined,
        {
          cycleId: new BN(m.cycleId),
          root: [...Buffer.from(m.merkleRoot, "hex")],
          manifestHash: [...Buffer.from(verified.manifestHash, "hex")],
          totalPoints: [...unsigned(BigInt(m.totalPointUnits), 32, true)],
          totalAllocated: new BN(m.totalAllocatedBaseUnits),
          leafCount: m.leafCount,
        },
      ),
    ),
    [publisher],
    { commitment: "finalized" },
  );
  const cycle = await fetchCycle(connection, id);
  if (!cycle || !matches(cycle))
    throw new Error("Finalized publication differs");
  return {
    signature,
    cycle,
    manifestHash: verified.manifestHash,
    canonical: canonicalManifest(m),
  };
}
main()
  .then((result) => process.stdout.write(JSON.stringify(result)))
  .catch((e) => {
    console.error(String(e));
    process.exitCode = 1;
  });
