import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import { AdmissionStore } from "../scripts/admission/core.ts";
import { completeBrowserCheck } from "../scripts/admission/turnstile.ts";
import { createPrivateKey, sign } from "node:crypto";
import { createSignInMessage } from "@solana/wallet-standard-util";
import { type Config } from "../packages/shared/src/client.ts";
import { validateGrant } from "../packages/shared/src/admission.ts";
import {
  issueGrant,
  type AdmissionChain,
} from "../scripts/admission/issuer.ts";
import { verifyWallet } from "../scripts/admission/core.ts";
import { createAdmissionServer } from "../scripts/admission/http.ts";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { createAdmissionChain } from "../scripts/admission/chain.ts";
import { admissionStatus } from "../app/src/admissionStatus.ts";

test("mobile admission respects wave boundaries and separates faucet exhaustion from locking", () => {
  const key = Keypair.generate().publicKey;
  const config: Config = {
    admin: key,
    tokenMint: key,
    faucetIssuer: key,
    minLockAmount: 1000000000n,
    unlockCooldownSeconds: 86400n,
    faucetDistributed: 0n,
    launchMode: true,
    activatedAt: 300n,
    ppCutoff: 0n,
    totalAllocated: 0n,
    faucetOpensAt: 100n,
    waveTwoAt: 200n,
  };
  assert(admissionStatus(config, 99n, false).disabled);
  const first = admissionStatus(config, 100n, false);
  assert.match(first.title, /WAVE 1/);
  assert.equal(first.disabled, false);
  assert.equal(first.locksClosed, false);
  assert.match(first.mining!, /NOT ACCRUING/);
  assert.equal(first.miningPending, true);
  assert.match(admissionStatus(config, 199n, false).title, /WAVE 1/);
  assert.match(admissionStatus(config, 200n, false).title, /WAVE 2/);
  assert.equal(admissionStatus(config, 300n, false).mining, null);
  assert.equal(admissionStatus(config, 299n, false).miningPending, true);
  assert.equal(admissionStatus(config, 300n, false).miningPending, false);
  assert(admissionStatus(config, 300n, true).disabled);
  const exhausted = admissionStatus(
    { ...config, faucetDistributed: 1000000000000n },
    300n,
    false,
  );
  assert(exhausted.disabled);
  assert.equal(exhausted.locksClosed, false);
  const terminal = admissionStatus({ ...config, ppCutoff: 400n }, 400n, false);
  assert(terminal.disabled && terminal.locksClosed);
  assert.match(terminal.mining!, /FROZEN/);
  assert.match(
    admissionStatus(
      { ...config, faucetOpensAt: 0n, activatedAt: 0n },
      10n,
      false,
    ).title,
    /NOT SCHEDULED/,
  );
});

test("admission RPC startup accepts full mainnet genesis and rejects truncated or mismatched networks", async () => {
  const grantGenesis = Keypair.generate().publicKey.toBase58();
  let sgtGenesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
  const rpc = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: input.id,
        result: req.url === "/grant" ? grantGenesis : sgtGenesis,
      }),
    );
  });
  rpc.listen(0, "127.0.0.1");
  await once(rpc, "listening");
  const url = `http://127.0.0.1:${(rpc.address() as AddressInfo).port}`;
  try {
    await createAdmissionChain(url + "/grant", grantGenesis, url + "/sgt");
    sgtGenesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
    await assert.rejects(
      createAdmissionChain(url + "/grant", grantGenesis, url + "/sgt"),
      /mainnet/,
    );
    await assert.rejects(
      createAdmissionChain(url + "/grant", "wrong-network", url + "/sgt"),
      /Wrong grant network/,
    );
  } finally {
    rpc.closeAllConnections();
    await new Promise<void>((resolve) => rpc.close(() => resolve()));
  }
});

test("HTTP origin exception requires explicit rehearsal and exact USB origin", () => {
  const { store } = fixture();
  const options = {
    store,
    origin: "http://localhost:5088",
    proxySecret: "x".repeat(40),
    siteKey: "test",
    turnstileSecret: "test",
    issuer: Keypair.generate(),
    mint: Keypair.generate().publicKey,
    chain: {} as AdmissionChain,
  };
  try {
    assert.throws(() => createAdmissionServer(options));
    const server = createAdmissionServer({ ...options, localRehearsal: true });
    server.close();
    for (const origin of [
      "http://localhost:5089",
      "http://127.0.0.1:5088",
      "http://example.com",
    ])
      assert.throws(() =>
        createAdmissionServer({ ...options, origin, localRehearsal: true }),
      );
  } finally {
    store.close();
  }
});
test("private HTTP service rejects missing credentials and renders an escaped, nonce-bound CAPTCHA page", async () => {
  const { store, challenge } = fixture();
  const issuer = Keypair.generate();
  // Use a live timestamp only for this HTTP route test.
  const live = store.issue(
    challenge.address,
    "https://yetanothermarket.cat",
    Math.floor(Date.now() / 1000),
  );
  const secret = "x".repeat(40);
  const server = createAdmissionServer({
    store,
    origin: "https://yetanothermarket.cat",
    proxySecret: secret,
    siteKey: 'test" onload="alert(1)',
    publicApiPath: "/mainnet/api/faucet",
    turnstileSecret: "test",
    issuer,
    mint: Keypair.generate().publicKey,
    chain: {
      config: async () => {
        throw new Error("private RPC details");
      },
      claimed: async () => false,
      usedSubject: async () => false,
      seekerMints: async () => [],
      blockhash: async () => {
        throw new Error();
      },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal(
      (await fetch(`${url}/status?nonce=${live.nonce}`)).status,
      403,
    );
    const headers = {
      "x-yamc-admission-secret": secret,
      "x-yamc-client-ip": "127.0.0.1",
    };
    const page = await fetch(`${url}/captcha?nonce=${live.nonce}&lang=ca`, {
      headers,
    });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.match(
      page.headers.get("content-security-policy")!,
      /script-src 'nonce-/,
    );
    const html = await page.text();
    assert.match(html, /<html lang="ca">/);
    assert.match(html, /test&quot; onload=&quot;/);
    assert.ok(html.includes("fetch('/mainnet/api/faucet/captcha-complete'"));
    assert.equal(
      (await fetch(`${url}/captcha?nonce=%22%3Escript`, { headers })).status,
      400,
    );
    const outage = await fetch(`${url}/challenge`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: challenge.address }),
    });
    assert.equal(outage.status, 503);
    assert.doesNotMatch(await outage.text(), /private RPC/);
    assert.equal(
      (
        await fetch(`${url}/captcha-complete`, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            Origin: "https://attacker.invalid",
          },
          body: "{}",
        })
      ).status,
      403,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});

test("rate windows and single-use challenge consumption reject repeated requests", () => {
  const { store, challenge } = fixture();
  try {
    store.limit("wallet", challenge.address, 1, 1000);
    assert.throws(
      () => store.limit("wallet", challenge.address, 1, 1001),
      /wait/,
    );
    store.limit("wallet", challenge.address, 1, 1020);
    store.consume(challenge.nonce, 1001, false);
    assert.throws(
      () => store.consume(challenge.nonce, 1001, false),
      /already used/,
    );
  } finally {
    store.close();
  }
});

function signed(store: AdmissionStore, wallet = Keypair.generate()) {
  const payload = store.issue(
    wallet.publicKey.toBase58(),
    "https://yetanothermarket.cat",
    1000,
  );
  const message = createSignInMessage({ ...payload, domain: payload.domain! });
  const key = createPrivateKey({
    format: "der",
    type: "pkcs8",
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(wallet.secretKey.slice(0, 32)),
    ]),
  });
  return {
    payload,
    wallet,
    request: {
      nonce: payload.nonce,
      signature: sign(null, message, key).toString("base64"),
      signedMessage: Buffer.from(message).toString("base64"),
    },
  };
}
test("SIWS binds wallet, domain, message and lifetime", () => {
  const { store } = fixture();
  try {
    const { payload, wallet, request } = signed(store);
    assert(
      verifyWallet(
        payload,
        request.signature,
        request.signedMessage,
        1001,
      ).equals(wallet.publicKey),
    );
    for (const change of [
      { domain: "attacker.invalid" },
      { address: Keypair.generate().publicKey.toBase58() },
      { nonce: "different" },
    ])
      assert.throws(() =>
        verifyWallet(
          { ...payload, ...change },
          request.signature,
          request.signedMessage,
          1001,
        ),
      );
    assert.throws(
      () =>
        verifyWallet(payload, request.signature, request.signedMessage, 1300),
      /Expired/,
    );
  } finally {
    store.close();
  }
});
test("issuer requires SGT or CAPTCHA and exact signed transaction passes client validation", async () => {
  const { store } = fixture();
  try {
    const issuer = Keypair.generate(),
      mint = Keypair.generate().publicKey,
      sgt = Keypair.generate().publicKey;
    const config: Config = {
      admin: issuer.publicKey,
      tokenMint: mint,
      minLockAmount: 1000000000n,
      unlockCooldownSeconds: 86400n,
      faucetDistributed: 0n,
      launchMode: true,
      activatedAt: 1500n,
      ppCutoff: 0n,
      totalAllocated: 0n,
      faucetOpensAt: 1000n,
      waveTwoAt: 1200n,
      faucetIssuer: issuer.publicKey,
    };
    const chain: AdmissionChain = {
      config: async () => config,
      claimed: async () => false,
      usedSubject: async () => false,
      seekerMints: async () => [sgt],
      blockhash: async () => ({
        blockhash: Keypair.generate().publicKey.toBase58(),
        lastValidBlockHeight: 100,
      }),
    };
    const first = signed(store);
    const envelope = await issueGrant(
      store,
      chain,
      issuer,
      mint,
      first.request,
      () => 1001,
    );
    assert.equal(envelope.subject, sgt.toBase58());
    validateGrant(envelope, first.wallet.publicKey, config, 1001);
    assert.throws(() =>
      validateGrant(
        { ...envelope, subject: Keypair.generate().publicKey.toBase58() },
        first.wallet.publicKey,
        config,
        1001,
      ),
    );
    await assert.rejects(
      issueGrant(store, chain, issuer, mint, first.request, () => 1001),
      /already used/,
    );
    await assert.rejects(
      issueGrant(
        store,
        { ...chain, seekerMints: async () => [] },
        issuer,
        mint,
        signed(store).request,
        () => 1001,
      ),
      /No unused/,
    );
    await assert.rejects(
      issueGrant(
        store,
        { ...chain, usedSubject: async () => true },
        issuer,
        mint,
        signed(store).request,
        () => 1001,
      ),
      /No unused/,
    );
    const second = signed(store);
    await assert.rejects(
      issueGrant(store, chain, issuer, mint, second.request, () => 1200),
      /browser check/,
    );
    store.captcha(second.request.nonce, 1200);
    const open = await issueGrant(
      store,
      {
        ...chain,
        seekerMints: async () => {
          throw new Error("SGT must not be checked in wave 2");
        },
      },
      issuer,
      mint,
      second.request,
      () => 1200,
    );
    assert.equal(open.wave, 2);
    assert.equal(open.subject, second.wallet.publicKey.toBase58());
    validateGrant(open, second.wallet.publicKey, config, 1200);
  } finally {
    store.close();
  }
});

function fixture() {
  const store = new AdmissionStore(":memory:", "local-test-only-rate-salt");
  const challenge = store.issue(
    Keypair.generate().publicKey.toBase58(),
    "https://yetanothermarket.cat",
    1000,
  );
  return { store, challenge };
}
function provider(result: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(result), { status: 200 })) as typeof fetch;
}
test("browser verification binds hostname, action and nonce, then allows one consumption", async () => {
  const { store, challenge } = fixture();
  try {
    assert.throws(
      () => store.consume(challenge.nonce, 1001, true),
      /browser check/,
    );
    await completeBrowserCheck(store, challenge.nonce, "token", {
      secret: "test",
      hostname: "yetanothermarket.cat",
      now: () => 1001,
      fetch: provider({
        success: true,
        hostname: "yetanothermarket.cat",
        action: "yamc_faucet",
        cdata: challenge.nonce,
      }),
    });
    assert.equal(
      store.consume(challenge.nonce, 1001, true).address,
      challenge.address,
    );
    assert.throws(
      () => store.consume(challenge.nonce, 1001, true),
      /already used/,
    );
  } finally {
    store.close();
  }
});
test("forged or mismatched provider responses never unlock a challenge", async () => {
  const { store, challenge } = fixture();
  try {
    const valid = {
      success: true,
      hostname: "yetanothermarket.cat",
      action: "yamc_faucet",
      cdata: challenge.nonce,
    };
    for (const result of [
      null,
      {},
      { ...valid, success: false },
      { ...valid, hostname: "attacker.invalid" },
      { ...valid, action: "other" },
      { ...valid, cdata: "other" },
    ]) {
      await assert.rejects(
        completeBrowserCheck(store, challenge.nonce, "token", {
          secret: "test",
          hostname: "yetanothermarket.cat",
          now: () => 1001,
          fetch: provider(result),
        }),
        /Browser check failed/,
      );
      assert.equal(store.get(challenge.nonce, 1001).captcha, 0);
    }
  } finally {
    store.close();
  }
});
test("provider outage, missing configuration and expiry fail closed", async () => {
  const { store, challenge } = fixture();
  try {
    const options = {
      secret: "test",
      hostname: "yetanothermarket.cat",
      now: () => 1001,
    };
    await assert.rejects(
      completeBrowserCheck(store, challenge.nonce, "token", {
        ...options,
        fetch: (async () => {
          throw new Error("private provider details");
        }) as typeof fetch,
      }),
      /temporarily unavailable/,
    );
    await assert.rejects(
      completeBrowserCheck(store, challenge.nonce, "token", {
        ...options,
        secret: "",
      }),
      /not configured/,
    );
    let clock = 1001;
    await assert.rejects(
      completeBrowserCheck(store, challenge.nonce, "token", {
        ...options,
        now: () => clock,
        fetch: (async () => {
          clock = 1300;
          return new Response(
            JSON.stringify({
              success: true,
              hostname: options.hostname,
              action: "yamc_faucet",
              cdata: challenge.nonce,
            }),
          );
        }) as typeof fetch,
      }),
      /expired/,
    );
  } finally {
    store.close();
  }
});
