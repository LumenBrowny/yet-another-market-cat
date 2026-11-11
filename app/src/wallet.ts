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
import {
  readCheckedConfig,
  readChainCheckedConfig,
} from "@yac/shared/src/deployment-guard";
import { isCustodyWithdrawal } from "@yac/shared/src/withdrawal-guard";
import type { SolanaSignInInput } from "@solana/wallet-standard-features";
import { submitAndConfirm } from "./transactionTransport";
export const connection = new Connection(appConfig.rpcUrl, {
  commitment: "confirmed",
  disableRetryOnRateLimit: true,
  fetch: async (input, init) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try { return await fetch(input, { ...init, signal: controller.signal }); }
    finally { clearTimeout(timeout); }
  },
});
export const cluster = appConfig.cluster;
const storageKey = `yac-wallet-${cluster}`;
const identity = {
  name: appConfig.identity,
  uri: "https://yetanothermarket.cat",
  icon: "media/favicon-014.png",
};
const identityKey = JSON.stringify(identity);
type Session = { authToken: string; address: string; identity?: string };
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
async function authorize(wallet: Web3MobileWallet, requireBackend = true) {
  if (appConfig.profile === "mainnet")
    await (requireBackend ? readCheckedConfig : readChainCheckedConfig)(
      connection,
      appConfig,
    );
  if (
    appConfig.rehearsalGenesis &&
    (await connection.getGenesisHash()) !== appConfig.rehearsalGenesis
  )
    throw new Error("Local rehearsal genesis mismatch");
  const previous = await readSession();
  // Localnet uses a dev wallet with local RPC; signTransactions lets the app submit to its own RPC.
  const result = await wallet.authorize({
    identity,
    chain:
      cluster === "mainnet-beta"
        ? "solana:mainnet"
        : cluster === "localnet"
          ? "solana:localnet"
          : "solana:devnet",
    // Old grants may keep the former display name/site in wallet UI. Request
    // fresh consent once after branding changes, without clearing the address.
    auth_token:
      previous?.identity === identityKey ? previous.authToken : undefined,
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
      identity: identityKey,
    } satisfies Session),
  );
  return owner;
}
export const connectWallet = () =>
  transact((wallet) => authorize(wallet, false));
export async function signAdmission(
  expectedOwner: PublicKey,
  payload: SolanaSignInInput,
) {
  if (appConfig.profile === "mainnet")
    await readCheckedConfig(connection, appConfig);
  if (
    payload.address !== expectedOwner.toBase58() ||
    payload.domain !==
      (appConfig.rehearsalGenesis
        ? "localhost:5088"
        : "yetanothermarket.cat") ||
    payload.uri !==
      (appConfig.rehearsalGenesis
        ? "http://localhost:5088"
        : "https://yetanothermarket.cat") ||
    payload.chainId !== "solana:mainnet"
  )
    throw new Error("Unexpected sign-in request");
  return transact(async (wallet) => {
    const result = await wallet.authorize({
      identity,
      chain: "solana:mainnet",
      sign_in_payload: payload,
    });
    const proof = result.sign_in_result;
    if (
      !proof ||
      !new PublicKey(Buffer.from(proof.address, "base64")).equals(expectedOwner)
    )
      throw new Error("Wallet did not return the requested sign-in");
    return { signature: proof.signature, signedMessage: proof.signed_message };
  });
}
export async function sendAdmission(
  expectedOwner: PublicKey,
  transaction: Transaction,
  lastValidBlockHeight: number,
  onSubmitted: (signature: string) => void,
) {
  const message = transaction.serializeMessage();
  const signed = await transact(async (wallet) => {
    const owner = await authorize(wallet);
    if (!owner.equals(expectedOwner))
      throw new Error("Wallet changed; reconnect");
    const results = await wallet.signTransactions({
      transactions: [transaction],
    });
    if (!results[0] || !results[0].serializeMessage().equals(message))
      throw new Error("Wallet changed the faucet transaction");
    return results[0];
  });
  return submitAndConfirm(connection, signed.serialize(), signed.signature!, lastValidBlockHeight, onSubmitted);
}
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
  const custodyOnly =
    appConfig.profile === "mainnet" &&
    !!appConfig.tokenMint &&
    isCustodyWithdrawal(
      transaction.instructions,
      expectedOwner,
      new PublicKey(appConfig.tokenMint),
    );
  const message = transaction.serializeMessage();
  const signed = await transact(async (wallet) => {
    const owner = await authorize(wallet, !custodyOnly);
    if (!owner.equals(expectedOwner))
      throw new Error("Wallet account changed. Reconnect and try again.");
    const result = await wallet.signTransactions({
      transactions: [transaction],
    });
    if (!result[0] || !result[0].serializeMessage().equals(message))
      throw new Error("Wallet changed the transaction");
    return { transaction: result[0], latest };
  });
  return submitAndConfirm(connection, signed.transaction.serialize(), signed.transaction.signature!, signed.latest.lastValidBlockHeight, onSubmitted, commitment);
}
