import { createHmac, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { PublicKey } from "@solana/web3.js";
import { verifySignIn } from "@solana/wallet-standard-util";
import type { SolanaSignInInput } from "@solana/wallet-standard-features";

export class AdmissionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export class AdmissionStore {
  readonly db: DatabaseSync;
  constructor(
    path: string,
    private salt: string,
  ) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS challenges(nonce TEXT PRIMARY KEY,payload TEXT NOT NULL,expires INTEGER NOT NULL,captcha INTEGER NOT NULL DEFAULT 0,consumed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,hits INTEGER NOT NULL,expires INTEGER NOT NULL);`);
  }
  limit(scope: string, value: string, maximum: number, now: number) {
    const window = Math.floor(now / 60);
    const key = createHmac("sha256", this.salt)
      .update(`${scope}:${value}:${window}`)
      .digest("hex");
    const row = this.db
      .prepare(
        `INSERT INTO limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET hits=hits+1 RETURNING hits`,
      )
      .get(key, (window + 1) * 60) as { hits: number };
    if (row.hits > maximum)
      throw new AdmissionError(429, "Please wait before trying again");
  }
  issue(
    address: string,
    origin: string,
    now: number,
  ): SolanaSignInInput & { nonce: string; address: string } {
    if (new PublicKey(address).toBase58() !== address)
      throw new AdmissionError(400, "Invalid wallet");
    this.db.prepare("DELETE FROM challenges WHERE expires <= ?").run(now);
    this.db.prepare("DELETE FROM limits WHERE expires <= ?").run(now);
    const payload = {
      address,
      domain: new URL(origin).host,
      uri: origin,
      version: "1",
      chainId: "solana:mainnet",
      nonce: randomBytes(24).toString("hex"),
      issuedAt: new Date(now * 1000).toISOString(),
      expirationTime: new Date((now + 300) * 1000).toISOString(),
      statement:
        "Feed the cat. Claim your shit. Authenticate for one faucet allocation.",
    };
    this.db
      .prepare("INSERT INTO challenges(nonce,payload,expires) VALUES (?,?,?)")
      .run(payload.nonce, JSON.stringify(payload), now + 300);
    return payload;
  }
  get(nonce: string, now: number) {
    if (!/^[0-9a-f]{48}$/.test(nonce))
      throw new AdmissionError(400, "Invalid challenge");
    const row = this.db
      .prepare(
        "SELECT * FROM challenges WHERE nonce=? AND expires>? AND consumed=0",
      )
      .get(nonce, now) as { payload: string; captcha: number } | undefined;
    if (!row)
      throw new AdmissionError(400, "Challenge expired or already used");
    return {
      ...row,
      payload: JSON.parse(row.payload) as SolanaSignInInput & {
        address: string;
        nonce: string;
      },
    };
  }
  captcha(nonce: string, now: number) {
    this.get(nonce, now);
    this.db
      .prepare(
        "UPDATE challenges SET captcha=1 WHERE nonce=? AND consumed=0 AND expires>?",
      )
      .run(nonce, now);
  }
  consume(nonce: string, now: number, requireCaptcha: boolean) {
    const row = this.get(nonce, now);
    if (requireCaptcha && !row.captcha)
      throw new AdmissionError(403, "Complete the browser check first");
    const result = this.db
      .prepare(
        "UPDATE challenges SET consumed=1 WHERE nonce=? AND consumed=0 AND expires>?",
      )
      .run(nonce, now);
    if (result.changes !== 1)
      throw new AdmissionError(400, "Challenge already used");
    return row.payload;
  }
  close() {
    this.db.close();
  }
}
export function verifyWallet(
  payload: SolanaSignInInput & { address: string },
  signature: string,
  signedMessage: string,
  now: number,
) {
  if (
    !payload.expirationTime ||
    Date.parse(payload.expirationTime) <= now * 1000
  )
    throw new AdmissionError(400, "Expired sign-in");
  if (
    typeof signature !== "string" ||
    typeof signedMessage !== "string" ||
    signature.length > 128 ||
    signedMessage.length > 8192
  )
    throw new AdmissionError(400, "Invalid sign-in");
  const key = new PublicKey(payload.address);
  const sig = Buffer.from(signature, "base64"),
    message = Buffer.from(signedMessage, "base64");
  if (
    sig.length !== 64 ||
    !verifySignIn(payload, {
      account: {
        address: payload.address,
        publicKey: key.toBytes(),
        chains: ["solana:mainnet"],
        features: [],
      },
      signature: sig,
      signedMessage: message,
    })
  )
    throw new AdmissionError(
      403,
      "Wallet signature did not match the issued challenge",
    );
  return key;
}
export function validateTurnstile(
  result: unknown,
  hostname: string,
  nonce: string,
) {
  const value = result as {
    success?: boolean;
    hostname?: string;
    action?: string;
    cdata?: string;
  };
  if (
    !value ||
    value.success !== true ||
    value.hostname !== hostname ||
    value.action !== "yamc_faucet" ||
    value.cdata !== nonce
  )
    throw new AdmissionError(403, "Browser check failed");
}
