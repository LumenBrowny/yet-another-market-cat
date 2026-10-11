/* global getComputedStyle -- browser evaluation only. */
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE || "playwright-core",
);
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
async function main() {
  const base = process.env.YAC_PUBLIC_URL || "https://yetanothermarket.cat";
  const suffix = process.env.YAC_WEB_SUFFIX || "006";
  const cycle = process.env.YAC_WEB_CYCLE || "4";
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  await fs.mkdir("artifacts", { recursive: true });
  const results = [],
    errors = [];
  try {
    for (const lang of ["en", "ca"]) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        locale: lang === "ca" ? "ca-ES" : "en-GB",
      });
      page.on("pageerror", (e) => errors.push(e.message));
      for (const route of [
        "/",
        "/about",
        "/trust",
        "/cycles",
        ...(cycle === "pending"
          ? []
          : [
              `/verify/${cycle}?wallet=3Zg792qMq5tWkcjnBWED7vPve2qnixXT6VAysqFD5Hyo`,
              `/cycles/${cycle}`,
            ]),
        "/shitter/3Zg792qMq5tWkcjnBWED7vPve2qnixXT6VAysqFD5Hyo",
      ]) {
        await page.goto(
          base + route + (route.includes("?") ? "&" : "?") + "lang=" + lang,
        );
        await page.locator("h1").first().waitFor();
        if (route.startsWith("/verify") || route.startsWith("/cycles/"))
          await page
            .locator('#verification [data-status="VALID"]')
            .waitFor({ timeout: 30000 });
        if (route.startsWith("/verify") || route.startsWith("/cycles/")) {
          for (const width of [390, 768, 1440]) {
            await page.setViewportSize({ width, height: 1000 });
            assert(
              await page.locator(".split .grid").evaluate((grid) => {
                const oneColumn =
                  getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/)
                    .length === 1;
                const number = grid.querySelector(".number");
                const original = number.textContent;
                number.textContent = "999,999,999,999,999,999,999.999";
                const fits = number.scrollWidth <= number.clientWidth + 1;
                number.textContent = original;
                return oneColumn && fits;
              }),
              `cycle values overflow or multiple columns: ${route} ${lang} ${width}`,
            );
          }
        }
        assert.equal(await page.locator("html").getAttribute("lang"), lang);
        assert.equal(
          await page
            .getByText(
              lang === "ca" ? "Dades no disponibles" : "Data unavailable",
              { exact: true },
            )
            .count(),
          0,
        );
        const key = route.split("?")[0].replaceAll("/", "-") || "home";
        await page.screenshot({
          path: `artifacts/public-${suffix}-${lang}${key}.png`,
          fullPage: true,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `overflow ${route} ${lang}`,
        );
        if (route === "/" || route.startsWith("/verify"))
          await page.screenshot({
            path: `artifacts/public-${suffix}-${lang}${key}-mobile.png`,
            fullPage: true,
          });
        await page.setViewportSize({ width: 1440, height: 1000 });
        results.push({ lang, route, result: "PASS" });
      }
      await page.goto(base + "/verify/999999?lang=" + lang);
      await page
        .getByRole("heading", {
          name: lang === "ca" ? "Dades no disponibles" : "Data unavailable",
          exact: true,
        })
        .waitFor();
      assert(
        await page
          .getByText(
            lang === "ca"
              ? "No hi ha cap cicle disponible amb aquest identificador."
              : "No cycle with this ID is available.",
            { exact: true },
          )
          .count(),
      );
      await page.close();
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(
      `artifacts/public-web-${suffix}.json`,
      JSON.stringify(
        { testedAt: new Date().toISOString(), base, results, errors },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({ pages: results.length, localizedErrors: 2, errors }),
    );
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
