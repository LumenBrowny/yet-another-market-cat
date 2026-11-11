import { BN } from "@coral-xyz/anchor";
import { PublicKey, Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import {
  PROGRAM_ID,
  instruction,
  ownerAccounts,
  ensureAta,
  type Config,
} from "./client";
export const admissionAddress = (wave: number, subject: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("admission"), Buffer.from([wave]), subject.toBuffer()],
    PROGRAM_ID,
  )[0];
export function admissionInstruction(
  owner: PublicKey,
  mint: PublicKey,
  issuer: PublicKey,
  wave: 1 | 2,
  subject: PublicKey,
  expiresAt: number,
) {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0)
    throw new Error("Invalid expiry");
  return instruction(
    "claimAdmittedFaucet",
    {
      ...ownerAccounts(owner, mint),
      issuer,
      admissionReceipt: admissionAddress(wave, subject),
    },
    undefined,
    { wave, subject, expiresAt: new BN(expiresAt) },
  );
}
export function faucetWave(config: Config, time: bigint): 0 | 1 | 2 {
  if (
    !config.launchMode ||
    config.faucetOpensAt === 0n ||
    time < config.faucetOpensAt ||
    config.ppCutoff > 0n
  )
    return 0;
  return time < config.waveTwoAt ? 1 : 2;
}

export type GrantEnvelope = {
  transaction: string;
  wave: 1 | 2;
  subject: string;
  expiresAt: number;
  lastValidBlockHeight: number;
};
/** Treat the admission server as untrusted transaction input in the wallet UI. */
export function validateGrant(
  envelope: GrantEnvelope,
  owner: PublicKey,
  config: Config,
  now: number,
) {
  if (
    !Number.isSafeInteger(envelope.expiresAt) ||
    envelope.expiresAt <= now ||
    envelope.expiresAt > now + 300 ||
    !Number.isSafeInteger(envelope.lastValidBlockHeight) ||
    envelope.lastValidBlockHeight <= 0 ||
    envelope.wave !== faucetWave(config, BigInt(now))
  )
    throw new Error("Invalid faucet grant");
  if (
    typeof envelope.transaction !== "string" ||
    envelope.transaction.length > 2200
  )
    throw new Error("Invalid transaction");
  const subject = new PublicKey(envelope.subject);
  if (envelope.wave === 2 && !subject.equals(owner))
    throw new Error("Wrong faucet subject");
  const transaction = Transaction.from(
    Buffer.from(envelope.transaction, "base64"),
  );
  const expected = new Transaction({
    feePayer: owner,
    recentBlockhash: transaction.recentBlockhash,
  }).add(
    ensureAta(owner, config.tokenMint),
    admissionInstruction(
      owner,
      config.tokenMint,
      config.faucetIssuer,
      envelope.wave,
      subject,
      envelope.expiresAt,
    ),
  );
  if (
    !transaction.serializeMessage().equals(expected.serializeMessage()) ||
    !transaction.signatures.some(
      (s) => s.publicKey.equals(config.faucetIssuer) && s.signature !== null,
    ) ||
    !transaction.verifySignatures(false)
  )
    throw new Error("Unexpected or unsigned faucet transaction");
  return transaction;
}
