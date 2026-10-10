import {
  BorshAccountsCoder,
  BorshInstructionCoder,
  type Idl,
} from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  unpackAccount,
} from "@solana/spl-token";
import { Buffer } from "buffer";
import idlJson from "./idl.json";
import { assertAmount } from "./index";

export const IDL = idlJson as Idl;
export const PROGRAM_ID = new PublicKey(IDL.address);
const coder = new BorshInstructionCoder(IDL);
const accountsCoder = new BorshAccountsCoder(IDL);
export const pda = (seed: string, ...keys: PublicKey[]) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from(seed), ...keys.map((k) => k.toBuffer())],
    PROGRAM_ID,
  )[0];
export const configAddress = pda("config");
export const faucetVaultAddress = pda("faucet_vault");
export type Position = {
  owner: PublicKey;
  lockedAmount: bigint;
  pendingWithdrawAmount: bigint;
  withdrawRequestedAt: bigint;
  createdAt: bigint;
};
export type Config = {
  admin: PublicKey;
  tokenMint: PublicKey;
  minLockAmount: bigint;
  unlockCooldownSeconds: bigint;
  faucetDistributed: bigint;
};
function bigintFields<T>(raw: Record<string, unknown>): T {
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [
      k,
      BN.isBN(v) ? BigInt(String(v)) : v,
    ]),
  ) as T;
}
async function readAccount<T>(
  connection: Connection,
  address: PublicKey,
  name: string,
): Promise<T | null> {
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info) return null;
  if (!info.owner.equals(PROGRAM_ID))
    throw new Error(`Unexpected owner for ${name}`);
  return bigintFields<T>(accountsCoder.decode(name, info.data));
}
export const readPosition = (c: Connection, owner: PublicKey) =>
  readAccount<Position>(c, pda("position", owner), "miningPosition");
export const readConfig = (c: Connection) =>
  readAccount<Config>(c, configAddress, "config");

// One confirmed bank snapshot, without a second request for the same ATA balance.
export async function readWalletSnapshot(
  c: Connection,
  owner: PublicKey,
  mint: PublicKey,
) {
  const ata = getAssociatedTokenAddressSync(mint, owner);
  const [positionInfo, tokenInfo, receipt] = await c.getMultipleAccountsInfo(
    [pda("position", owner), ata, pda("faucet", owner)],
    "confirmed",
  );
  let position: Position | null = null;
  if (positionInfo) {
    if (!positionInfo.owner.equals(PROGRAM_ID))
      throw new Error("Unexpected position program");
    position = bigintFields<Position>(
      accountsCoder.decode("miningPosition", positionInfo.data),
    );
    if (!position.owner.equals(owner))
      throw new Error("Unexpected position wallet");
  }
  const token = tokenInfo
    ? unpackAccount(ata, tokenInfo, TOKEN_PROGRAM_ID)
    : null;
  if (token && (!token.owner.equals(owner) || !token.mint.equals(mint)))
    throw new Error("Unexpected token account identity");
  if (receipt) {
    if (!receipt.owner.equals(PROGRAM_ID))
      throw new Error("Unexpected faucet receipt program");
    const decoded = accountsCoder.decode("faucetReceipt", receipt.data);
    if (!decoded.owner.equals(owner))
      throw new Error("Unexpected faucet receipt wallet");
  }
  return { balance: token?.amount ?? 0n, position, claimed: !!receipt };
}

// IDL drives discriminator, argument layout, account order and signer/writable flags.
export function instruction(
  name: string,
  keys: Record<string, PublicKey>,
  amount?: bigint,
  args?: Record<string, unknown>,
) {
  const definition = IDL.instructions.find((i) => i.name === name);
  if (!definition) throw new Error(`Unknown instruction ${name}`);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: definition.accounts.map((account) => {
      if ("accounts" in account)
        throw new Error("Nested accounts not supported");
      const pubkey =
        keys[account.name] ??
        (account.address ? new PublicKey(account.address) : undefined);
      if (!pubkey) throw new Error(`Missing account ${account.name}`);
      return {
        pubkey,
        isSigner: account.signer ?? false,
        isWritable: account.writable ?? false,
      };
    }),
    data: coder.encode(
      name,
      args ??
        (amount === undefined
          ? {}
          : { amount: new BN(assertAmount(amount).toString()) }),
    ),
  });
}
export function ownerAccounts(owner: PublicKey, tokenMint: PublicKey) {
  const position = pda("position", owner);
  return {
    owner,
    tokenMint,
    position,
    vault: pda("vault", position),
    config: configAddress,
    receipt: pda("faucet", owner),
    faucetVault: faucetVaultAddress,
    ownerTokens: getAssociatedTokenAddressSync(tokenMint, owner),
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };
}
export function ensureAta(owner: PublicKey, mint: PublicKey) {
  return createAssociatedTokenAccountIdempotentInstruction(
    owner,
    getAssociatedTokenAddressSync(mint, owner),
    owner,
    mint,
  );
}
