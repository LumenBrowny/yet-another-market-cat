// Composes editable PNG pieces. --seed creates missing code-drawn pieces only;
// normal rebuilds NEVER overwrite hand-edited source art.
/* global document -- page.evaluate executes inside Chromium. */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { build } from "esbuild";
import React from "react";
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const art = "app/assets/chamber-v2-1";
const temp = path.join(root, "temp/chamber-v2-1/render");
const config = JSON.parse(
  fs.readFileSync(path.join(root, "app/src/chamber/scene-011a.json"), "utf8"),
);
const out = path.join(root, art);
fs.mkdirSync(temp, { recursive: true });
fs.mkdirSync(path.join(out, "plates"), { recursive: true });
const esc = (v) =>
  String(v)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
function render(node) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(render).join("");
  if (typeof node !== "object") return esc(node);
  const { type, props } = node;
  if (typeof type === "function") return render(type(props));
  if (type === React.Fragment) return render(props.children);
  const attrs = Object.entries(props)
    .filter(([k, v]) => k !== "children" && v != null)
    .map(
      ([k, v]) =>
        `${k === "preserveAspectRatio" ? k : k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}="${esc(v)}"`,
    )
    .join(" ");
  return `<${type} ${attrs}>${render(props.children)}</${type}>`;
}
const source = fs
  .readFileSync(path.join(root, "app/src/chamber/ChamberArtwork.tsx"), "utf8")
  .replace(/function (Coin|Bowl)\(/g, "export function $1(");
await build({
  stdin: {
    contents: source,
    loader: "tsx",
    resolveDir: path.join(root, "app/src/chamber"),
  },
  outfile: path.join(temp, "pieces.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["react", "react/jsx-runtime"],
  loader: { ".png": "dataurl" },
  plugins: [
    {
      name: "svg",
      setup(b) {
        b.onResolve({ filter: /^react-native-svg$/ }, () => ({
          path: "svg",
          namespace: "tags",
        }));
        b.onLoad({ filter: /.*/, namespace: "tags" }, () => ({
          contents:
            'export const G="g",Path="path",Rect="rect",Ellipse="ellipse",Circle="circle",Image="image";',
        }));
      },
    },
  ],
});
await build({
  entryPoints: [path.join(root, "packages/cat-shit-engine/src/chamber.ts")],
  outfile: path.join(temp, "room.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
});
const { Coin, Bowl } = require(path.join(temp, "pieces.cjs"));
const { roomForTier, FLOOR_COINS } = require(path.join(temp, "room.cjs"));
let pw;
try {
  pw = require("playwright-core");
} catch {
  pw = require(process.env.YAMC_PLAYWRIGHT_PATH || "playwright-core");
}
const browser = await pw.chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 680, height: 580 },
  deviceScaleFactor: 1,
});
const svg = (body, box = "0 0 340 290", w = 680, h = 580) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${box}">${body}</svg>`;
const img = (file, r = { x: 0, y: 0, width: 340, height: 290 }, extra = "") =>
  `<image href="data:image/png;base64,${fs.readFileSync(path.join(out, file)).toString("base64")}" x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" preserveAspectRatio="none" ${extra}/>`;
async function png(file, body, box = "0 0 340 290", w = 680, h = 580) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(
    `<body style="margin:0;background:transparent">${svg(body, box, w, h)}</body>`,
  );
  await page.evaluate(async () => {
    await Promise.all(Array.from(document.images, (i) => i.decode()));
  });
  fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
  await page.screenshot({ path: path.join(out, file), omitBackground: true });
}
async function seed(file, ...args) {
  if (!fs.existsSync(path.join(out, file))) {
    if (!process.argv.includes("--seed"))
      throw new Error(`Missing ${file}; use --seed once`);
    await png(file, ...args);
  }
}
const tiers = {
  IDLE: "CALM",
  NOTICE: "CONCERNED",
  PANIC: "AIRBORNE",
  DISASTER: "TRANSCENDENT",
};
try {
  await seed(
    "furniture/relay-gauge.png",
    `<path d="M281 111v96q0 12 12 12h13" fill="none" stroke="#151e1b" stroke-width="4"/><rect x="277" y="104" width="43" height="104" rx="4" fill="#504e3d" stroke="#211f1b" stroke-width="3"/><path d="M280 107h36v97h-36" fill="none" stroke="#84785a"/><circle cx="297" cy="117" r="10" fill="#b9ad85" stroke="#282d25" stroke-width="3"/><path d="M290 117a7 7 0 0 1 14 0M297 117l4-5" fill="none" stroke="#4d4432" stroke-width="1.4"/><rect x="283" y="188" width="27" height="14" fill="#272d27"/><path d="M286 191h21m-21 4h21m-21 4h21" stroke="#766e54"/><circle cx="282" cy="109" r="1.5" fill="#171c17"/><circle cx="315" cy="202" r="1.5" fill="#171c17"/>`,
  );
  await seed(
    "overlays/damage.png",
    `<path d="M291 198l-9 12 10 8-7 16" fill="none" stroke="#161e1a" stroke-width="3"/><path d="M270 89l-9 10 4 8-10 9m6-17-7-2" fill="none" stroke="#322e24" stroke-width="1.8"/><path d="M36 254l15-5 9 14-19 4z" fill="#b5a37e" stroke="#584d38"/><path d="M40 255l10-2m-8 6 9-3" stroke="#716a50"/><path d="M281 189l-12 4v18l12-7z" fill="#776b4b" stroke="#242922" stroke-width="1.5"/>`,
  );
  for (const [state, tier] of Object.entries(tiers)) {
    const room = roomForTier(tier),
      name = state.toLowerCase();
    await seed(
      `bowl-and-floor/bowl-${name}.png`,
      render(React.createElement(Bowl, { room })),
    );
    await seed(
      `bowl-and-floor/floor-${name}.png`,
      render(
        FLOOR_COINS.slice(0, room.floorCoins).map((c, i) =>
          React.createElement(Coin, { ...c, key: i }),
        ),
      ) +
        (state === "DISASTER"
          ? render(React.createElement(Coin, { x: 174, y: 256, radius: 4 }))
          : ""),
    );
    for (let f = 0; f < 2; f++) {
      const danger = state === "PANIC" || state === "DISASTER";
      const chart =
        state === "IDLE"
          ? f
            ? "M2 17l5-4 5 2 5-7 7 2"
            : "M2 18l5-2 5 1 5-5 7-2"
          : state === "NOTICE"
            ? f
              ? "M2 18l5-3 4 2 5-8 8-6"
              : "M2 18l6-2 4-5 5 2 7-8"
            : f
              ? "M2 3l5 3 4-1 5 10 8 3"
              : "M2 4l6-1 5 6 4-1 7 10";
      await seed(
        `monitor/${name}-${f + 1}.png`,
        `<rect width="26" height="20" rx="1" fill="#15221f"/><path d="M2 6h22M2 13h22M8 2v16M18 2v16" stroke="#35443b" stroke-width=".5"/><path d="${chart}" fill="none" stroke="${room.lamp}" stroke-width="1.4"/>${danger ? `<path d="M14 3l7 12H7z" fill="${f ? "#a9864f" : "#bc9b60"}" stroke="#202b24"/><path d="M14 6v4m0 2v1" stroke="#30271f" stroke-width="1.5"/>` : ""}${state === "DISASTER" ? '<path d="M3 1l6 5-3 4 8 7M23 2l-7 4" fill="none" stroke="#b2b398" stroke-width=".6"/>' : ""}`,
        "0 0 26 20",
        104,
        80,
      );
      await seed(
        `indicator/${name}-${f + 1}.png`,
        `<rect x="3" y="3" width="19" height="55" rx="2" fill="#202a25" stroke="#7c7760"/><circle cx="12.5" cy="11" r="4" fill="${room.lamp}" opacity="${f ? 0.65 : 0.9}"/>${[0, 1, 2, 3].map((i) => `<rect x="7" y="${47 - i * 8}" width="11" height="5" rx="1" fill="${i < room.bars ? room.lamp : "#384039"}" opacity="${f ? 0.8 : 1}"/>`).join("")}`,
        "0 0 25 61",
        100,
        244,
      );
    }
  }
  await seed("bowl-and-floor/floor-loaf.png", "");
  for (const name of ["loaf", "idle", "notice", "panic", "disaster"]) {
    const state = name === "loaf" ? "IDLE" : name.toUpperCase(),
      s = config.states[state];
    let body =
      img(config.shell) +
      '<rect width="340" height="290" fill="#0e1b19" opacity=".15"/>' +
      img("furniture/relay-gauge.png") +
      img(config.desk.asset, config.desk);
    if (s.chair !== "seated")
      body += img(
        config.chair.asset,
        config.chair,
        s.chair === "shifted" ? 'transform="rotate(-16 117 247)"' : "",
      );
    body +=
      img(`bowl-and-floor/floor-${name}.png`) +
      img(`bowl-and-floor/bowl-${state.toLowerCase()}.png`);
    if (s.damage) body += img("overlays/damage.png");
    await png(`plates/${name}.png`, body);
    // Contact-sheet previews use exactly the runtime placements, no duplicate scene.
    for (let f = 0; f < 2; f++)
      await png(
        `previews/${name}-${f + 1}.png`,
        body +
          img(
            `secondary-character/${state.toLowerCase()}-0${f + 1}.png`,
            config.character[state],
          ) +
          img(`monitor/${state.toLowerCase()}-${f + 1}.png`, config.monitor) +
          img(
            `indicator/${state.toLowerCase()}-${f + 1}.png`,
            config.indicator,
          ),
      );
  }
} finally {
  await browser.close();
}
const hash = (f) =>
  createHash("sha256")
    .update(fs.readFileSync(path.join(root, f)))
    .digest("hex");
const files = fs
  .readdirSync(out, { recursive: true })
  .filter(
    (f) =>
      f.endsWith(".png") &&
      !f.startsWith("plates") &&
      !f.startsWith("previews"),
  )
  .map((f) => `${art}/${f.replaceAll("\\", "/")}`);
const inputs = [
  "scripts/render-chamber-011a.mjs",
  "app/src/chamber/scene-011a.json",
  ...files,
];
const outputs = ["loaf", "idle", "notice", "panic", "disaster"].map(
  (n) => `${art}/plates/${n}.png`,
);
fs.writeFileSync(
  path.join(out, "plates/manifest.json"),
  JSON.stringify(
    {
      inputs: Object.fromEntries(inputs.map((f) => [f, hash(f)])),
      outputs: Object.fromEntries(outputs.map((f) => [f, hash(f)])),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Composed 5 plates and 10 previews from ${files.length} independently replaceable PNGs.`,
);
