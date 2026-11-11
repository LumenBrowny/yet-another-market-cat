// Bundled with locked dependencies for Windows/offline use. No network calls.
import { readFileSync, writeFileSync } from "node:fs";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { inspect, review, type Policy, type Request } from "./launch-policy";

function read(path: string) {
  const b = readFileSync(path);
  if (b.length > 32768) throw Error("Input too large");
  return JSON.parse(b.toString("utf8"));
}
try {
  const [mode, operation, confirm] = process.argv.slice(2);
  if (
    !["initialize", "rewards", "schedule"].includes(operation) ||
    !["review", "sign"].includes(mode) ||
    process.argv.length !== (mode === "sign" ? 5 : 4)
  )
    throw Error("Use review OP or sign OP --confirm-local-test");
  const p: Policy = read("launch-policy.json"),
    r: Request = read(`work/request.${operation}.json`);
  if (r.operation !== operation) throw Error("Wrong request");
  console.log(JSON.stringify(review(p, r), null, 2));
  if (mode === "sign") {
    if (confirm !== "--confirm-local-test")
      throw Error("Local confirmation required");
    const identity = read("work/identity.public.json");
    if (identity.admin !== p.admin)
      throw Error("Existing offline admin mismatch");
    const secrets = read("work/TEST-ONLY-PRIVATE-KEYS.json");
    if (secrets.kind !== "YAMC_NON_BROADCASTABLE_REHEARSAL_V1")
      throw Error("Disposable keys only");
    const key = createPrivateKey({
      key: Buffer.from(secrets.keys[0], "base64"),
      format: "der",
      type: "pkcs8",
    });
    const pub = createPublicKey(key);
    if (
      key.asymmetricKeyType !== "ed25519" ||
      new PublicKey(
        pub.export({ format: "der", type: "spki" }).subarray(-32),
      ).toBase58() !== p.admin
    )
      throw Error("Wrong admin key");
    const bytes = inspect(p, r).serializeMessage(),
      signature = sign(null, bytes, key);
    if (!verify(null, bytes, pub, signature))
      throw Error("Signature check failed");
    writeFileSync(
      `work/result.${operation}.json`,
      JSON.stringify(
        { ...r, admin: p.admin, adminSignature: signature.toString("base64") },
        null,
        2,
      ) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    console.log("LOCAL_ADMIN_SIGNED. Return only result JSON. Nothing sent.");
  }
} catch {
  console.error(
    "FAILED: check command, policy, request, disposable keys, or existing result. Nothing sent; never share private keys.",
  );
  process.exitCode = 1;
}
