/* global window */
// Exercise the shipped modules in a real browser, with no CSP and no live RPC.
// Malformed API fixtures intentionally violate backend types: defense in depth,
// not evidence that a public caller can make the real API return these values.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");
const { chromium } = require("playwright-core");
const base = "http://127.0.0.1:19877";
const root = path.resolve("server/YetAnotherCat.Api/wwwroot");
const payload = `"><img id="injected" src=x onerror="window.pwned=1">`;
const wallet = "11111111111111111111111111111111";

async function main() {
  const browser = await chromium.launch({
    channel: process.env.CI ? undefined : "msedge",
    headless: true,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let hostile = true;
  let operatorLoaded = false;
  let rejectApi = false;
  const cycle = () => ({
    cycleId: hostile ? payload : 4,
    minerCount: hostile ? payload : 1,
    claimCount: hostile ? payload : 0,
    leafCount: hostile ? payload : 1,
    totalPointUnits: "1000",
    totalAllocatedBaseUnits: "2000000",
    rewardBudgetBaseUnits: "2000000",
    claimedBaseUnits: "0",
    remainingBaseUnits: "2000000",
    status: "PUBLISHED",
    verification: "VALID",
    publishedSlot: hostile ? payload : 123,
    startTime: 100,
    endTime: 200,
    programId: wallet,
    mint: wallet,
    genesisHash: wallet,
    publicationSignature: wallet,
    manifestUrl: hostile
      ? "javascript:window.pwned=1"
      : "/api/cycles/4/manifest",
    claims: [
      {
        wallet: hostile ? payload : wallet,
        rewardBaseUnits: "1",
        timestamp: 200,
        signature: wallet,
      },
    ],
  });
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== base) return route.abort();
    const p = u.pathname;
    if (p.startsWith("/api/")) {
      if (rejectApi) return route.fulfill({ status: 500, body: payload });
      let data;
      if (p === "/api/explorer/config")
        data = {
          cluster: "devnet",
          explorerBase: hostile
            ? "javascript:window.pwned=1//"
            : "https://explorer.solana.com",
        };
      else if (p === "/api/stats")
        data = {
          distributedBaseUnits: "0",
          activeMiners: payload,
          publishedCycles: 1,
        };
      else if (p === "/api/explorer/cycles")
        data = { items: [cycle()], nextOffset: null };
      else if (p === "/api/explorer/cycles/4") data = cycle();
      else if (p === "/api/cycles/4/verification")
        data = {
          result: payload,
          checks: [{ id: payload, status: payload }],
          rpcSourceCategory: payload,
          sourceWatermark: payload,
        };
      else if (p.startsWith("/api/cycles/4/verify-wallet/"))
        data = {
          rewardBaseUnits: "1",
          pointUnits: "1000",
          proofValid: true,
          claimed: false,
          extra: payload,
        };
      else if (p.startsWith("/api/explorer/wallet/"))
        data = { claimedBaseUnits: "0", unclaimedBaseUnits: "1" };
      else if (p === "/api/operator/status")
        data = {
          status: payload,
          updatedAt: 200,
          snapshot: {
            components: { [payload]: payload },
            reserve: {
              vaultBaseUnits: "0",
              committedBaseUnits: "0",
              cyclesRemaining: payload,
            },
            details: payload,
          },
        };
      else return route.fulfill({ status: 404, body: "not found" });
      return route.fulfill({ json: data });
    }
    if (p === "/operator.js") operatorLoaded = true;
    const file =
      p.endsWith(".js") || p.endsWith(".css")
        ? path.join(root, p)
        : path.join(root, "index.html");
    return route.fulfill({
      body: await fs.readFile(file),
      contentType: file.endsWith(".js")
        ? "application/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
    });
  });
  async function clean() {
    assert.equal(await page.locator("#injected").count(), 0);
    assert.equal(await page.evaluate(() => window.pwned), undefined);
    assert.equal(
      await page.locator('a[href^="javascript:"],a[href^="data:"]').count(),
      0,
    );
  }
  try {
    for (const lang of ["en", "ca"]) {
      await page.goto(`${base}/cycles?lang=${lang}`);
      await page.locator("tbody tr").waitFor();
      assert((await page.locator("tbody").textContent()).includes(payload));
      await clean();
      await page.goto(
        `${base}/verify/4?lang=${lang}&wallet=${encodeURIComponent(payload)}`,
      );
      await page.locator("#proof details").waitFor();
      assert.equal(await page.locator("#wallet").inputValue(), payload);
      await clean();
      await page.goto(`${base}/shitter/${wallet}?lang=${lang}`);
      await page.locator("tbody tr").waitFor();
      await clean();
    }
    assert.equal(
      operatorLoaded,
      false,
      "public routes must not load the legacy operator renderer",
    );
    await page.goto(base + "/operator");
    await page.locator("#token").fill("test-only-not-a-real-token");
    await page.locator("#login button").click();
    await page.locator("#reverify").waitFor();
    assert((await page.locator("#dashboard").textContent()).includes(payload));
    await clean();
    hostile = false;
    await page.goto(base + "/verify/4");
    await page.locator("#verification .result").waitFor();
    assert.equal(
      await page.locator('a[href*="/api/cycles/4/manifest"]').count(),
      1,
    );
    assert(
      (
        await page.locator('a[target="_blank"]').first().getAttribute("href")
      ).startsWith("https://explorer.solana.com/tx/"),
    );
    rejectApi = true;
    await page.goto(base + "/cycles");
    await page.locator("#retry").waitFor();
    await clean();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: EN/CA cycle, proof, wallet, operator, escaped hostile API/URL data, safe links, normal links, API errors; no live network or CSP.",
    );
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
