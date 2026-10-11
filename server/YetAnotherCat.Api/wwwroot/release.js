import { releaseLocales } from "./release-locales.js";
const source = "https://github.com/LumenBrowny/yet-another-market-cat";
const apk = "/downloads/yet-another-cat-0.13.5.apk";
const program = "BfNiASrYNqmARu2TQ1eBa1PJ6KgVHTNn44ATk5rJe6zW";
const mint = "A8viyp5aA6Pw59HzzVWPd5tkgS2gup2cZyd7TPmyAupZ";
const tiers = [
  [0, "DEAD_INSIDE", 0],
  [1, "CALM", 1000],
  [1.5, "SUSPICIOUS", 2500],
  [2, "ACTIVE", 5000],
  [3, "CONCERNED", 10000],
  [5, "DISTRESSED", 25000],
  [8, "AIRBORNE", 50000],
  [12, "PANIC", 100000],
  [20, "OVERDRIVE", 250000],
  [25, "TRANSCENDENT", 500000],
];

export function releasePage({ app, lang, esc, url, units, date, t: common }) {
  const t = releaseLocales[lang];
  const a = (href, label, primary = false) =>
    `<a class="action ${primary ? "primary" : ""}" href="${esc(href)}">${esc(label)}</a>`;
  const section = (id, title, body) =>
    `<section class="release-section" id="${id}"><h2>${esc(title)}</h2>${body}</section>`;
  const p = (text, cls = "") => `<p class="${cls}">${esc(text)}</p>`;
  const figure = (file, alt, caption, eager = false) =>
    `<figure><img src="/media/${file}" width="880" height="748" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'}><figcaption>${esc(caption)}</figcaption></figure>`;
  document.title = "Yet Another Market Cat · Proof of Shit on Solana";
  document.querySelector('meta[name="description"]').content = t.description;
  document.querySelector('meta[property="og:description"]').content =
    t.description;
  app.classList.add("release-page");
  app.innerHTML =
    `<section class="release-hero"><div><div class="eyebrow">${t.kicker}</div><h1>Yet Another<br>Market Cat <span aria-hidden="true">💩</span></h1><p class="tagline">${esc(t.pitch)}</p>${p(t.intro, "intro")}<div class="actions">${a(apk, t.download, true)}${a(url("/cycles"), "Verify The Shit")}</div><a href="${source}">${t.source} ↗</a></div>${figure("chamber-014.webp", t.sceneAlt, t.sceneCaption, true)}</section><p class="manifesto">${esc(t.closed)}</p>` +
    section(
      "android",
      t.downloadTitle,
      `<div class="download-strip"><div><strong>Android · 0.13.5 (27)</strong>${p(t.build)}</div>${a(apk, t.download, true)}</div>${p(t.devnet, "muted")}<details><summary>${t.installDetails}</summary>${p(t.install)}${p(t.demo)}${a("https://faucet.solana.com", common.faucet)}<div id="release-metadata" aria-live="polite">${p(t.loading)}</div></details>`,
    ) +
    section(
      "how",
      t.stepsTitle,
      `<div class="steps-grid">${t.steps.map(([title, copy], i) => `<article class="card"><span class="step-number">0${i + 1}</span><h3>${esc(title)}</h3>${p(copy)}</article>`).join("")}</div>`,
    ) +
    section(
      "proof",
      t.proofTitle,
      `${p(t.proof)}<ul class="continuity">${t.continuity.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`,
    ) +
    section(
      "tiers",
      t.tiersTitle,
      `<div class="table-wrap"><table class="tiers-table"><thead><tr>${t.tierHeads.map((x) => `<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${tiers.map(([rate, state, amount]) => `<tr><td>×${rate.toLocaleString(common.locale)}</td><td>${state}</td><td>${amount ? amount.toLocaleString(common.locale) : "&lt; " + (1000).toLocaleString(common.locale)}</td></tr>`).join("")}</tbody></table></div>`,
    ) +
    section(
      "economics",
      t.economicsTitle,
      `<div class="grid economics-grid">${[100000000, 1000000, 99000000, 100000, 2000, 0].map((n, i) => `<div class="card"><div class="label">${t.economyLabels[i]}</div><div class="number">${n.toLocaleString(common.locale)}</div><small>CATSHIT</small></div>`).join("")}</div>${p(t.economics)}<h3>${t.settlementTitle}</h3><p class="formula">${esc(t.formula)}</p>${p(t.rounding)}`,
    ) +
    section(
      "status",
      t.liveTitle,
      `${p(t.liveNote, "muted")}<div id="live-status" aria-live="polite">${p(t.loading)}</div><button id="refresh-status">${t.refresh}</button>${p(t.statusNote, "muted small-copy")}`,
    ) +
    section(
      "verify",
      t.verifyTitle,
      `${p(t.verify)}<p class="callout">${esc(t.closedGate)}</p><div class="actions">${a(url("/cycles"), "Verify The Shit", true)}${a(url("/cycles"), t.explore)}</div>${p(t.verifyNote, "muted")}<div class="panel"><h3>${t.inspectTitle}</h3>${p(t.walletHint)}<form id="miner-inspector"><label for="miner-wallet">${t.wallet}</label><div class="wallet-input"><input id="miner-wallet" name="wallet" required pattern="[1-9A-HJ-NP-Za-km-z]{32,44}" autocomplete="off" spellcheck="false"><button type="submit">${t.inspect}</button></div><p id="miner-error" role="alert"></p></form></div>`,
    ) +
    section(
      "architecture",
      t.architectureTitle,
      `<div class="architecture-grid">${t.lanes.map(([label, steps]) => `<div class="panel"><div class="eyebrow">${label}</div><ol class="architecture-flow">${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></div>`).join("")}</div>${p(t.rpc)}<div class="trust-callout"><h3>${t.trustTitle}</h3>${p(t.trust)}${a(url("/trust"), common.trustLink)}</div>`,
    ) +
    section(
      "engine",
      t.engineTitle,
      `${p(t.engine)}${p(t.physics)}<div class="engine-tags"><span>2.5D</span><span>Mobile Wallet Adapter</span><span>BONK</span><span>React Native</span></div>`,
    ) +
    section(
      "nine-lives",
      t.skrTitle,
      `<div class="club-grid"><div><span class="nine-heart">9♥</span>${p(t.skr)}${p(t.cosmetic, "muted")}</div>${figure("nine-lives-014.webp", t.clubAlt, t.clubCaption)}</div>`,
    ) +
    section(
      "resources",
      t.resourcesTitle,
      `<div class="actions">${[
        ["/#architecture", 0],
        ["/#economics", 1],
        ["/#verify", 2],
        ["/#deployment", 3],
      ]
        .map(([path, i]) => a(url(path), t.resources[i]))
        .join(
          "",
        )}${a(source, t.resources[4])}${a(source + "/blob/main/docs/public-site-release-014.md", t.releaseDocs)}</div><div id="deployment"><h3>${t.deployment}</h3><dl>${[
        [t.program, program],
        [t.mint, mint],
      ]
        .map(
          ([label, address]) =>
            `<dt>${label}</dt><dd><a href="https://explorer.solana.com/address/${address}?cluster=devnet"><code>${address}</code></a></dd>`,
        )
        .join("")}</dl></div>`,
    );
  document
    .querySelector("footer")
    .insertAdjacentHTML("afterbegin", `<strong>${esc(t.built)}</strong>`);
  document.querySelector("#miner-inspector").onsubmit = (event) => {
    event.preventDefault();
    const wallet = document.querySelector("#miner-wallet").value.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
      document.querySelector("#miner-error").textContent = t.invalidWallet;
      return;
    }
    location.href = url("/shitter/" + encodeURIComponent(wallet));
  };
  const json = async (path, health = false) => {
    const response = await fetch(path, {
      cache: "no-cache",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok && !(health && response.status === 503))
      throw new Error("unavailable");
    return response.json();
  };
  json("/downloads/release.json")
    .then((r) => {
      if (
        r.version !== "0.13.5" ||
        r.versionCode !== 27 ||
        !/^[a-f0-9]{64}$/i.test(r.sha256) ||
        r.filename !== apk.split("/").pop()
      )
        throw new Error("mismatched release");
      document.querySelector("#release-metadata").innerHTML =
        `<dl><dt>${t.version}</dt><dd>${esc(r.version)} (${r.versionCode})</dd><dt>${t.filename}</dt><dd><code>${esc(r.filename)}</code></dd><dt>${t.size}</dt><dd>${(r.bytes / 1048576).toLocaleString(common.locale, { maximumFractionDigits: 1 })} MiB</dd><dt>${t.checksum}</dt><dd><code>${esc(r.sha256)}</code></dd></dl>`;
    })
    .catch(() => {
      document.querySelector("#release-metadata").textContent =
        t.releaseUnavailable;
    });
  const stateLabel = (value) =>
    ({
      healthy: t.healthy,
      degraded: t.degraded,
      critical: t.critical,
      VALID: t.valid,
      INVALID: t.invalid,
      UNVERIFIABLE: t.unverifiable,
    })[value] ?? t.unknown;
  async function refresh() {
    const button = document.querySelector("#refresh-status");
    button.disabled = true;
    const target = document.querySelector("#live-status");
    target.innerHTML = p(t.loading);
    try {
      const results = await Promise.allSettled([
        json("/api/cycles"),
        json("/api/stats"),
        json("/api/health", true),
        json("/api/explorer/cycles?limit=1"),
      ]);
      const [cycles, stats, health, list] = results.map((r) =>
        r.status === "fulfilled" ? r.value : null,
      );
      // Never combine snapshots from an old deployment with the canonical release.
      const canonical = cycles?.config?.tokenMint === mint;
      const latest = list?.items?.[0];
      const samePublication =
        latest?.programId === program && latest?.mint === mint;
      let report = null;
      if (samePublication) {
        try {
          report = await json(
            "/api/cycles/" +
              encodeURIComponent(latest.cycleId) +
              "/verification",
          );
        } catch {
          /* Keep honest unavailable status. */
        }
      }
      const verified =
        report?.result === "VALID" &&
        report.internalConsistency === true &&
        report.chainRecomputation === true &&
        !report.pendingPublication;
      const id =
        canonical && /^\d+$/.test(cycles.current?.cycleId)
          ? BigInt(cycles.current.cycleId)
          : null;
      const ended = id !== null && id > 0n ? id - 1n : null;
      const next =
        canonical && /^\d+$/.test(cycles.config.nextCycle)
          ? BigInt(cycles.config.nextCycle)
          : null;
      const uncommitted =
        canonical &&
        stats?.rewardReserveBaseUnits != null &&
        cycles.config.committedUnclaimed != null
          ? BigInt(stats.rewardReserveBaseUnits) -
            BigInt(cycles.config.committedUnclaimed)
          : null;
      const unavailable = t.unavailable;
      const values = [
        id === null ? unavailable : "#" + id,
        ended === null ? (id === 0n ? t.none : unavailable) : "#" + ended,
        samePublication ? "#" + latest.cycleId : unavailable,
        verified ? "#" + latest.cycleId : unavailable,
        id !== null && next !== null
          ? (id > next ? id - next : 0n).toString()
          : unavailable,
        health ? stateLabel(health.status) : unavailable,
        health?.components?.publisher
          ? stateLabel(health.components.publisher)
          : unavailable,
        stats?.rewardReserveBaseUnits != null
          ? units(stats.rewardReserveBaseUnits) + " CATSHIT"
          : unavailable,
        uncommitted !== null && uncommitted >= 0n
          ? units(uncommitted.toString()) + " CATSHIT"
          : unavailable,
        report
          ? stateLabel(
              verified
                ? "VALID"
                : report.result === "INVALID"
                  ? "INVALID"
                  : "UNVERIFIABLE",
            )
          : unavailable,
      ];
      const stale =
        results.some((r) => r.status === "rejected") ||
        !canonical ||
        cycles?.stale ||
        stats?.stale ||
        !stats?.finalizedThroughTime ||
        Date.now() / 1000 - stats.finalizedThroughTime > 180;
      target.innerHTML = `${stale ? p(t.stale, "error") : ""}<div class="grid status-grid">${values.map((v, i) => `<div class="card"><div class="label">${t.statusLabels[i]}</div><strong>${esc(v)}</strong></div>`).join("")}</div>${samePublication ? `<div class="actions">${a(url("/verify/" + latest.cycleId), "Verify The Shit · #" + latest.cycleId)}</div>` : ""}<p class="muted">${t.observed}: ${esc(new Date().toLocaleString(common.locale))}<br>${t.chainTime}: ${esc(stats?.finalizedThroughTime ? date(stats.finalizedThroughTime) : unavailable)}${report?.verifiedAt ? "<br>Verify The Shit: " + esc(date(report.verifiedAt)) : ""}</p>`;
    } catch {
      target.innerHTML = p(t.unavailable, "error");
    } finally {
      button.disabled = false;
    }
  }
  document.querySelector("#refresh-status").onclick = () => void refresh();
  void refresh();
}
