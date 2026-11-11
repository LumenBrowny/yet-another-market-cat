import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import { AdmissionError, AdmissionStore } from "./core.ts";
import { issueGrant, type AdmissionChain } from "./issuer.ts";
import { faucetWave } from "../../packages/shared/src/admission.ts";
import { completeBrowserCheck } from "./turnstile.ts";

export interface AdmissionHttpOptions {
  origin: string;
  proxySecret: string;
  siteKey: string;
  turnstileSecret: string;
  store: AdmissionStore;
  chain: AdmissionChain;
  issuer: Keypair;
  mint: PublicKey;
  localRehearsal?: boolean;
  publicApiPath?: "/api/faucet" | "/mainnet/api/faucet";
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
async function body(req: IncomingMessage) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new AdmissionError(415, "JSON required");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new AdmissionError(413, "Request too large");
    chunks.push(Buffer.from(chunk));
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString());
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new AdmissionError(400, "Invalid JSON");
  }
}
function textField(value: unknown) {
  if (typeof value !== "string") throw new AdmissionError(400, "Missing field");
  return value;
}
function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}
export function createAdmissionServer(options: AdmissionHttpOptions) {
  const origin = new URL(options.origin);
  const publicApiPath = options.publicApiPath ?? "/api/faucet";
  if (!["/api/faucet", "/mainnet/api/faucet"].includes(publicApiPath))
    throw new Error("Unexpected public admission path");
  if (
    origin.origin !== options.origin ||
    (origin.protocol !== "https:" &&
      !(
        options.localRehearsal === true &&
        options.origin === "http://localhost:5088"
      )) ||
    !options.siteKey ||
    !options.turnstileSecret ||
    options.proxySecret.length < 32
  )
    throw new Error(
      "Explicit HTTPS origin, Turnstile keys and private proxy secret required",
    );
  let active = 0;
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    let counted = false;
    try {
      const supplied = Buffer.from(
        String(req.headers["x-yamc-admission-secret"] ?? ""),
      );
      const expected = Buffer.from(options.proxySecret);
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      )
        throw new AdmissionError(403, "Private service");
      if (active >= 8) throw new AdmissionError(429, "Please retry shortly");
      active++;
      counted = true;
      const now = () => Math.floor(Date.now() / 1000),
        url = new URL(req.url ?? "/", options.origin);
      const ip = String(req.headers["x-yamc-client-ip"] ?? "unknown");
      options.store.limit("requests", ip, 90, now());
      if (req.method === "POST" && url.pathname === "/challenge") {
        options.store.limit("challenge-ip", ip, 12, now());
        const data = await body(req),
          wallet = textField(data.wallet);
        try {
          new PublicKey(wallet);
        } catch {
          throw new AdmissionError(400, "Invalid wallet");
        }
        options.store.limit("challenge-wallet", wallet, 4, now());
        const wave = faucetWave(await options.chain.config(), BigInt(now()));
        if (!wave) throw new AdmissionError(409, "Faucet is not open");
        const payload = options.store.issue(wallet, options.origin, now());
        return json(res, {
          payload,
          wave,
          captchaUrl: `${options.origin}${publicApiPath}/captcha?nonce=${payload.nonce}`,
        });
      }
      if (req.method === "GET" && url.pathname === "/status") {
        const challenge = options.store.get(
          url.searchParams.get("nonce") ?? "",
          now(),
        );
        return json(res, { complete: challenge.captcha === 1 });
      }
      if (req.method === "POST" && url.pathname === "/captcha-complete") {
        options.store.limit("captcha", ip, 12, now());
        if (req.headers.origin !== options.origin)
          throw new AdmissionError(403, "Wrong origin");
        const data = await body(req);
        await completeBrowserCheck(
          options.store,
          textField(data.nonce),
          textField(data.token),
          { secret: options.turnstileSecret, hostname: origin.hostname },
        );
        return json(res, { complete: true });
      }
      if (req.method === "POST" && url.pathname === "/authorize") {
        options.store.limit("authorize", ip, 12, now());
        const data = await body(req);
        return json(
          res,
          await issueGrant(
            options.store,
            options.chain,
            options.issuer,
            options.mint,
            {
              nonce: textField(data.nonce),
              signature: textField(data.signature),
              signedMessage: textField(data.signedMessage),
            },
          ),
        );
      }
      if (req.method === "GET" && url.pathname === "/captcha") {
        const nonce = url.searchParams.get("nonce") ?? "";
        options.store.get(nonce, now());
        const cspNonce = randomBytes(18).toString("base64"),
          ca = url.searchParams.get("lang") === "ca";
        res.setHeader(
          "Content-Security-Policy",
          `default-src 'none'; script-src 'nonce-${cspNonce}' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; style-src 'nonce-${cspNonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        );
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><html lang="${ca ? "ca" : "en"}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YAMC — ${ca ? "Verificació" : "Browser check"}</title><style nonce="${cspNonce}">body{background:#151a18;color:#eef3e6;font:18px system-ui;padding:24px;max-width:560px;margin:40px auto}a{color:#c4ed7c}</style><h1>Feed the cat. Claim your shit.</h1><p>${ca ? "Completa la verificació i torna a l’aplicació. Això no reserva cap assignació." : "Complete the check, then return to the app. This does not reserve an allocation."}</p><div class="cf-turnstile" data-sitekey="${escape(options.siteKey)}" data-action="yamc_faucet" data-cdata="${nonce}" data-callback="completeCheck" data-language="${ca ? "ca" : "en"}"></div><p id="status"></p><a href="?nonce=${nonce}&lang=${ca ? "en" : "ca"}">${ca ? "English" : "Català"}</a><script nonce="${cspNonce}">window.completeCheck=async function(token){const el=document.getElementById('status');try{const response=await fetch('${publicApiPath}/captcha-complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nonce:'${nonce}',token})});if(!response.ok)throw new Error();el.textContent=${JSON.stringify(ca ? "Verificació completada. Torna a l’aplicació." : "Check complete. Return to the app.")};}catch{el.textContent=${JSON.stringify(ca ? "No s’ha pogut completar. Torna a l’aplicació i inicia una nova verificació." : "Could not complete. Return to the app and start a new check.")};}};</script><script nonce="${cspNonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script></html>`,
        );
        return;
      }
      throw new AdmissionError(404, "Not found");
    } catch (error) {
      if (!res.headersSent)
        json(
          res,
          {
            error:
              error instanceof AdmissionError
                ? error.message
                : "Admission temporarily unavailable",
          },
          error instanceof AdmissionError ? error.status : 503,
        );
      else res.end();
    } finally {
      if (counted) active--;
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}
