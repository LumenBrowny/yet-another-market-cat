import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { address, createSolanaRpc } from "@solana/kit";
import { getSeekerGenesisTokens } from "@solana-mobile/skr-genesis-token";
import { AdmissionStore, verifyWallet } from "./admission/core.ts";
import { completeBrowserCheck } from "./admission/turnstile.ts";
import { createLocalGrantLab } from "./admission/lab-grants.ts";

// Read-only diagnostic, intentionally separate from the grant issuer/server.
const store = new AdmissionStore(":memory:", randomBytes(32).toString("hex"));
const rpc = createSolanaRpc(
  process.env.YAC_SGT_RPC ?? "https://api.mainnet-beta.solana.com",
);
const now = () => Math.floor(Date.now() / 1000);
let grantLab: ReturnType<typeof createLocalGrantLab> | undefined;
const grants = () => {
  if (process.env.YAC_LAB_GRANTS !== "true")
    throw new Error("Local grants disabled");
  return (grantLab ??= createLocalGrantLab(store).catch((error) => {
    grantLab = undefined;
    throw error;
  }));
};
async function localCaptchaKeys() {
  const text = await readFile(
    "temp/turnstile/yamc-turnstile-local.txt",
    "utf8",
  );
  const key = (label: string) => {
    const matches = text
      .split(/\r?\n/)
      .filter((line) => line.toLowerCase().includes(label))
      .map((line) => line.match(/0x[A-Za-z0-9_-]+/)?.[0])
      .filter(Boolean);
    if (matches.length !== 1) throw new Error("Local test widget keys missing");
    return matches[0]!;
  };
  return { site: key("site"), secret: key("secret") };
}
const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  try {
    const url = new URL(req.url ?? "/", "http://localhost:5092");
    if (req.method === "GET" && url.pathname === "/captcha") {
      const nonce = url.searchParams.get("nonce") ?? "";
      store.get(nonce, now());
      const keys = await localCaptchaKeys(),
        scriptNonce = randomBytes(18).toString("base64");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader(
        "Content-Security-Policy",
        `default-src 'none'; script-src 'nonce-${scriptNonce}' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; style-src 'nonce-${scriptNonce}'; base-uri 'none'; frame-ancestors 'none'`,
      );
      res.end(
        `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YAMC CAPTCHA Lab</title><style nonce="${scriptNonce}">body{background:#141910;color:white;font:20px system-ui;padding:24px}</style><h1>YAMC CAPTCHA Lab</h1><p>Local test only. Complete the check and return to Admission Lab.</p><div class="cf-turnstile" data-sitekey="${keys.site}" data-action="yamc_faucet" data-cdata="${nonce}" data-callback="done"></div><p id="status"></p><script nonce="${scriptNonce}">window.done=async token=>{try{const r=await fetch('/captcha-complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nonce:'${nonce}',token})});if(!r.ok)throw new Error();document.getElementById('status').textContent='VERIFIED. Return to Admission Lab.';}catch{document.getElementById('status').textContent='Verification failed. Start a fresh check in Admission Lab.';}};</script><script nonce="${scriptNonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script></html>`,
      );
      return;
    }
    if (req.method !== "POST") throw new Error("POST required");
    store.limit("lab", "loopback", 90, now());
    let input = "";
    for await (const chunk of req) {
      input += chunk;
      if (input.length > 16384) throw new Error("Too large");
    }
    const data = JSON.parse(input);
    if (req.url === "/grant-challenge") {
      res.end(JSON.stringify(await (await grants()).challenge(data.wallet)));
    } else if (req.url === "/grant-authorize") {
      res.end(JSON.stringify(await (await grants()).authorize(data)));
    } else if (req.url === "/grant-state") {
      res.end(
        JSON.stringify(
          await (await grants()).state(data.wallet, data.signature),
        ),
      );
    } else if (req.url === "/captcha-start") {
      await localCaptchaKeys();
      const challenge = store.issue(
        data.wallet,
        "http://localhost:5092",
        now(),
      );
      res.end(
        JSON.stringify({
          nonce: challenge.nonce,
          url: `http://localhost:5092/captcha?nonce=${challenge.nonce}`,
        }),
      );
    } else if (req.url === "/captcha-status") {
      res.end(
        JSON.stringify({
          complete: store.get(data.nonce, now()).captcha === 1,
        }),
      );
    } else if (req.url === "/captcha-complete") {
      if (req.headers.origin !== "http://localhost:5092")
        throw new Error("Wrong local origin");
      const keys = await localCaptchaKeys();
      await completeBrowserCheck(store, data.nonce, data.token, {
        secret: keys.secret,
        hostname: "localhost",
      });
      await appendFile(
        "local-notes/mainnet/seeker-admission-device-results.jsonl",
        JSON.stringify({
          time: new Date().toISOString(),
          turnstile: true,
          hostname: "localhost",
          action: "yamc_faucet",
        }) + "\n",
      );
      console.log(
        "Real Turnstile verified for localhost with exact action/nonce",
      );
      res.end(JSON.stringify({ complete: true }));
    } else if (req.url === "/challenge")
      res.end(
        JSON.stringify(
          store.issue(data.wallet, "https://yetanothermarket.cat", now()),
        ),
      );
    else if (req.url === "/verify") {
      const challenge = store.get(data.nonce, now());
      const wallet = verifyWallet(
        challenge.payload,
        data.signature,
        data.signedMessage,
        now(),
      );
      console.log("SIWS signature verified; checking finalized SGT ownership");
      store.consume(data.nonce, now(), false);
      const signal = AbortSignal.timeout(15000);
      if (
        (await rpc.getGenesisHash().send({ abortSignal: signal })) !==
        "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
      )
        throw new Error("Wrong SGT network");
      const tokens = await getSeekerGenesisTokens(
        rpc,
        address(wallet.toBase58()),
        { commitment: "finalized", abortSignal: signal },
      );
      const result = {
        time: new Date().toISOString(),
        wallet: wallet.toBase58(),
        siws: true,
        mints: tokens.map((t) => t.mint),
      };
      await appendFile(
        "local-notes/mainnet/seeker-admission-device-results.jsonl",
        JSON.stringify(result) + "\n",
      );
      console.log("SIWS verified; SGT count:", result.mints.length);
      res.end(JSON.stringify(result));
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  } catch (error) {
    res.statusCode = 400;
    res.end(
      JSON.stringify({
        error:
          error instanceof Error &&
          /Wallet signature|Expired|already used|already received|Challenge|Local faucet|Local grants|browser check|No unused Seeker Genesis Token found|Wave changed/.test(
            error.message,
          )
            ? error.message
            : "Diagnostic check failed; retry or check local service/RPC.",
      }),
    );
    console.log(
      "Diagnostic failed:",
      req.url?.split("?")[0],
      error instanceof Error ? error.name : "unknown",
      error instanceof Error &&
        /^(No unused Seeker Genesis Token found|Wave changed; request a fresh sign-in|Wallet already received its allocation)$/.test(
          error.message,
        )
        ? error.message
        : "details withheld",
    );
  }
});
server.requestTimeout = 20000;
server.listen(5092, "127.0.0.1", () =>
  console.log(
    `Admission Lab on loopback 5092; local grants ${process.env.YAC_LAB_GRANTS === "true" ? "enabled" : "disabled"}`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () =>
    server.close(() => {
      store.close();
      process.exit(0);
    }),
  );
