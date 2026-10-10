import { readFileSync, writeFileSync } from "node:fs";
import { convertIdlToCamelCase } from "@coral-xyz/anchor/dist/cjs/idl";
// Anchor's Program constructor applies the same snake_case -> camelCase conversion.
// Store the normalized IDL so the mobile client can use coders without a signing provider.
const idl = JSON.parse(readFileSync("target/idl/cat_shit_mining.json", "utf8"));
writeFileSync(
  "packages/shared/src/idl.json",
  JSON.stringify(convertIdlToCamelCase(idl), null, 2) + "\n",
);
console.log("Synced normalized Anchor IDL to shared client.");
