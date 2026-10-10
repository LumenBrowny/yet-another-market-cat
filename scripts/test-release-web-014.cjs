/* global window -- browser evaluation only. */
const { URL } = require("node:url");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE || "playwright-core",
);
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
async function main() {
  let server;
  const publicBase = "https://yetanothermarket.cat";
  let base = process.env.YAC_PUBLIC_URL;
  if (!base) {
    server = http.createServer(async (req, res) => {
      try {
        const pathname = new URL(req.url, "http://localhost").pathname;
        if (pathname === "/downloads/release.json") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(await fs.readFile("infra/public/release.json"));
          return;
        }
        if (
          pathname.startsWith("/api/") ||
          pathname.startsWith("/downloads/")
        ) {
          const upstream = await fetch(publicBase + req.url);
          res.writeHead(upstream.status, {
            "content-type":
              upstream.headers.get("content-type") ||
              "application/octet-stream",
          });
          res.end(Buffer.from(await upstream.arrayBuffer()));
          return;
        }
        const root = pathname.startsWith("/downloads/")
          ? "infra/public"
          : "server/YetAnotherCat.Api/wwwroot";
        let file = path.join(root, pathname);
        try {
          if (!(await fs.stat(file)).isFile()) throw new Error();
        } catch {
          file = "server/YetAnotherCat.Api/wwwroot/index.html";
        }
        const type = {
          ".html": "text/html",
          ".js": "application/javascript",
          ".css": "text/css",
          ".webp": "image/webp",
          ".png": "image/png",
          ".json": "application/json",
        }[path.extname(file)];
        res.writeHead(200, {
          "content-type": type || "application/octet-stream",
        });
        res.end(await fs.readFile(file));
      } catch {
        res.writeHead(502);
        res.end();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = "http://127.0.0.1:" + server.address().port;
  }
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const errors = [],
    results = [];
  const prefix = process.env.YAC_PUBLIC_URL ? "public" : "local";
  await fs.mkdir("artifacts/site-014", { recursive: true });
  try {
    for (const lang of ["en", "ca"]) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base + "/?lang=" + lang);
      await page.locator(".release-hero h1").waitFor();
      await page.waitForFunction(
        () => !document.querySelector("#refresh-status").disabled,
      );
      assert.equal(await page.locator("html").getAttribute("lang"), lang);
      assert.equal(await page.locator(".tiers-table tbody tr").count(), 10);
      assert.equal(await page.locator(".status-grid .card").count(), 10);
      await page.locator("#nine-lives").scrollIntoViewIfNeeded();
      await page
        .locator("img")
        .evaluateAll((imgs) => Promise.all(imgs.map((i) => i.decode())));
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.equal(
        await page
          .locator("img")
          .evaluateAll((imgs) =>
            imgs.every((i) => i.complete && i.naturalWidth > 0),
          ),
        true,
      );
      assert(
        await page
          .locator("#release-metadata")
          .textContent()
          .then((t) => t.includes("00bef67b704165ccc1")),
      );
      assert(
        !(await page.locator("#live-status").innerText()).includes(
          lang === "ca" ? "No disponible" : "Unavailable",
        ),
      );
      await page.screenshot({
        path: `artifacts/site-014/${prefix}-${lang}-desktop.png`,
        fullPage: true,
      });
      for (const width of [320, 390, 768]) {
        await page.setViewportSize({ width, height: 844 });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `overflow ${lang} ${width}`,
        );
        if (width === 390)
          await page.screenshot({
            path: `artifacts/site-014/${prefix}-${lang}-mobile.png`,
            fullPage: true,
          });
      }
      await page
        .locator("#miner-wallet")
        .fill("3Zg792qMq5tWkcjnBWED7vPve2qnixXT6VAysqFD5Hyo");
      await Promise.all([
        page.waitForURL("**/shitter/**"),
        page.locator("#miner-inspector button").click(),
      ]);
      assert(new URL(page.url()).searchParams.get("lang") === lang);
      results.push({
        lang,
        layoutWidths: [320, 390, 768, 1440],
        status: "PASS",
        walletNavigation: "PASS",
      });
      // Slow/unavailable API must never gate the static page or direct APK link.
      await page.route("**/api/**", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: "{}",
        }),
      );
      await page.route("**/downloads/release.json", (route) => route.abort());
      await page.goto(base + "/?lang=" + lang);
      await page.locator(".release-hero h1").waitFor({ timeout: 2000 });
      await page.waitForFunction(
        () => !document.querySelector("#refresh-status").disabled,
      );
      assert.equal(
        await page
          .locator('a[href="/downloads/yet-another-cat-0.13.4.apk"]')
          .count(),
        2,
      );
      assert(
        (await page.locator("#live-status").innerText()).includes(
          lang === "ca" ? "No disponible" : "Unavailable",
        ),
      );
      assert.equal(await page.locator("#nine-lives h2").count(), 1);
      results.push({ lang, apiOutage: "PASS", releaseMetadataOutage: "PASS" });
      await page.close();
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(
      `artifacts/site-014/${prefix}-validation.json`,
      JSON.stringify(
        { testedAt: new Date().toISOString(), base, results, errors },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ base, results, errors }));
  } finally {
    await browser.close();
    if (server) server.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
