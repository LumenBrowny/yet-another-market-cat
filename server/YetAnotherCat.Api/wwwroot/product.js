import { locales } from "./locales.js";
import { releasePage } from "./release.js";
const query = new URLSearchParams(location.search);
let saved;
try {
  saved = localStorage.getItem("yac-language");
} catch {
  /* URL still works. */
}
const lang =
  [query.get("lang"), saved, navigator.language?.split("-")[0]].find(
    (x) => x === "en" || x === "ca",
  ) ?? "en";
const t = locales[lang];
document.documentElement.lang = lang;
try {
  localStorage.setItem("yac-language", lang);
} catch {
  /* Optional persistence. */
}
const app = document.querySelector("#app");
const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const url = (path) => {
  const u = new URL(path, location.origin);
  u.searchParams.set("lang", lang);
  return u.pathname + u.search + u.hash;
};
const link = (path, label, primary = false) =>
  `<a class="action ${primary ? "primary" : ""}" href="${esc(url(path))}">${esc(label)}</a>`;
const units = (v, scale = 6) => {
  if (v == null) return "—";
  const n = BigInt(v),
    d = 10n ** BigInt(scale),
    f = (n % d).toString().padStart(scale, "0").replace(/0+$/, "");
  return (
    (n / d).toLocaleString(t.locale) +
    (f ? (lang === "ca" ? "," : ".") + f : "")
  );
};
const date = (v) =>
  v
    ? new Date(
        typeof v === "number" || /^\d+$/.test(v) ? Number(v) * 1000 : v,
      ).toLocaleString(t.locale)
    : "—";
const short = (v) => (v ? `${v.slice(0, 5)}…${v.slice(-5)}` : "—");
const status = (v) => t.statuses[v] ?? v;
const badge = (v) =>
  `<span class="badge ${esc(String(v).toLowerCase())}" data-status="${esc(v)}">${esc(status(v))}</span>`;
const cards = (rows) =>
  `<div class="grid">${rows.map(([k, v]) => `<div class="card"><div class="label">${esc(k)}</div><div class="number">${esc(v)}</div></div>`).join("")}</div>`;
const table = (heads, rows) =>
  `<div class="table-wrap"><table><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
let config = { cluster: "devnet", explorerBase: "https://explorer.solana.com" };
async function api(path) {
  let r;
  try {
    r = await fetch(path, { signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error(t.error);
  }
  if (!r.ok)
    throw new Error(
      r.status === 429 ? t.limited : r.status === 404 ? t.noCycle : t.error,
    );
  return r.json();
}
function explorer(kind, id, label) {
  if (!id) return "—";
  if (config.cluster === "localnet" && !config.explorerRpc)
    return `<code>${esc(id)}</code>`;
  const q =
    config.cluster === "devnet"
      ? "?cluster=devnet"
      : "?cluster=custom&customUrl=" + encodeURIComponent(config.explorerRpc);
  return `<a target="_blank" rel="noopener noreferrer" href="${esc(config.explorerBase)}/${kind === "transaction" ? "tx" : "address"}/${encodeURIComponent(id)}${esc(q)}">${esc(label ?? short(id))} ↗</a>`;
}
function shell() {
  document.querySelector("header").innerHTML =
    `<a class="brand" href="${url("/")}"><span class="cat" aria-hidden="true">/ᐠ ·ᴥ· ᐟ\\</span><span>Yet Another Market Cat 💩<small>POWERED BY PoS™ — PROOF OF SHIT</small></span></a><span id="network" class="badge">DEVNET · ${t.test}</span>`;
  document.querySelector("nav").innerHTML =
    ["/", "/cycles", "/#verify", "/about"]
      .map(
        (p, i) =>
          `<a href="${url(p)}" ${location.pathname === p ? 'aria-current="page"' : ""}>${t.nav[i]}</a>`,
      )
      .join("") +
    `<span class="languages" aria-label="${t.language}">${["en", "ca"]
      .map((l) => {
        const u = new URL(location.href);
        u.searchParams.set("lang", l);
        return `<a hreflang="${l}" lang="${l}" href="${esc(u.pathname + u.search)}" ${l === lang ? 'aria-current="true"' : ""}>${l === "en" ? "English" : "Català"}</a>`;
      })
      .join("")}</span>`;
  document.querySelector("footer").innerHTML =
    `<span>${t.footer}</span><a href="https://github.com/LumenBrowny/yet-another-market-cat">GitHub</a><a href="${url("/trust")}">${t.trustLink}</a><a href="/operator">${t.operator}</a>`;
  app.innerHTML = `<p class="muted">${t.loading}</p>`;
}
const trust = () =>
  `<section class="panel text"><h2>${t.trustTitle}</h2><p>${t.trustCopy}</p><p>${t.trustMore}</p></section>`;
const form = (id = "4", wallet = "") =>
  `<form id="inspect" class="inline-form"><div><label for="cycle">${t.cycle}</label><input id="cycle" name="cycle" inputmode="numeric" pattern="[0-9]+" value="${esc(id)}" required></div><div><label for="wallet">${t.optional}</label><input id="wallet" name="wallet" placeholder="${t.placeholder}" value="${esc(wallet)}"></div><button class="primary">${t.inspect}</button><p id="form-error" class="error" role="alert"></p></form>`;
function wire() {
  const f = document.querySelector("#inspect");
  if (f)
    f.onsubmit = (e) => {
      e.preventDefault();
      const id = f.elements.cycle.value,
        w = f.elements.wallet.value.trim();
      if (
        !/^\d+$/.test(id) ||
        (w && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w))
      ) {
        document.querySelector("#form-error").textContent = t.invalidInput;
        return;
      }
      location.href = url(
        "/verify/" + BigInt(id) + (w ? "?wallet=" + encodeURIComponent(w) : ""),
      );
    };
  document.querySelectorAll("[data-copy]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await navigator.clipboard.writeText(b.dataset.copy);
          b.textContent = t.copied;
        } catch {
          b.textContent = t.select;
        }
      }),
  );
}
async function cycles() {
  const offset = Math.max(0, Number(query.get("offset") ?? 0));
  const [data, stats] = await Promise.all([
    api("/api/explorer/cycles?offset=" + offset),
    api("/api/stats"),
  ]);
  app.innerHTML = `<section class="hero"><div class="eyebrow">${t.cycleExplorer}</div><h1>${t.cycleHero}</h1><p class="intro">${t.cycleIntro}</p></section>${cards(t.stats.map((s, i) => [s, [units(stats.distributedBaseUnits), stats.activeMiners, stats.publishedCycles][i]]))}<h2>${t.cycles}</h2>${table(
    t.columns,
    data.items.map(
      (c) =>
        `<tr><td><a href="${url("/cycles/" + c.cycleId)}">#${esc(c.cycleId)}</a><br><small>${date(c.endTime)}</small></td><td>${c.minerCount}</td><td>${units(c.totalPointUnits, 3)}</td><td>${units(c.totalAllocatedBaseUnits)}</td><td>${c.claimCount} / ${c.leafCount}</td><td>${badge(c.verification)}</td></tr>`,
    ),
  )}${!data.items.length ? `<p>${t.empty}</p>` : ""}<div class="actions">${offset ? link("/cycles?offset=" + Math.max(0, offset - 12), t.newer) : ""}${data.nextOffset != null ? link("/cycles?offset=" + data.nextOffset, t.older) : ""}</div><section class="panel"><h2>${t.inspectTitle}</h2>${form()}</section><p class="muted">${t.cached}</p>`;
  wire();
}
function technical(c) {
  const values = [
    c.programId,
    c.mint,
    c.genesisHash,
    c.merkleRoot,
    c.manifestHash,
    c.inputThroughSlot,
    c.inputHash,
    c.totalPointUnits,
    c.address,
  ];
  return `<details><summary>${t.technical}</summary><dl>${t.fields.map((label, i) => `<dt>${label}</dt><dd><code>${esc(values[i])}</code><button class="copy" data-copy="${esc(values[i])}" aria-label="${t.copy}: ${label}">${t.copy}</button></dd>`).join("")}</dl></details>`;
}
function verification(r) {
  const ok =
    r.result === "VALID" &&
    r.internalConsistency &&
    r.chainRecomputation &&
    !r.pendingPublication;
  const result = ok
    ? "VALID"
    : r.result === "INVALID"
      ? "INVALID"
      : "UNVERIFIABLE";
  return `<div class="label">${t.verification} · ${r.verifiedAt ? date(r.verifiedAt) : t.notVerified}</div><div class="result ${result.toLowerCase()}"><h2>${ok ? t.validTitle : result === "INVALID" ? t.invalidTitle : t.unknownTitle}</h2>${badge(result)}<p>${ok ? t.validCopy : result === "INVALID" ? t.invalidCopy : t.unknownCopy}</p></div>${(r.checks ?? []).map((c) => `<div class="check"><span class="symbol ${esc(c.status)}">${c.status === "PASS" ? "✓" : c.status === "FAIL" ? "✕" : "—"}</span><div><strong>${esc(t.checks[c.id] ?? c.id)}</strong><small>${esc(status(c.status))}</small></div></div>`).join("")}<p>${t.source}: <code>${esc(r.rpcSourceCategory ?? "—")}</code><br>${t.sourceRange}: ${esc(r.sourceStartSlot ?? "—")} → ${esc(r.sourceWatermark ?? "—")}</p>${r.sourceBlocks ? `<p>${t.blockSources}: ${esc(r.sourceBlocks.cached)} / ${esc(r.sourceBlocks.downloaded)}</p><p class="muted">${t.blockCacheNote}</p>` : ""}<p class="muted">${t.readOnly}</p><details><summary>${t.original}</summary><p>${t.rawNote}</p><pre>${esc(JSON.stringify(r, null, 2))}</pre></details>`;
}
async function cyclePage(id) {
  if (!/^\d+$/.test(id)) throw new Error(t.noCycle);
  const wallet = query.get("wallet"),
    c = await api("/api/explorer/cycles/" + id);
  const direct = config.manifestPublicBaseUrl
    ? `${config.manifestPublicBaseUrl}/cycles/${c.genesisHash}/${id}/manifest.json`
    : c.manifestUrl;
  app.innerHTML = `<section class="hero"><div class="eyebrow">${t.record}</div><h1>Shit Cycle #${esc(c.cycleId)}</h1>${badge(c.status)} <span>${date(c.startTime)} → ${date(c.endTime)}</span></section><div class="split"><section><div id="verification" class="panel">${t.loading}</div><div class="actions">${link("/verify/" + id, "VERIFY THE SHIT", true)}<a class="action" href="${esc(direct)}">${t.manifest}</a><a class="action" href="/api/cycles/${id}/verification" download="cycle-${id}-verifier-report.json">${t.report}</a></div><p class="muted">${t.consistency}</p></section><section class="panel"><div class="label">${t.budget}</div><h1>${units(c.rewardBudgetBaseUnits)}</h1><p>${t.reserve}</p>${cards(t.totals.map((s, i) => [s, [units(c.totalPointUnits, 3), c.minerCount, units(c.claimedBaseUnits), units(c.remainingBaseUnits)][i]]))}<p>${t.publication} · ${c.publishedSlot || "—"}</p>${explorer("transaction", c.publicationSignature)}</section></div>${technical(c)}<section class="panel"><h2>${t.inspectTitle}</h2>${form(id, wallet ?? "")}<div id="proof"></div></section><h2>${t.claims}</h2>${
    c.claims.length
      ? table(
          t.claimColumns,
          c.claims.map(
            (r) =>
              `<tr><td><a href="${url("/shitter/" + r.wallet)}">${short(r.wallet)}</a></td><td>${units(r.rewardBaseUnits)}</td><td>${date(r.timestamp)}</td><td>${explorer("transaction", r.signature)}</td></tr>`,
          ),
        )
      : `<p>${t.noClaims}</p>`
  }`;
  wire();
  try {
    document.querySelector("#verification").innerHTML = verification(
      await api("/api/cycles/" + id + "/verification"),
    );
  } catch (e) {
    document.querySelector("#verification").textContent = e.message;
  }
  if (wallet) {
    const p = await api(
      `/api/cycles/${id}/verify-wallet/${encodeURIComponent(wallet)}`,
    );
    document.querySelector("#proof").innerHTML =
      `<h3>${p.rewardBaseUnits === "0" ? t.noReward : p.claimed ? t.claimed : t.reward}</h3>${cards(
        [
          ["PP", units(p.pointUnits, 3)],
          ["CATSHIT", units(p.rewardBaseUnits)],
        ],
      )}<p>${t.proof}: <strong>${p.proofValid ? status("VALID") : p.rewardBaseUnits === "0" ? t.noLeaf : status("INVALID")}</strong></p><p>${p.claimed ? explorer("transaction", p.claimSignature) : t.inApp}</p><details><summary>${t.rawProof}</summary><p>${t.rawNote}</p><pre>${esc(JSON.stringify(p, null, 2))}</pre></details>`;
  }
}
async function walletPage(wallet) {
  const [w, data] = await Promise.all([
    api("/api/explorer/wallet/" + encodeURIComponent(wallet)),
    api(
      "/api/explorer/cycles?wallet=" + encodeURIComponent(wallet) + "&limit=12",
    ),
  ]);
  const values = [
    units(w.accounting?.effectiveLockedBaseUnits),
    units(w.accounting?.pointUnits, 3),
    units(w.accounting?.ratePointUnitsPerSecond, 3) + " PP/s",
    units(w.claimedBaseUnits),
    units(w.unclaimedBaseUnits),
    w.accounting?.tier ?? "—",
  ];
  app.innerHTML = `<section class="hero"><h1>${t.walletHero}</h1><code>${esc(wallet)}</code><button class="copy" data-copy="${esc(wallet)}">${t.copy}</button></section>${cards(t.walletLabels.map((l, i) => [l, values[i]]))}<h2>${t.recent}</h2>${table(
    [t.columns[0], "PP", t.rewardColumn, t.claimColumn],
    data.items.map(
      (c) =>
        `<tr><td><a href="${url("/verify/" + c.cycleId + "?wallet=" + encodeURIComponent(wallet))}">#${c.cycleId}</a></td><td>${units(c.wallet?.pointUnits ?? "0", 3)}</td><td>${units(c.wallet?.rewardBaseUnits ?? "0")}</td><td>${c.wallet?.claimed ? t.claimed : c.wallet && c.wallet.rewardBaseUnits !== "0" ? t.claimInApp : t.noShit}</td></tr>`,
    ),
  )}`;
  wire();
}
function about(isTrust) {
  app.innerHTML = isTrust
    ? `<section class="hero"><h1>${t.trustLink}</h1></section>${trust()}<section class="text"><h2>${t.architecture}</h2><p>${t.architectureCopy}</p>${link("/cycles", t.verify, true)}</section>`
    : `<section class="hero"><h1>${t.nav[3]}</h1><p class="intro">${t.intro}</p></section>${t.steps.map(([a, b]) => `<section class="panel"><h2>${a}</h2><p>${b}</p></section>`).join("")}<section class="text"><h2>${t.mathTitle}</h2><p>${t.mathCopy}</p><h2>${t.fixedTitle}</h2><p>${t.fixedCopy}</p><h2>${t.architecture}</h2><p>${t.architectureCopy}</p><h2>${t.whyTitle}</h2><p>${t.whyCopy}</p></section>${trust()}`;
}
async function main() {
  shell();
  const p = location.pathname.split("/").filter(Boolean);
  if (p[0] === "operator") return import("./operator.js");
  if (p[0] === "about" || p[0] === "trust") return about(p[0] === "trust");
  if (!p[0] || p[0] === "demo") {
    return releasePage({ app, lang, esc, url, units, date, t });
  }
  config = await api("/api/explorer/config");
  document.querySelector("#network").textContent =
    config.cluster.toUpperCase() + " · " + t.test;
  if (p[0] === "shitter") return walletPage(p[1]);
  if ((p[0] === "cycles" || p[0] === "verify") && p[1]) return cyclePage(p[1]);
  return cycles();
}
main().catch((e) => {
  app.innerHTML = `<section class="hero"><h1>${t.unavailable}</h1><p class="error">${esc(e.message)}</p><button id="retry">${t.retry}</button></section>`;
  document.querySelector("#retry").onclick = () => location.reload();
});
