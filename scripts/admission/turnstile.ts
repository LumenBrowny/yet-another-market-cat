import { AdmissionError, AdmissionStore, validateTurnstile } from "./core.ts";

export interface TurnstileOptions {
  secret: string;
  hostname: string;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Server-only adapter. Never accept hostname/action/cdata from the caller. */
export async function completeBrowserCheck(
  store: AdmissionStore,
  nonce: string,
  token: string,
  options: TurnstileOptions,
): Promise<void> {
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  store.get(nonce, now());
  if (!options.secret || !options.hostname) {
    throw new AdmissionError(503, "Browser check is not configured");
  }
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    throw new AdmissionError(400, "Invalid browser check response");
  }
  let result: unknown;
  try {
    const response = await (options.fetch ?? fetch)(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: new URLSearchParams({ secret: options.secret, response: token }),
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      },
    );
    if (!response.ok) throw new Error("Upstream unavailable");
    result = await response.json();
  } catch {
    // Do not expose provider errors or credentials. A failure never grants access.
    throw new AdmissionError(503, "Browser check temporarily unavailable");
  }
  validateTurnstile(result, options.hostname, nonce);
  // Check expiration again after the network call; no stale challenge promotion.
  store.captcha(nonce, now());
}
