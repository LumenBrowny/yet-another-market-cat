import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { type Config, ensureAta } from "../../packages/shared/src/client.ts";
import {
  admissionInstruction,
  faucetWave,
} from "../../packages/shared/src/admission.ts";
import { AdmissionError, AdmissionStore, verifyWallet } from "./core.ts";

export interface AdmissionChain {
  config(): Promise<Config>;
  claimed(wallet: PublicKey): Promise<boolean>;
  usedSubject(wave: 1 | 2, subject: PublicKey): Promise<boolean>;
  seekerMints(wallet: PublicKey): Promise<PublicKey[]>;
  blockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
}

/** Signs only transactions built here, never serialized input from a client. */
export async function issueGrant(
  store: AdmissionStore,
  chain: AdmissionChain,
  issuer: Keypair,
  expectedMint: PublicKey,
  request: { nonce: string; signature: string; signedMessage: string },
  now: () => number = () => Math.floor(Date.now() / 1000),
) {
  const challenge = store.get(request.nonce, now());
  const wallet = verifyWallet(
    challenge.payload,
    request.signature,
    request.signedMessage,
    now(),
  );
  const config = await chain.config();
  if (
    !config.tokenMint.equals(expectedMint) ||
    !config.faucetIssuer.equals(issuer.publicKey)
  )
    throw new AdmissionError(503, "Faucet configuration mismatch");
  const wave = faucetWave(config, BigInt(now()));
  if (!wave) throw new AdmissionError(409, "Faucet is not open");
  // Consume atomically before expensive SGT work. Retries require a fresh SIWS.
  store.consume(request.nonce, now(), wave === 2);
  if (await chain.claimed(wallet))
    throw new AdmissionError(409, "Wallet already received its allocation");
  let subject = wallet;
  if (wave === 1) {
    const mints = await chain.seekerMints(wallet);
    let selected: PublicKey | undefined;
    for (const mint of mints) {
      if (!(await chain.usedSubject(1, mint))) {
        selected = mint;
        break;
      }
    }
    if (!selected)
      throw new AdmissionError(403, "No unused Seeker Genesis Token found");
    subject = selected;
  }
  const latest = await chain.blockhash();
  const time = now();
  if (faucetWave(config, BigInt(time)) !== wave)
    throw new AdmissionError(409, "Wave changed; request a fresh sign-in");
  const expiresAt =
    wave === 1 ? Math.min(time + 120, Number(config.waveTwoAt)) : time + 120;
  const transaction = new Transaction({ feePayer: wallet, ...latest }).add(
    ensureAta(wallet, expectedMint),
    admissionInstruction(
      wallet,
      expectedMint,
      issuer.publicKey,
      wave,
      subject,
      expiresAt,
    ),
  );
  transaction.partialSign(issuer);
  return {
    transaction: transaction
      .serialize({ requireAllSignatures: false })
      .toString("base64"),
    wave,
    subject: subject.toBase58(),
    expiresAt,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  };
}
