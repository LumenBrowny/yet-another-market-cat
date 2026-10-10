import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import React from "react";
import process from "node:process";
import console from "node:console";
import { createHash } from "node:crypto";

// Compile the same editable layer tree to cached plates. No manual scene copies.
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const temp = path.join(root, "temp/chamber-v2/render");
const out = path.join(root, "app/assets/chamber-v2/plates");
const hash = (file) =>
  createHash("sha256")
    .update(fs.readFileSync(path.join(root, file)))
    .digest("hex");
const inputs = [
  "app/src/chamber/ChamberArtwork.tsx",
  "app/src/chamber/layout.ts",
  "app/src/chamber/assets.ts",
  "packages/cat-shit-engine/src/chamber.ts",
  "packages/cat-shit-engine/src/math.ts",
  "scripts/render-chamber-art.mjs",
  ...["room", "normal", "notice", "panic", "disaster"].map(
    (n) => `app/assets/chamber-v2/${n}.png`,
  ),
];
fs.mkdirSync(temp, { recursive: true });
fs.mkdirSync(out, { recursive: true });
await build({
  entryPoints: [path.join(root, "app/src/chamber/ChamberArtwork.tsx")],
  outfile: path.join(temp, "art.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["react", "react/jsx-runtime"],
  loader: { ".png": "dataurl" },
  plugins: [
    {
      name: "svg-tags",
      setup(b) {
        b.onResolve({ filter: /^react-native-svg$/ }, () => ({
          path: "svg",
          namespace: "svg-tags",
        }));
        b.onLoad({ filter: /.*/, namespace: "svg-tags" }, () => ({
          contents:
            'export const G="g",Path="path",Rect="rect",Ellipse="ellipse",Circle="circle",Image="image",Text="text";',
        }));
      },
    },
  ],
});
const { ChamberArtwork } = require(path.join(temp, "art.cjs"));
const escape = (v) =>
  String(v)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
function render(node) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(render).join("");
  if (typeof node !== "object") return escape(node);
  const { type, props } = node;
  if (type === React.Fragment) return render(props.children);
  if (typeof type === "function") return render(type(props));
  if (typeof type === "object" && type.type)
    return render(React.createElement(type.type, props));
  if (typeof type !== "string") throw new Error("Unsupported artwork node");
  const attributes = Object.entries(props)
    .filter(([k, v]) => k !== "children" && v != null)
    .map(([k, v]) => {
      const key =
        k === "preserveAspectRatio"
          ? k
          : k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
      return `${key}="${escape(v)}"`;
    })
    .join(" ");
  return `<${type} ${attributes}>${render(props.children)}</${type}>`;
}
const playwrightPath = process.env.YAMC_PLAYWRIGHT_PATH;
let playwright;
try {
  playwright = require("playwright-core");
} catch {
  if (!playwrightPath)
    throw new Error(
      "Install playwright-core or set YAMC_PLAYWRIGHT_PATH to its local module path",
    );
  playwright = require(playwrightPath);
}
const browser = await playwright.chromium.launch({
  channel: process.env.YAMC_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const outputs = {};
try {
  const page = await browser.newPage({
    viewport: { width: 680, height: 580 },
    deviceScaleFactor: 1,
  });
  for (const [name, tier] of [
    ["loaf", "DEAD_INSIDE"],
    ["idle", "CALM"],
    ["notice", "CONCERNED"],
    ["panic", "AIRBORNE"],
    ["disaster", "TRANSCENDENT"],
  ]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="580" viewBox="0 0 340 290">${render(React.createElement(ChamberArtwork, { tier }))}</svg>`;
    fs.writeFileSync(path.join(temp, `${name}.svg`), svg);
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`, {
      waitUntil: "load",
    });
    await page.screenshot({
      path: path.join(out, `${name}.png`),
      omitBackground: true,
    });
    const assetPath = `app/assets/chamber-v2/plates/${name}.png`;
    outputs[assetPath] = hash(assetPath);
    console.log(
      `Rendered ${name}: ${fs.statSync(path.join(out, `${name}.png`)).size} bytes`,
    );
  }
} finally {
  await browser.close();
}
fs.writeFileSync(
  path.join(out, "manifest.json"),
  JSON.stringify(
    {
      width: 680,
      height: 580,
      inputs: Object.fromEntries(inputs.map((file) => [file, hash(file)])),
      outputs,
    },
    null,
    2,
  ) + "\n",
);
