import { type PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { ensureAta, instruction, ownerAccounts } from "./client";

function sameInstruction(a: TransactionInstruction, b: TransactionInstruction) {
  return (
    a.programId.equals(b.programId) &&
    a.data.equals(b.data) &&
    a.keys.length === b.keys.length &&
    a.keys.every(
      (key, i) =>
        key.pubkey.equals(b.keys[i].pubkey) &&
        key.isSigner === b.keys[i].isSigner &&
        key.isWritable === b.keys[i].isWritable,
    )
  );
}

// Only the two exact withdrawal shapes produced by the UI can bypass backend
// availability. No arbitrary extra instructions, recipients, signers or programs.
export function isCustodyWithdrawal(
  instructions: TransactionInstruction[],
  owner: PublicKey,
  mint: PublicKey,
) {
  try {
    const accounts = ownerAccounts(owner, mint);
    if (instructions.length === 1 && instructions[0].data.length === 16) {
      const amount = instructions[0].data.readBigUInt64LE(8);
      return (
        amount > 0n &&
        sameInstruction(
          instructions[0],
          instruction("requestWithdraw", accounts, amount),
        )
      );
    }
    return (
      instructions.length === 2 &&
      sameInstruction(instructions[0], ensureAta(owner, mint)) &&
      sameInstruction(instructions[1], instruction("executeWithdraw", accounts))
    );
  } catch {
    return false;
  }
}
