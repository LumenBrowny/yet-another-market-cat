import { AppState, Linking } from "react-native";
import { type PublicKey } from "@solana/web3.js";
import { type SolanaSignInInput } from "@solana/wallet-standard-features";
import { readConfig } from "@yac/shared/src/client";
import { validateGrant, type GrantEnvelope } from "@yac/shared/src/admission";
import { appConfig } from "./config";
import { connection, sendAdmission, signAdmission } from "./wallet";

export async function claimAdmitted(
  owner: PublicKey,
  message: (text: string) => void,
  onSubmitted: (signature: string) => void,
) {
  async function request(path: string, data?: unknown) {
    // Hermes/RN supports AbortController, but not AbortSignal.timeout.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(`${appConfig.apiUrl}/api/faucet/${path}`, {
        method: data === undefined ? "GET" : "POST",
        headers:
          data === undefined ? {} : { "Content-Type": "application/json" },
        body: data === undefined ? undefined : JSON.stringify(data),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "Faucet unavailable",
        );
      return result;
    } finally {
      clearTimeout(timer);
    }
  }
  message(
    "Sign in with your mainnet wallet to request an allocation. This signature does not send a transaction…",
  );
  const challenge = (await request("challenge", {
    wallet: owner.toBase58(),
  })) as {
    payload: SolanaSignInInput & { nonce: string };
    wave: 1 | 2;
    captchaUrl: string;
  };
  if (challenge.wave !== 1 && challenge.wave !== 2)
    throw new Error("Unexpected faucet wave; refresh and try again");
  const proof = await signAdmission(owner, challenge.payload);
  if (challenge.wave === 2) {
    const url = new URL(challenge.captchaUrl);
    if (
      url.origin !==
        (appConfig.rehearsalGenesis
          ? "http://localhost:5088"
          : "https://yetanothermarket.cat") ||
      url.pathname !== (appConfig.profile === "mainnet" ? "/mainnet/api/faucet/captcha" : "/api/faucet/captcha") ||
      url.searchParams.get("nonce") !== challenge.payload.nonce
    )
      throw new Error("Unexpected browser-check URL");
    message(
      "Complete the browser check, then return here. No allocation is reserved yet.",
    );
    await Linking.openURL(url.toString());
    const until = Date.now() + 240000;
    let completed = false;
    while (Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      if (AppState.currentState !== "active") continue;
      const status = await request(
        `status?nonce=${encodeURIComponent(challenge.payload.nonce)}`,
      );
      if (status.complete === true) {
        completed = true;
        break;
      }
    }
    if (!completed) throw new Error("Browser check expired; start again");
  }
  message(
    challenge.wave === 1
      ? "Checking Seeker Genesis Token ownership and prior allocations…"
      : "Checking your browser verification and prior allocations…",
  );
  const grant = (await request("authorize", {
    nonce: challenge.payload.nonce,
    ...proof,
  })) as GrantEnvelope;
  const config = await readConfig(connection, "finalized");
  if (!config) throw new Error("On-chain configuration unavailable");
  const transaction = validateGrant(
    grant,
    owner,
    config,
    Math.floor(Date.now() / 1000),
  );
  message("Approve your 1,000 CATSHIT allocation in the wallet…");
  await sendAdmission(
    owner,
    transaction,
    grant.lastValidBlockHeight,
    onSubmitted,
  );
}
