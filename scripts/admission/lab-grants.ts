import { readFile, appendFile } from "node:fs/promises";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { createAdmissionChain } from "./chain.ts";
import { issueGrant } from "./issuer.ts";
import { AdmissionStore, verifyWallet } from "./core.ts";
import { readWalletSnapshot } from "../../packages/shared/src/client.ts";
import { faucetWave } from "../../packages/shared/src/admission.ts";

// Separate diagnostic adapter: immutable loopback endpoint, never arbitrary RPC input.
export async function createLocalGrantLab(store: AdmissionStore) {
  const settings = JSON.parse(
    await readFile(".dev/admission-rehearsal-current.json", "utf8"),
  );
  if (
    settings.rpc !== "http://127.0.0.1:8909" ||
    !/^\.dev\/admission-rehearsal-[0-9]+$/.test(settings.root)
  )
    throw new Error("Expected isolated local rehearsal");
  const deployment = JSON.parse(
    await readFile(`${settings.root}/deployment.json`, "utf8"),
  );
  const connection = new Connection(settings.rpc, "confirmed");
  const genesis = await connection.getGenesisHash();
  if (genesis !== settings.genesis)
    throw new Error("Rehearsal genesis mismatch");
  const chain = await createAdmissionChain(
    settings.rpc,
    settings.genesis,
    process.env.YAC_SGT_RPC ?? "https://api.mainnet-beta.solana.com",
  );
  const issuer = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(await readFile(`${settings.root}/issuer.json`, "utf8")),
    ),
  );
  const mint = new PublicKey(deployment.mint),
    now = () => Math.floor(Date.now() / 1000);
  return {
    async challenge(wallet: string) {
      const config = await chain.config();
      const wave = faucetWave(config, BigInt(now()));
      if (!wave) throw new Error("Local faucet not open");
      return {
        payload: store.issue(wallet, "https://yetanothermarket.cat", now()),
        wave,
        mint: mint.toBase58(),
        genesis,
      };
    },
    async authorize(request: {
      nonce: string;
      signature: string;
      signedMessage: string;
    }) {
      const payload = store.get(request.nonce, now()).payload;
      const owner = verifyWallet(
        payload,
        request.signature,
        request.signedMessage,
        now(),
      );
      // Test-only funding on this fixed, genesis-checked local validator.
      if ((await connection.getBalance(owner)) < 100000000) {
        const sig = await connection.requestAirdrop(owner, 1000000000);
        const latest = await connection.getLatestBlockhash();
        await connection.confirmTransaction(
          { signature: sig, ...latest },
          "confirmed",
        );
      }
      return issueGrant(store, chain, issuer, mint, request);
    },
    async state(wallet: string, signature?: string) {
      const owner = new PublicKey(wallet);
      const state = await readWalletSnapshot(connection, owner, mint);
      const result = {
        localOnly: true,
        wallet,
        mint: mint.toBase58(),
        balance: state.balance.toString(),
        claimed: state.claimed,
      };
      if (signature) {
        const tx = await connection.getTransaction(signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        if (!tx || tx.meta?.err)
          throw new Error("Local transaction not confirmed");
        const keys = tx.transaction.message.getAccountKeys().staticAccountKeys;
        if (
          tx.transaction.message.header.numRequiredSignatures !== 2 ||
          !keys[0].equals(owner) ||
          !keys[1].equals(issuer.publicKey)
        )
          throw new Error("Unexpected grant signers");
        const raw = await fetch(settings.rpc, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getTransaction",
            params: [
              signature,
              {
                encoding: "base64",
                commitment: "confirmed",
                maxSupportedTransactionVersion: 0,
              },
            ],
          }),
        }).then((response) => response.json());
        const rawTransaction = raw.result?.transaction?.[0];
        if (
          typeof rawTransaction !== "string" ||
          !Transaction.from(
            Buffer.from(rawTransaction, "base64"),
          ).verifySignatures()
        )
          throw new Error("Local transaction signature evidence unavailable");
        await appendFile(
          "local-notes/mainnet/seeker-admission-device-results.jsonl",
          JSON.stringify({
            time: new Date().toISOString(),
            localGrant: true,
            signature,
            rawTransaction,
            genesis,
            ...result,
          }) + "\n",
        );
      }
      return result;
    },
  };
}
