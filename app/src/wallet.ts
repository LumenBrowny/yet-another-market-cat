import {
  transact,
  type Web3MobileWallet,
} from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import {
  Connection,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import * as SecureStore from "expo-secure-store";
import { Buffer } from "buffer";

import { appConfig } from "./config";
export const connection = new Connection(appConfig.rpcUrl, "confirmed");
export const cluster = appConfig.cluster;
const storageKey = `yac-wallet-${cluster}`;
const identity = { name: appConfig.identity };
type Session = { authToken: string; address: string };
async function readSession(): Promise<Session | null> {
  const stored = await SecureStore.getItemAsync(storageKey);
  if (!stored) return null;
  try {
    const session = JSON.parse(stored) as Session;
    if (typeof session.authToken !== "string")
      throw new Error("Invalid session");
    new PublicKey(session.address);
    return session;
  } catch {
    await SecureStore.deleteItemAsync(storageKey);
    return null;
  }
}
export async function restoredWallet(): Promise<PublicKey | null> {
  const stored = await readSession();
  return stored ? new PublicKey(stored.address) : null;
}
async function authorize(wallet: Web3MobileWallet) {
  const previous = await readSession();
  // Localnet uses a dev wallet with local RPC; signTransactions lets the app submit to its own RPC.
  const result = await wallet.authorize({
    identity,
    chain: cluster === "localnet" ? "solana:localnet" : "solana:devnet",
    auth_token: previous?.authToken,
  });
  if (!result.accounts[0]) throw new Error("Wallet returned no account");
  const owner = new PublicKey(
    Buffer.from(result.accounts[0].address, "base64"),
  );
  await SecureStore.setItemAsync(
    storageKey,
    JSON.stringify({
      authToken: result.auth_token,
      address: owner.toBase58(),
    } satisfies Session),
  );
  return owner;
}
export const connectWallet = () => transact(authorize);
export async function disconnectWallet() {
  const stored = await readSession();
  // Clear locally even if the wallet has revoked the token or is unavailable.
  await SecureStore.deleteItemAsync(storageKey);
  if (stored)
    await transact((wallet) =>
      wallet.deauthorize({
        auth_token: stored.authToken,
      }),
    );
}
export async function sendInstructions(
  expectedOwner: PublicKey,
  instructions: TransactionInstruction[],
  onSubmitted: (signature: string) => void,
  commitment: "confirmed" | "finalized" = "confirmed",
) {
  // Fetch before opening MWA: a slow/rate-limited RPC must not leave the wallet socket idle.
  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: expectedOwner,
    ...latest,
  }).add(...instructions);
  const signed = await transact(async (wallet) => {
    const owner = await authorize(wallet);
    if (!owner.equals(expectedOwner))
      throw new Error("Wallet account changed. Reconnect and try again.");
    const result = await wallet.signTransactions({
      transactions: [transaction],
    });
    return { transaction: result[0], latest };
  });
  const signature = await connection.sendRawTransaction(
    signed.transaction.serialize(),
    { skipPreflight: false, preflightCommitment: "confirmed" },
  );
  onSubmitted(signature);
  const confirmation = await connection.confirmTransaction(
    { signature, ...signed.latest },
    commitment,
  );
  if (confirmation.value.err)
    throw new Error(
      `Transaction failed: ${JSON.stringify(confirmation.value.err)}`,
    );
  return signature;
}
