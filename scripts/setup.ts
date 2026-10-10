import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  AuthorityType,
  createInitializeMint2Instruction,
  createMintToCheckedInstruction,
  createSetAuthorityInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { CATSHIT_DECIMALS, FAUCET_GLOBAL_CAP } from "@yac/shared";
import {
  PROGRAM_ID,
  configAddress,
  faucetVaultAddress,
  instruction,
  readConfig,
} from "@yac/shared/src/client";

async function main() {
  const endpoint = process.env.RPC_URL ?? "http://127.0.0.1:8899";
  if (/mainnet/i.test(endpoint)) throw new Error("Development setup only");
  const connection = new Connection(endpoint, "confirmed");
  const totalSupply =
    process.env.YAC_SETTLEMENT_BOOTSTRAP === "1"
      ? 100_000_000n * 1_000_000n
      : FAUCET_GLOBAL_CAP;
  const walletPath =
    process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(await readFile(walletPath, "utf8"))),
  );
  const existing = await readConfig(connection);
  if (existing) {
    console.log(
      `Already initialized. Mint: ${existing.tokenMint.toBase58()}. Config: ${configAddress.toBase58()}`,
    );
    return;
  }
  if (!(await connection.getAccountInfo(PROGRAM_ID)))
    throw new Error("Deploy program first: anchor deploy");
  const mint = Keypair.generate();
  const ata = getAssociatedTokenAddressSync(mint.publicKey, payer.publicKey);
  const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  const programData = PublicKey.findProgramAddressSync(
    [PROGRAM_ID.toBuffer()],
    loader,
  )[0];
  // Create mint, fixed supply, revoke authority, fund faucet, initialize config atomically.
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: MINT_SIZE,
      lamports: await connection.getMinimumBalanceForRentExemption(MINT_SIZE),
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(
      mint.publicKey,
      CATSHIT_DECIMALS,
      payer.publicKey,
      null,
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      ata,
      payer.publicKey,
      mint.publicKey,
    ),
    createMintToCheckedInstruction(
      mint.publicKey,
      ata,
      payer.publicKey,
      totalSupply,
      CATSHIT_DECIMALS,
    ),
    createSetAuthorityInstruction(
      mint.publicKey,
      payer.publicKey,
      AuthorityType.MintTokens,
      null,
    ),
    instruction("initializeConfig", {
      admin: payer.publicKey,
      program: PROGRAM_ID,
      programData,
      config: configAddress,
      tokenMint: mint.publicKey,
      adminTokens: ata,
      faucetVault: faucetVaultAddress,
    }),
  );
  const signature = await sendAndConfirmTransaction(
    connection,
    tx,
    [payer, mint],
    { commitment: "confirmed" },
  );
  await mkdir(".dev", { recursive: true });
  const deployment = {
    endpoint,
    programId: PROGRAM_ID.toBase58(),
    mint: mint.publicKey.toBase58(),
    config: configAddress.toBase58(),
    signature,
    startSlot: (
      await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      })
    ).value[0]?.slot,
  };
  await writeFile(
    process.env.YAC_DEPLOYMENT_FILE ?? ".dev/deployment.json",
    JSON.stringify(deployment, null, 2),
  );
  console.log(deployment);
  console.log(
    "Faucet ready: 1,000,000 CATSHIT; 2,000 per wallet; mint authority revoked. Wallets need dev SOL for fees/rent.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
