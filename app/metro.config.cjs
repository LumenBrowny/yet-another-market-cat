const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");
const config = getDefaultConfig(__dirname);
const workspace = path
  .resolve(__dirname, "..")
  .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const existing = config.resolver.blockList;
// Native build directories disappear during CMake builds; watching them races on Windows.
// Ignore large local ledgers/AVDs and Rust outputs as well as native intermediates.
config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  new RegExp(
    `^${workspace}[/\\\\](?:\\.dev|target|app[/\\\\](?:android|ios))(?:[/\\\\]|$)`,
  ),
  /[/\\](?:\.cxx|\.gradle)(?:[/\\]|$)/,
  /[/\\]android[/\\]build(?:[/\\]|$)/,
];
module.exports = config;
