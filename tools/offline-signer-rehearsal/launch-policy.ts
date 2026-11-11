// Exact-operation builder for disposable local launch rehearsals. No RPC calls.
import { createHash } from "node:crypto";
import { BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  AuthorityType,
  createInitializeMint2Instruction,
  createMintToCheckedInstruction,
  createSetAuthorityInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  PROGRAM_ID,
  configAddress,
  faucetVaultAddress,
  instruction,
} from "../../packages/shared/src/client";
import { rewardsPda, rewardVaultPda } from "../../packages/shared/src/cycles";

export const KIND = "YAMC_LOCAL_LAUNCH_NONCE_V1";
export type Operation = "initialize" | "rewards" | "schedule";
export type Policy = {
  kind: string;
  rpc: string;
  genesis: string;
  programId: string;
  admin: string;
  mint: string;
  publisher: string;
  issuer: string;
  nonceAccount: string;
  mintRentLamports: number;
  schedule: {
    faucetOpensAt: number;
    waveTwoAt: number;
    miningStartsAt: number;
  };
};
export type Request = {
  operation: Operation;
  nonceValue: string;
  messageBase64: string;
  messageSha256: string;
};
export const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export const loader = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
export const programData = PublicKey.findProgramAddressSync(
  [PROGRAM_ID.toBuffer()],
  loader,
)[0];
export function addresses(p: Policy) {
  const admin = new PublicKey(p.admin),
    mint = new PublicKey(p.mint);
  return {
    admin,
    mint,
    adminTokens: getAssociatedTokenAddressSync(mint, admin),
    config: configAddress,
    faucetVault: faucetVaultAddress,
    rewards: rewardsPda,
    rewardVault: rewardVaultPda,
  };
}
export function validatePolicy(p: Policy) {
  if (
    p.kind !== KIND ||
    p.rpc !== "http://127.0.0.1:9013" ||
    p.programId !== PROGRAM_ID.toBase58()
  )
    throw Error("Local launch policy mismatch");
  if (
    [
      "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
      "EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    ].includes(p.genesis)
  )
    throw Error("Public network forbidden");
  new PublicKey(p.genesis);
  const roles = [p.admin, p.mint, p.publisher, p.issuer, p.nonceAccount];
  const reserved = [
    SystemProgram.programId,
    TOKEN_PROGRAM_ID,
    PROGRAM_ID,
    programData,
    ...Object.values(addresses(p)).slice(2),
  ].map((k) => k.toBase58());
  if (
    new Set(roles).size !== roles.length ||
    roles.some((k) => reserved.includes(k) || new PublicKey(k).toBase58() !== k)
  )
    throw Error("Role collision");
  if (
    !Number.isSafeInteger(p.mintRentLamports) ||
    p.mintRentLamports <= 0 ||
    p.mintRentLamports > 10_000_000
  )
    throw Error("Mint rent outside local safety cap");
  const { faucetOpensAt: a, waveTwoAt: b, miningStartsAt: c } = p.schedule;
  if (
    ![a, b, c].every(Number.isSafeInteger) ||
    a <= 0 ||
    b - a !== 3600 ||
    c - b !== 3600
  )
    throw Error("Expected explicit one-hour waves");
}
export function build(p: Policy, operation: Operation, nonceValue: string) {
  validatePolicy(p);
  new PublicKey(nonceValue);
  if (nonceValue === SystemProgram.programId.toBase58())
    throw Error("Empty nonce");
  const a = addresses(p);
  const tx = new Transaction({
    feePayer: a.admin,
    recentBlockhash: nonceValue,
  }).add(
    SystemProgram.nonceAdvance({
      noncePubkey: new PublicKey(p.nonceAccount),
      authorizedPubkey: a.admin,
    }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
  );
  if (operation === "initialize")
    tx.add(
      SystemProgram.createAccount({
        fromPubkey: a.admin,
        newAccountPubkey: a.mint,
        space: MINT_SIZE,
        lamports: p.mintRentLamports,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(a.mint, 6, a.admin, null),
      createAssociatedTokenAccountIdempotentInstruction(
        a.admin,
        a.adminTokens,
        a.admin,
        a.mint,
      ),
      createMintToCheckedInstruction(
        a.mint,
        a.adminTokens,
        a.admin,
        100_000_000_000_000n,
        6,
      ),
      createSetAuthorityInstruction(
        a.mint,
        a.admin,
        AuthorityType.MintTokens,
        null,
      ),
      instruction("initializeLaunchConfig", {
        ...a,
        program: PROGRAM_ID,
        programData,
        tokenMint: a.mint,
      }),
    );
  else if (operation === "rewards")
    tx.add(
      instruction("initializeRewards", { ...a, tokenMint: a.mint }, undefined, {
        genesis: new BN(0),
        duration: new BN(86400),
        emission: new BN("250000000000"),
        publisher: new PublicKey(p.publisher),
      }),
    );
  else if (operation === "schedule")
    tx.add(
      instruction("activateRewards", a, undefined, {
        faucetOpensAt: new BN(p.schedule.faucetOpensAt),
        waveTwoAt: new BN(p.schedule.waveTwoAt),
        miningStartsAt: new BN(p.schedule.miningStartsAt),
        issuer: new PublicKey(p.issuer),
      }),
    );
  else throw Error("Unknown operation");
  const wire = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  if (wire.length > 1232)
    throw Error("Packet too large; do not silently split init");
  return tx;
}
export function inspect(p: Policy, r: Request) {
  const tx = build(p, r.operation, r.nonceValue),
    message = tx.serializeMessage();
  if (
    r.messageBase64 !== message.toString("base64") ||
    r.messageSha256 !== hash(message)
  )
    throw Error("Message differs from exact operation");
  return tx;
}
export function review(p: Policy, r: Request) {
  const tx = inspect(p, r),
    m = tx.compileMessage();
  return {
    warning:
      "LOCAL TEST ONLY. Offline review does not attest current chain state.",
    operation: r.operation,
    genesis: p.genesis,
    programId: p.programId,
    admin: p.admin,
    mint: p.mint,
    publisher: p.publisher,
    issuer: p.issuer,
    nonceAccount: p.nonceAccount,
    nonceValue: r.nonceValue,
    supply: "100000000",
    decimals: 6,
    faucet: "1000000",
    rewards: "99000000",
    dailyEmission: "250000",
    mintAuthorityAfter: null,
    freezeAuthorityAfter: null,
    scheduleUTC: Object.fromEntries(
      Object.entries(p.schedule).map(([k, v]) => [
        k,
        new Date(v * 1000).toISOString(),
      ]),
    ),
    scheduleApplied: r.operation === "schedule",
    feePayer: p.admin,
    messageSha256: r.messageSha256,
    accounts: m.accountKeys.map((k, i) => ({
      address: k.toBase58(),
      signer: m.isAccountSigner(i),
      writable: m.isAccountWritable(i),
    })),
    instructions: tx.instructions.map((ix) => ({
      program: ix.programId.toBase58(),
      accounts: ix.keys.map((k) => ({
        address: k.pubkey.toBase58(),
        signer: k.isSigner,
        writable: k.isWritable,
      })),
      dataHex: ix.data.toString("hex"),
    })),
  };
}
