// Exact, unscheduled mainnet initialization. No activation instruction exists here.
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  AuthorityType,
  createInitializeMint2Instruction,
  createMintToCheckedInstruction,
  createSetAuthorityInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { digest, validatePins, type DeploymentPins } from "./deployment-policy";
import { pinsDigest } from "./signing";
export type InitializationPins = {
  schema: "yamc-mainnet-initialization-v1";
  deployment: DeploymentPins;
  mint: string;
  publisher: string;
  issuer: string;
  mintRentLamports: number;
};
export type InitializationRequest = {
  operation: "initialize" | "rewards";
  nonceValue: string;
  messageBase64: string;
  messageSha256: string;
};
export function initializationAddresses(p: InitializationPins) {
  const program = new PublicKey(p.deployment.program),
    admin = new PublicKey(p.deployment.admin),
    mint = new PublicKey(p.mint);
  const pda = (s: string) =>
    PublicKey.findProgramAddressSync([Buffer.from(s)], program)[0];
  return {
    program,
    admin,
    tokenMint: mint,
    adminTokens: getAssociatedTokenAddressSync(mint, admin),
    config: pda("config"),
    faucetVault: pda("faucet_vault"),
    rewards: pda("rewards"),
    rewardVault: pda("reward_vault"),
    programData: validatePins(p.deployment).data,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };
}
export function validateInitializationPins(p: InitializationPins) {
  validatePins(p.deployment);
  if (
    p.schema !== "yamc-mainnet-initialization-v1" ||
    !Number.isSafeInteger(p.mintRentLamports) ||
    p.mintRentLamports <= 0 ||
    p.mintRentLamports > 10000000
  )
    throw Error("Invalid initialization pins");
  const roles = [
    p.deployment.program,
    p.deployment.admin,
    p.deployment.payer,
    p.deployment.buffer,
    p.deployment.bufferAuthority,
    p.deployment.nonceAccount,
    p.mint,
    p.publisher,
    p.issuer,
  ];
  const a = initializationAddresses(p);
  const reserved = [
    a.config,
    a.faucetVault,
    a.rewards,
    a.rewardVault,
    a.adminTokens,
    a.programData,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    SystemProgram.programId,
    ComputeBudgetProgram.programId,
    new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
  ].map((k) => k.toBase58());
  if (
    new Set(roles).size !== roles.length ||
    roles.some((r) => new PublicKey(r).toBase58() !== r || reserved.includes(r))
  )
    throw Error("Initialization role collision");
}
export function initializationPinsDigest(p: InitializationPins) {
  validateInitializationPins(p);
  return digest(
    Buffer.from(
      JSON.stringify([
        p.schema,
        pinsDigest(p.deployment),
        p.mint,
        p.publisher,
        p.issuer,
        p.mintRentLamports,
      ]),
    ),
  );
}
export function buildInitialization(
  p: InitializationPins,
  operation: InitializationRequest["operation"],
  nonceValue: string,
) {
  validateInitializationPins(p);
  if (
    new PublicKey(nonceValue).toBase58() !== nonceValue ||
    nonceValue === SystemProgram.programId.toBase58()
  )
    throw Error("Invalid nonce");
  const a = initializationAddresses(p);
  const tx = new Transaction({
    feePayer: a.admin,
    recentBlockhash: nonceValue,
  }).add(
    SystemProgram.nonceAdvance({
      noncePubkey: new PublicKey(p.deployment.nonceAccount),
      authorizedPubkey: a.admin,
    }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
  );
  const meta = (
    name: keyof typeof a,
    isWritable = false,
    isSigner = false,
  ) => ({ pubkey: a[name], isWritable, isSigner });
  if (operation === "initialize")
    tx.add(
      SystemProgram.createAccount({
        fromPubkey: a.admin,
        newAccountPubkey: a.tokenMint,
        space: MINT_SIZE,
        lamports: p.mintRentLamports,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(a.tokenMint, 6, a.admin, null),
      createAssociatedTokenAccountIdempotentInstruction(
        a.admin,
        a.adminTokens,
        a.admin,
        a.tokenMint,
      ),
      createMintToCheckedInstruction(
        a.tokenMint,
        a.adminTokens,
        a.admin,
        100000000000000n,
        6,
      ),
      createSetAuthorityInstruction(
        a.tokenMint,
        a.admin,
        AuthorityType.MintTokens,
        null,
      ),
      new TransactionInstruction({
        programId: a.program,
        keys: [
          meta("admin", true, true),
          meta("program"),
          meta("programData"),
          meta("config", true),
          meta("tokenMint"),
          meta("adminTokens", true),
          meta("faucetVault", true),
          meta("tokenProgram"),
          meta("associatedTokenProgram"),
          meta("systemProgram"),
        ],
        data: Buffer.from([106, 231, 35, 15, 25, 104, 160, 153]),
      }),
    );
  else if (operation === "rewards") {
    const data = Buffer.alloc(64);
    Buffer.from([91, 174, 112, 191, 233, 236, 147, 12]).copy(data);
    data.writeBigInt64LE(0n, 8);
    data.writeBigInt64LE(86400n, 16);
    data.writeBigUInt64LE(250000000000n, 24);
    new PublicKey(p.publisher).toBuffer().copy(data, 32);
    tx.add(
      new TransactionInstruction({
        programId: a.program,
        keys: [
          meta("admin", true, true),
          meta("config"),
          meta("tokenMint"),
          meta("rewards", true),
          meta("rewardVault", true),
          meta("adminTokens", true),
          meta("tokenProgram"),
          meta("systemProgram"),
        ],
        data,
      }),
    );
  } else throw Error("Only unscheduled initialize/rewards allowed");
  if (
    tx.serialize({ requireAllSignatures: false, verifySignatures: false })
      .length > 1232
  )
    throw Error("Packet too large");
  return tx;
}
export function reviewInitialization(
  p: InitializationPins,
  r: InitializationRequest,
  elf: Uint8Array,
) {
  if (
    Object.keys(r).sort().join() !==
    ["operation", "nonceValue", "messageBase64", "messageSha256"].sort().join()
  )
    throw Error("Unexpected request fields");
  if (
    elf.length !== p.deployment.binarySize ||
    digest(elf) !== p.deployment.binarySha256
  )
    throw Error("ELF mismatch");
  const tx = buildInitialization(p, r.operation, r.nonceValue),
    bytes = tx.serializeMessage();
  if (
    r.messageBase64 !== bytes.toString("base64") ||
    r.messageSha256 !== digest(bytes)
  )
    throw Error("Initialization message mismatch");
  return {
    status: "MATCHES_OFFLINE_INITIALIZATION_POLICY",
    pins: p,
    derivedAccounts: Object.fromEntries(
      Object.entries(initializationAddresses(p)).map(([name, key]) => [
        name,
        key.toBase58(),
      ]),
    ),
    operation: r.operation,
    messageSha256: r.messageSha256,
    pinsSha256: initializationPinsDigest(p),
    feePayer: p.deployment.admin,
    requiredOfflineRoles:
      r.operation === "initialize" ? ["admin", "mint"] : ["admin"],
    supplyTokens: "100000000",
    decimals: 6,
    faucetTokens: "1000000",
    rewardsTokens: "99000000",
    dailyEmissionTokens: "250000",
    cycleSeconds: 86400,
    mintAuthorityAfter: null,
    freezeAuthorityAfter: null,
    scheduleApplied: false,
    activationAllowed: false,
    intermediateState:
      r.operation === "initialize"
        ? "99M remain in admin ATA until separate rewards funding"
        : "99M moved from admin ATA into reward vault; genesis remains zero",
    transactionAuthorization: false,
    warning:
      "Offline policy does not attest chain state. Durable nonce signature remains usable until nonce consumption. Review admin/mint keys and pins independently.",
  };
}
