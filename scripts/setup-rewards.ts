import { readFile, writeFile } from "node:fs/promises";
import { BN } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  getMint,
  getAccount,
} from "@solana/spl-token";
import {
  configAddress,
  instruction,
  readConfig,
} from "../packages/shared/src/client";
import {
  fetchRewards,
  rewardsPda,
  rewardVaultPda,
} from "../packages/shared/src/cycles";
async function main() {
  const connection = new Connection(
    process.env.RPC_URL ?? "http://127.0.0.1:9099",
    "finalized",
  );
  const admin = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        await readFile(process.env.ANCHOR_WALLET ?? ".dev/admin.json", "utf8"),
      ),
    ),
  );
  const deadline = Date.now() + 120_000;
  while (!(await connection.getAccountInfo(configAddress, "finalized"))) {
    if (Date.now() > deadline)
      throw new Error("Custody initialization did not finalize");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (await fetchRewards(connection)) {
    console.log("Rewards already initialized");
    return;
  }
  const config = await readConfig(connection);
  if (!config) throw new Error("Initialize custody/faucet first");
  const publisherFile =
    process.env.YAC_PUBLISHER_KEY ?? ".dev/cycle-publisher-004.json";
  let publisher: Keypair;
  try {
    publisher = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(await readFile(publisherFile, "utf8"))),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    publisher = Keypair.generate();
    await writeFile(publisherFile, JSON.stringify([...publisher.secretKey]));
  }
  const time = await connection.getBlockTime(
    await connection.getSlot("finalized"),
  );
  if (!time) throw new Error("Missing chain time");
  const genesis = time + Number(process.env.YAC_CYCLE_START_DELAY ?? "180");
  const duration = Number(process.env.YAC_CYCLE_DURATION ?? "86400");
  const emission = 100_000_000_000n;
  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: publisher.publicKey,
        lamports: Number(
          process.env.YAC_PUBLISHER_FUND_LAMPORTS ?? "2000000000",
        ),
      }),
      instruction(
        "initializeRewards",
        {
          admin: admin.publicKey,
          config: configAddress,
          tokenMint: config.tokenMint,
          rewards: rewardsPda,
          rewardVault: rewardVaultPda,
          adminTokens: getAssociatedTokenAddressSync(
            config.tokenMint,
            admin.publicKey,
          ),
        },
        undefined,
        {
          genesis: new BN(genesis),
          duration: new BN(duration),
          emission: new BN(emission.toString()),
          publisher: publisher.publicKey,
        },
      ),
    ),
    [admin],
    { commitment: "finalized" },
  );
  const mint = await getMint(connection, config.tokenMint);
  const vault = await getAccount(connection, rewardVaultPda);
  if (
    mint.mintAuthority ||
    mint.freezeAuthority ||
    mint.supply !== 100_000_000_000_000n ||
    vault.amount !== 99_000_000_000_000n
  )
    throw new Error("Supply/reserve invariant failed");
  const metadataPath =
    process.env.YAC_DEPLOYMENT_FILE ?? ".dev/deployment-004.json";
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  Object.assign(metadata, {
    cycleGenesis: genesis,
    cycleDuration: duration,
    cycleEmission: emission.toString(),
    cyclePublisher: publisher.publicKey.toBase58(),
    rewardVault: rewardVaultPda.toBase58(),
    rewardsSignature: signature,
  });
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  console.log({
    ...metadata,
    supply: mint.supply.toString(),
    mintAuthority: null,
    freezeAuthority: null,
    reserve: vault.amount.toString(),
  });
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
