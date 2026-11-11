import React, { useState } from "react";
import { ScrollView, Text, Pressable, Linking, AppState } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { PublicKey, Connection } from "@solana/web3.js";
import { Buffer } from "buffer";
import { signAdmission } from "./wallet";
import { readConfig } from "@yac/shared/src/client";
import { validateGrant } from "@yac/shared/src/admission";

// Separate package. Grant transactions can only be sent to the USB local validator.
export default function AdmissionLab() {
  const [owner, setOwner] = useState<PublicKey | null>(null),
    [status, setStatus] = useState(
      "Read-only rehearsal: connect a mainnet wallet, then prove ownership and inspect SGT.",
    ),
    [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const request = async (path: string, data: unknown) => {
    const response = await fetch(`http://127.0.0.1:5092/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error ?? "Diagnostic service unavailable");
    return result;
  };
  const localGrant = async () => {
    if (!owner) return;
    setStatus(
      "LOCAL FAUCET: sign in, then approve a local test-token transaction. Mainnet funds are not used.",
    );
    const challenge = await request("grant-challenge", {
      wallet: owner.toBase58(),
    });
    const local = new Connection("http://127.0.0.1:8909", "confirmed");
    if ((await local.getGenesisHash()) !== challenge.genesis)
      throw new Error("Local network mismatch");
    const proof = await signAdmission(owner, challenge.payload);
    if (challenge.wave === 2) {
      setStatus("Open wave: complete CAPTCHA and return here.");
      await Linking.openURL(
        `http://localhost:5092/captcha?nonce=${encodeURIComponent(challenge.payload.nonce)}`,
      );
      const until = Date.now() + 240000;
      let complete = false;
      while (Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        if (AppState.currentState !== "active") continue;
        if (
          (await request("captcha-status", { nonce: challenge.payload.nonce }))
            .complete === true
        ) {
          complete = true;
          break;
        }
      }
      if (!complete) throw new Error("CAPTCHA expired");
    }
    setStatus("Checking admission; obtaining server signature…");
    const grant = await request("grant-authorize", {
      nonce: challenge.payload.nonce,
      ...proof,
    });
    const config = await readConfig(local, "finalized");
    if (!config || config.tokenMint.toBase58() !== challenge.mint)
      throw new Error("Local mint mismatch");
    const tx = validateGrant(
      grant,
      owner,
      config,
      Math.floor(Date.now() / 1000),
    );
    const message = tx.serializeMessage();
    setStatus(
      "Server signature verified. Approve the LOCAL test faucet transaction in your wallet.",
    );
    const signed = await transact(async (wallet) => {
      const auth = await wallet.authorize({
        identity: {
          name: "YAMC — LOCAL faucet test",
          uri: "https://yetanothermarket.cat",
          icon: "media/favicon-014.png",
        },
        chain: "solana:devnet",
      });
      if (
        !auth.accounts[0] ||
        !new PublicKey(Buffer.from(auth.accounts[0].address, "base64")).equals(
          owner,
        )
      )
        throw new Error("Wallet changed");
      const transactions = await wallet.signTransactions({
        transactions: [tx],
      });
      if (
        !transactions[0] ||
        !transactions[0].serializeMessage().equals(message)
      )
        throw new Error("Wallet changed the transaction");
      if (!transactions[0].verifySignatures())
        throw new Error("Missing or invalid wallet/server signature");
      return transactions[0];
    });
    const signature = await local.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
    });
    setStatus("Submitted ONLY to local validator; waiting for confirmation…");
    const confirmation = await local.confirmTransaction(
      {
        signature,
        blockhash: tx.recentBlockhash!,
        lastValidBlockHeight: grant.lastValidBlockHeight,
      },
      "confirmed",
    );
    if (confirmation.value.err) throw new Error("Local transaction failed");
    const state = await request("grant-state", {
      wallet: owner.toBase58(),
      signature,
    });
    setStatus(
      `LOCAL FAUCET CONFIRMED\nBalance: ${Number(state.balance) / 1000000} test CATSHIT\nReceipt: ${state.claimed}\nBoth signatures verified.\n${signature}`,
    );
  };
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#141910" }}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }}>
          <Text style={{ color: "#c5f47d", fontSize: 28, fontWeight: "bold" }}>
            YAMC Admission Lab
          </Text>
          <Text style={{ color: "white" }}>
            LOCAL DIAGNOSTIC · MAINNET FUNDS NOT USED
          </Text>
          <Text selectable style={{ color: "white" }}>
            {owner?.toBase58() ?? "No wallet selected"}
          </Text>
          <Pressable
            disabled={busy}
            style={{
              backgroundColor: "#c5f47d",
              padding: 20,
              opacity: busy ? 0.5 : 1,
            }}
            onPress={() =>
              void run(async () => {
                const result = await transact((wallet) =>
                  wallet.authorize({
                    identity: {
                      name: "Yet Another Market Cat — Admission Lab",
                      uri: "https://yetanothermarket.cat",
                      icon: "media/favicon-014.png",
                    },
                    chain: "solana:mainnet",
                  }),
                );
                if (!result.accounts[0]) throw new Error("No account returned");
                setOwner(
                  new PublicKey(
                    Buffer.from(result.accounts[0].address, "base64"),
                  ),
                );
                setStatus("Wallet selected. Tap VERIFY SIWS + SGT.");
              })
            }
          >
            <Text>CONNECT MAINNET WALLET</Text>
          </Pressable>
          <Pressable
            disabled={busy || !owner}
            style={{
              backgroundColor: "#c5f47d",
              padding: 20,
              opacity: busy || !owner ? 0.5 : 1,
            }}
            onPress={() =>
              void run(async () => {
                if (!owner) return;
                setStatus("Requesting one-time sign-in…");
                const payload = await request("challenge", {
                  wallet: owner.toBase58(),
                });
                const proof = await signAdmission(owner, payload);
                setStatus(
                  "Checking signature and finalized mainnet SGT ownership…",
                );
                const result = await request("verify", {
                  nonce: payload.nonce,
                  ...proof,
                });
                setStatus(
                  `SIWS VERIFIED\nSGT: ${result.mints.length ? "FOUND" : "NOT FOUND"}\n${result.mints.join("\n")}\nNo allocation issued. No transaction sent.`,
                );
              })
            }
          >
            <Text>VERIFY SIWS + SGT</Text>
          </Pressable>
          <Pressable
            disabled={busy || !owner}
            style={{
              backgroundColor: "#c5f47d",
              padding: 20,
              opacity: busy || !owner ? 0.5 : 1,
            }}
            onPress={() =>
              void run(async () => {
                if (!owner) return;
                const challenge = await request("captcha-start", {
                  wallet: owner.toBase58(),
                });
                setStatus("Complete CAPTCHA in the browser, then return here.");
                await Linking.openURL(challenge.url);
                const until = Date.now() + 240000;
                while (Date.now() < until) {
                  await new Promise((resolve) => setTimeout(resolve, 3000));
                  if (AppState.currentState !== "active") continue;
                  if (
                    (
                      await request("captcha-status", {
                        nonce: challenge.nonce,
                      })
                    ).complete === true
                  ) {
                    setStatus(
                      "TURNSTILE VERIFIED\nReal provider response checked by server.\nLocal diagnostic only; no allocation issued.",
                    );
                    return;
                  }
                }
                throw new Error("CAPTCHA expired; start again");
              })
            }
          >
            <Text>CHECK TURNSTILE (LOCAL WIDGET)</Text>
          </Pressable>
          <Pressable
            disabled={busy || !owner}
            style={{
              backgroundColor: "#edc17c",
              padding: 20,
              opacity: busy || !owner ? 0.5 : 1,
            }}
            onPress={() => void run(localGrant)}
          >
            <Text>CLAIM LOCAL TEST FAUCET</Text>
          </Pressable>
          <Text
            selectable
            style={{ color: "white", fontSize: 17, lineHeight: 25 }}
          >
            {status}
          </Text>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
