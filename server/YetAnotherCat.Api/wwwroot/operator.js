const app = document.querySelector("#app");
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const units = (value, scale = 6) => {
  if (value == null) return "—";
  const n = BigInt(value),
    d = 10n ** BigInt(scale);
  return (
    (n / d).toLocaleString("en-US") +
    (n % d
      ? "." + (n % d).toString().padStart(scale, "0").replace(/0+$/, "")
      : "")
  );
};
const date = (s) => (s ? new Date(Number(s) * 1000).toLocaleString() : "—");
const short = (s) => (s ? `${s.slice(0, 5)}…${s.slice(-5)}` : "—");
const badge = (s) =>
  `<span class="badge ${esc(String(s).toLowerCase())}">${esc(s)}</span>`;
let config = { cluster: "localnet" };
async function api(path, options) {
  const r = await fetch(path, {
    ...options,
    signal:
      options?.signal ??
      AbortSignal.timeout(options?.method === "POST" ? 180000 : 12000),
  });
  if (!r.ok)
    throw new Error(
      r.status === 401
        ? "Operator token required"
        : r.status === 429
          ? "Too many requests. Please wait."
          : `Data unavailable (${r.status}). Try again shortly.`,
    );
  return r.json();
}
function explorer(kind, id) {
  if (!id) return "";
  if (config.cluster === "localnet" && !config.explorerRpc)
    return `<span class="muted">Localnet ${esc(kind)}: <code>${esc(id)}</code></span>`;
  const query =
    config.cluster === "devnet"
      ? "?cluster=devnet"
      : "?cluster=custom&customUrl=" + encodeURIComponent(config.explorerRpc);
  return `<a rel="noopener noreferrer" target="_blank" href="${esc(config.explorerBase)}/${kind === "transaction" ? "tx" : "address"}/${encodeURIComponent(id)}${esc(query)}">${esc(short(id))} ↗</a>`;
}
function technical(c) {
  return `<details><summary>Technical details</summary><dl>${[
    ["Program", c.programId],
    ["Mint", c.mint],
    ["Genesis hash", c.genesisHash],
    ["Merkle root", c.merkleRoot],
    ["Manifest SHA-256", c.manifestHash],
    ["Source watermark", c.inputThroughSlot],
    ["Source digest", c.inputHash],
    ["Point units", c.totalPointUnits],
    ["Cycle PDA", c.address],
  ]
    .map(
      ([k, v]) =>
        `<dt>${esc(k)}</dt><dd><code>${esc(v)}</code><button class="copy" data-copy="${esc(v)}" aria-label="Copy ${esc(k)}">COPY</button></dd>`,
    )
    .join("")}</dl></details>`;
}
function wireCopy() {
  document.querySelectorAll("[data-copy]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await navigator.clipboard.writeText(b.dataset.copy);
          b.textContent = "COPIED";
        } catch {
          b.textContent = "SELECT TEXT";
        }
      }),
  );
}
function form() {
  return `<form id="inspect" class="inline-form"><div><label for="cycle">Shit Cycle</label><input id="cycle" name="cycle" inputmode="numeric" pattern="[0-9]+" value="4" required></div><div><label for="wallet">Wallet (optional)</label><input id="wallet" name="wallet" placeholder="Solana wallet address"></div><button class="primary">INSPECT</button></form>`;
}
function wireForm() {
  const f = document.querySelector("#inspect");
  if (f)
    f.onsubmit = (e) => {
      e.preventDefault();
      location.href =
        "/verify/" +
        encodeURIComponent(f.cycle.value) +
        (f.wallet.value ? "?wallet=" + encodeURIComponent(f.wallet.value) : "");
    };
}
async function cycles() {
  const offset = Number(
    new URLSearchParams(location.search).get("offset") ?? 0,
  );
  const [data, stats] = await Promise.all([
    api("/api/explorer/cycles?offset=" + offset),
    api("/api/stats"),
  ]);
  app.innerHTML = `<section class="hero"><div class="eyebrow">PUBLIC CYCLE EXPLORER</div><h1>Serious receipts.<br>Questionable output.</h1><p class="intro">Every completed Shit Cycle has a fixed budget, a public manifest and a commitment on Solana. Follow the reward. Check the maths.</p></section><div class="grid">${[
    ["CATSHIT DISTRIBUTED", units(stats.distributedBaseUnits)],
    ["ACTIVE MINERS", stats.activeMiners],
    ["CYCLES PUBLISHED", stats.publishedCycles],
  ]
    .map(
      ([l, n]) =>
        `<div class="card"><div class="label">${l}</div><div class="number">${n}</div><small>Finalized chain data</small></div>`,
    )
    .join(
      "",
    )}</div><div class="actions"><h2>Shit Cycles</h2></div><div class="table-wrap"><table><thead><tr><th>Cycle</th><th>Miners</th><th>Total PP</th><th>Allocated CATSHIT</th><th>Claims</th><th>Verification</th></tr></thead><tbody>${data.items.map((c) => `<tr><td><a href="/cycles/${c.cycleId}">#${c.cycleId}</a><br><small>${date(c.endTime)}</small></td><td>${c.minerCount}</td><td>${units(c.totalPointUnits, 3)}</td><td>${units(c.totalAllocatedBaseUnits)}</td><td>${c.claimCount} / ${c.leafCount}</td><td>${badge(c.verification)}</td></tr>`).join("")}</tbody></table></div><div class="actions">${offset ? `<a class="action" href="/cycles?offset=${Math.max(0, offset - 12)}">NEWER</a>` : ""}${data.nextOffset != null ? `<a class="action" href="/cycles?offset=${data.nextOffset}">OLDER</a>` : ""}</div><section class="panel"><h2>Follow your shit.</h2>${form()}</section><p class="muted">Verification labels are cached reports, not on-chain proofs. Open a cycle for the actual checks and verification time.</p>`;
  wireForm();
}
async function cyclePage(id, verify = false) {
  const wallet = new URLSearchParams(location.search).get("wallet");
  const c = await api(
    "/api/explorer/cycles/" +
      id +
      (wallet ? "?wallet=" + encodeURIComponent(wallet) : ""),
  );
  app.innerHTML = `<div class="hero"><div class="eyebrow">${verify ? "VERIFY THE SHIT" : "PUBLIC SETTLEMENT RECORD"}</div><h1>Shit Cycle #${esc(c.cycleId)}</h1>${badge(c.status)} <span class="muted">${date(c.startTime)} → ${date(c.endTime)}</span></div><div class="split"><section><div id="verification" class="panel"><p>Loading verification report…</p></div><div class="actions"><a class="action primary" href="/verify/${id}">VERIFY THE SHIT</a><a class="action" href="${esc(c.manifestUrl)}">DOWNLOAD MANIFEST</a><a class="action" href="/api/cycles/${id}/verification" download="cycle-${id}-verifier-report.json">VERIFIER REPORT</a></div><p class="muted">A manifest can be internally consistent yet dishonest. Both internal consistency and independent chain recomputation must pass.</p></section><section class="panel"><div class="label">FIXED CYCLE BUDGET</div><h1>${units(c.rewardBudgetBaseUnits)}</h1><span class="muted">CATSHIT · existing tokens from a finite reserve</span><div class="facts">${[
    ["TOTAL PP", units(c.totalPointUnits, 3)],
    ["MINERS", c.minerCount],
    ["CLAIMED", units(c.claimedBaseUnits)],
    ["REMAINING", units(c.remainingBaseUnits)],
  ]
    .map(
      ([k, v]) =>
        `<div><span class="label">${k}</span><strong>${v}</strong></div>`,
    )
    .join(
      "",
    )}</div>${c.minerCount === 0 ? "<h2>NO SHIT HAPPENED.</h2><p>0 CATSHIT allocated. No reserve consumed.</p>" : ""}<div class="timeline"><span>ENDED</span><span>CALCULATED</span>${c.verification === "VALID" ? "<span>VERIFIED</span>" : ""}${c.status === "PUBLISHED" ? "<span>PUBLISHED</span><span>CLAIMS OPEN</span>" : ""}</div><p class="label">PUBLICATION · SLOT ${c.publishedSlot || "PENDING"}</p>${explorer("transaction", c.publicationSignature)}</section></div>${technical(c)}<section class="panel"><h2>Inspect a wallet</h2>${form()}<div id="proof"></div></section><h2>Claim receipts</h2>${c.claims.length ? `<div class="table-wrap"><table><thead><tr><th>Wallet</th><th>CATSHIT</th><th>Claimed</th><th>Transaction</th></tr></thead><tbody>${c.claims.map((r) => `<tr><td><a href="/shitter/${r.wallet}">${short(r.wallet)}</a></td><td>${units(r.rewardBaseUnits)}</td><td>${date(r.timestamp)}</td><td>${explorer("transaction", r.signature)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="muted">No finalized claims yet.</p>'}`;
  wireCopy();
  wireForm();
  document.querySelector("#cycle").value = id;
  if (wallet) document.querySelector("#wallet").value = wallet;
  if (config.manifestPublicBaseUrl) {
    const a = document.createElement("a");
    a.className = "action";
    a.textContent = "STORAGE MIRROR";
    a.href =
      config.manifestPublicBaseUrl +
      "/cycles/" +
      encodeURIComponent(c.genesisHash) +
      "/" +
      encodeURIComponent(id) +
      "/manifest.json";
    a.rel = "noopener noreferrer";
    document.querySelector(".actions").append(a);
  }
  const r = await api("/api/cycles/" + id + "/verification");
  const ok =
    r.result === "VALID" &&
    r.internalConsistency &&
    r.chainRecomputation &&
    !r.pendingPublication;
  document.querySelector("#verification").innerHTML =
    `<div class="label">VERIFICATION REPORT · ${r.verifiedAt ? new Date(r.verifiedAt).toLocaleString() : "NOT YET VERIFIED"}</div><div class="result ${r.result.toLowerCase()}"><h2>${ok ? "THE SHIT CHECKS OUT." : r.result === "INVALID" ? "THE SHIT DOES NOT CHECK OUT." : "UNVERIFIABLE WITH THIS RPC"}</h2>${badge(r.result)}<p class="muted">${ok ? "The recorded checks matched finalized public history." : r.result === "INVALID" ? "A concrete mismatch was detected. Review the failed check." : "Verification is incomplete or a required input is unavailable. This does not prove the cycle is invalid."}</p></div>${(r.checks ?? []).map((x) => `<div class="check"><span class="symbol ${esc(x.status)}">${x.status === "PASS" ? "✓" : x.status === "FAIL" ? "✕" : "—"}</span><div><strong>${esc(x.label)}</strong><small>${esc(x.status)}${x.detail ? " · " + esc(x.detail) : ""}</small></div></div>`).join("")}<p class="muted">${esc(r.detail ?? "Read-only cached report. Full rechecks run on publication or by operator command.")} ${r.sourceWatermark ? "Source through slot " + r.sourceWatermark : ""}</p>`;
  if (wallet) {
    const p = await api(
      `/api/cycles/${id}/verify-wallet/${encodeURIComponent(wallet)}`,
    );
    document.querySelector("#proof").innerHTML =
      `<h3>${p.rewardBaseUnits === "0" ? "NO SHIT THIS CYCLE" : p.claimed ? "CLAIMED" : "REWARD AVAILABLE"}</h3><div class="facts"><div>PP<strong>${units(p.pointUnits, 3)}</strong></div><div>CATSHIT<strong>${units(p.rewardBaseUnits)}</strong></div></div><p>Proof against committed root: <strong>${p.proofValid ? "VALID" : p.rewardBaseUnits === "0" ? "NO REWARD LEAF" : "INVALID"}</strong></p><p>${p.claimed ? explorer("transaction", p.claimSignature) : "Claim in the Android app with your wallet."}</p><details><summary>Leaf and positional proof</summary><pre>${esc(JSON.stringify(p, null, 2))}</pre></details>`;
  }
}
async function walletPage(wallet) {
  const [w, cycles] = await Promise.all([
    api("/api/explorer/wallet/" + encodeURIComponent(wallet)),
    api(
      "/api/explorer/cycles?wallet=" + encodeURIComponent(wallet) + "&limit=12",
    ),
  ]);
  app.innerHTML = `<div class="hero"><div class="eyebrow">PUBLIC WALLET INSPECTOR</div><h1>One shitter.<br>Public receipts.</h1><code>${esc(wallet)}</code><button class="copy" data-copy="${esc(wallet)}">COPY</button></div><div class="grid">${[
    ["EFFECTIVE LOCK", units(w.accounting?.effectiveLockedBaseUnits)],
    ["LIFETIME PP", units(w.accounting?.pointUnits, 3)],
    ["RATE", units(w.accounting?.ratePointUnitsPerSecond, 3) + " PP/sec"],
    ["CLAIMED CATSHIT", units(w.claimedBaseUnits)],
    ["UNCLAIMED CATSHIT", units(w.unclaimedBaseUnits)],
    ["TIER", esc(w.accounting?.tier)],
  ]
    .map(
      ([l, n]) =>
        `<div class="card"><span class="label">${l}</span><div class="number">${n}</div></div>`,
    )
    .join(
      "",
    )}</div><h2>Recent Shit Cycles</h2><div class="table-wrap"><table><thead><tr><th>Cycle</th><th>PP</th><th>Reward</th><th>Claim</th></tr></thead><tbody>${cycles.items.map((c) => `<tr><td><a href="/verify/${c.cycleId}?wallet=${wallet}">#${c.cycleId}</a></td><td>${units(c.wallet?.pointUnits ?? "0", 3)}</td><td>${units(c.wallet?.rewardBaseUnits ?? "0")}</td><td>${c.wallet?.claimed ? "CLAIMED" : c.wallet && c.wallet.rewardBaseUnits !== "0" ? "CLAIM IN APP" : "NO SHIT"}</td></tr>`).join("")}</tbody></table></div>`;
  wireCopy();
}
async function operator() {
  app.innerHTML = `<div class="hero"><div class="eyebrow">OPERATOR · READ MOSTLY</div><h1>Keep the shit running.</h1><p class="intro">Protected operational data. Token stays in this page's memory and is never placed in the URL.</p></div><form id="login"><label for="token">Operator bearer token</label><input id="token" type="password" autocomplete="off" required><div class="actions"><button class="primary">OPEN DASHBOARD</button></div></form><div id="dashboard"></div>`;
  document.querySelector("#login").onsubmit = async (e) => {
    e.preventDefault();
    const token = document.querySelector("#token").value;
    document.querySelector("#token").value = "";
    try {
      const result = await api("/api/operator/status", {
        headers: { Authorization: "Bearer " + token },
      });
      const s = result.snapshot;
      document.querySelector("#login").hidden = true;
      document.querySelector("#dashboard").innerHTML =
        `<h2>System ${badge(result.status)} <small>${date(result.updatedAt)}</small></h2><div class="operator-grid">${Object.entries(
          s.components,
        )
          .map(
            ([name, state]) =>
              `<div class="card"><div class="label">${esc(name)}</div><h2>${badge(state)}</h2></div>`,
          )
          .join("")}</div><div class="grid">${[
          ["RESERVE", units(s.reserve.vaultBaseUnits)],
          ["COMMITTED", units(s.reserve.committedBaseUnits)],
          ["FREE CYCLES", s.reserve.cyclesRemaining],
        ]
          .map(
            ([n, v]) =>
              `<div class="card"><div class="label">${n}</div><div class="number">${v}</div></div>`,
          )
          .join(
            "",
          )}</div><section class="panel"><h2>Explicit chain recheck</h2><form id="reverify" class="inline-form"><div><label for="checkId">Cycle ID</label><input id="checkId" value="0" pattern="[0-9]+" required></div><button>REVERIFY</button></form><button type="button" id="cancelCheck" hidden>CANCEL CHECK</button><p id="progress" role="status"></p></section>${Object.entries(
          s,
        )
          .filter(([k]) => !["status", "components", "reserve"].includes(k))
          .map(
            ([k, v]) =>
              `<details ${["deployment", "historyCoverage", "eventIndexing", "cycleProjection", "rpcMetrics", "publisher"].includes(k) ? "open" : ""}><summary>${esc(k.toUpperCase())}</summary><pre>${esc(JSON.stringify(v, null, 2))}</pre></details>`,
          )
          .join("")}`;
      document.querySelector("#reverify").onsubmit = async (event) => {
        event.preventDefault();
        const progress = document.querySelector("#progress");
        const controller = new AbortController();
        const cancel = document.querySelector("#cancelCheck");
        cancel.hidden = false;
        cancel.onclick = () => controller.abort();
        event.submitter.disabled = true;
        progress.textContent =
          "VERIFYING FINALIZED HISTORY… Fetch cycle → read history → recompute PP/rewards → check root.";
        try {
          const report = await api(
            "/api/operator/cycles/" +
              encodeURIComponent(document.querySelector("#checkId").value) +
              "/verify",
            {
              method: "POST",
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(180000),
              ]),
              headers: { Authorization: "Bearer " + token },
            },
          );
          progress.textContent = report.result + " · " + report.verifiedAt;
        } catch (error) {
          progress.textContent = controller.signal.aborted
            ? "Verification cancelled. No new result is asserted."
            : error.message;
        } finally {
          cancel.hidden = true;
          event.submitter.disabled = false;
        }
      };
    } catch (error) {
      document.querySelector("#dashboard").innerHTML =
        `<p class="error">${esc(error.message)}</p>`;
    }
  };
}
function about(trust = false) {
  app.innerHTML = trust
    ? `<section class="hero text"><div class="eyebrow">TRUST, SPELLED OUT</div><h1>What do I have<br>to trust?</h1><p>Solana consensus and accessible finalized history. An RPC that returns complete data. A publisher that chooses the correct root. The current program upgrade authority. Manifest hosting availability.</p><h2>What can be checked?</h2><p>Accounting is deterministic. Canonical manifests are public. A separate verifier reconstructs Poop Points and allocation from public chain history. Published roots cannot be edited by the current program, and claims transfer existing tokens from a finite reserve.</p><h2>What is not guaranteed?</h2><p>The publisher can submit a dishonest root. On-chain membership checks do not recompute historical PP. There is no challenge mechanism, publisher consensus or audit. An upgrade authority can change the program. A green verifier report is evidence of specific completed checks, not an on-chain fraud proof.</p><a class="action" href="/verify/4">INSPECT A REAL CYCLE</a></section>`
    : `<section class="hero text"><div class="eyebrow">ANOTHER CAT TOKEN? UNFORTUNATELY, YES.</div><h1>How the shit works.</h1><ol><li>Lock CATSHIT in a Solana mining position.</li><li>The locked amount determines the cat's speed.</li><li>Poop Points accrue from finalized stake history, even with the app closed.</li><li>Every nonempty Shit Cycle has a fixed reward budget.</li><li>Rewards follow each wallet's share of exact PP, with deterministic integer rounding.</li><li>A Merkle root is published on Solana.</li><li>Your wallet signs a claim; the program transfers existing CATSHIT from the reserve.</li><li>Anyone can independently recompute the result.</li></ol><h2>The server cannot mint arbitrary shit.</h2><p>The mint authority is revoked. Supply is fixed. Reward claims are transfers, not newly minted tokens.</p><div class="actions"><a class="action primary" href="/cycles">EXPLORE CYCLES</a><a class="action" href="/trust">TRUST DETAILS</a></div></section>`;
}
async function main() {
  config = await api("/api/explorer/config");
  document.querySelector("#network").textContent =
    config.cluster.toUpperCase() + " · TEST CONFIG";
  const p = location.pathname.split("/").filter(Boolean);
  document.querySelectorAll("nav a").forEach((a) => {
    if (a.getAttribute("href") === location.pathname)
      a.setAttribute("aria-current", "page");
  });
  if (p[0] === "operator") return operator();
  if (p[0] === "about" || p[0] === "trust") return about(p[0] === "trust");
  if (p[0] === "shitter") return walletPage(p[1]);
  if ((p[0] === "cycles" || p[0] === "verify") && p[1])
    return cyclePage(p[1], p[0] === "verify");
  return cycles();
}
main().catch((error) => {
  app.innerHTML = `<section class="hero"><h1>Data unavailable.</h1><p class="error">${esc(error.message)}</p><button id="retry">TRY AGAIN</button></section>`;
  document.querySelector("#retry").onclick = () => location.reload();
});
