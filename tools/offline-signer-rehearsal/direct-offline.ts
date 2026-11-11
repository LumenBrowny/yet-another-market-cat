import { readFileSync, writeFileSync } from "node:fs";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  inspectDirect,
  type DirectPolicy,
  type DirectRequest,
} from "./direct-policy";
const read = (path: string) => {
  const b = readFileSync(path);
  if (b.length > 32768) throw Error("Large input");
  return JSON.parse(b.toString("utf8"));
};
try {
  const [mode, operation, confirm] = process.argv.slice(2);
  if (
    !["review", "sign"].includes(mode) ||
    !["accept-buffer", "deploy"].includes(operation) ||
    process.argv.length !== (mode === "sign" ? 5 : 4) ||
    (mode === "sign" && confirm !== "--confirm-local-test")
  )
    throw Error("Command");
  const p: DirectPolicy = read("direct-policy.json"),
    r: DirectRequest = read(`work/request.${operation}.json`);
  if (
    r.operation !== operation ||
    read("work/identity.public.json").admin !== p.admin
  )
    throw Error("Identity");
  const tx = inspectDirect(p, r);
  console.log(
    JSON.stringify(
      {
        warning:
          "LOCAL ONLY. ELF hash is independently checked online, not enforced by the loader instruction.",
        operation,
        ...p,
        nonceValue: r.nonceValue,
        messageSha256: r.messageSha256,
        signers: tx
          .compileMessage()
          .accountKeys.slice(0, 3)
          .map((k) => k.toBase58()),
        effect:
          operation === "accept-buffer"
            ? "Accept buffer authority only; program remains absent"
            : "Create program and deploy approved buffer, with offline admin as FIRST upgrade authority. Config remains absent.",
      },
      null,
      2,
    ),
  );
  if (mode === "sign") {
    const secrets = read("work/TEST-ONLY-PRIVATE-KEYS.json");
    if (secrets.kind !== "YAMC_NON_BROADCASTABLE_REHEARSAL_V1")
      throw Error("Test keys only");
    const key = createPrivateKey({
        key: Buffer.from(secrets.keys[0], "base64"),
        format: "der",
        type: "pkcs8",
      }),
      pub = createPublicKey(key);
    if (
      key.asymmetricKeyType !== "ed25519" ||
      new PublicKey(
        pub.export({ format: "der", type: "spki" }).subarray(-32),
      ).toBase58() !== p.admin
    )
      throw Error("Wrong signer");
    const message = tx.serializeMessage(),
      signature = sign(null, message, key);
    if (!verify(null, message, pub, signature)) throw Error("Signature");
    writeFileSync(
      `work/result.${operation}.json`,
      JSON.stringify(
        { ...r, admin: p.admin, signature: signature.toString("base64") },
        null,
        2,
      ) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    console.log("LOCAL_DIRECT_SIGNED; nothing sent");
  }
} catch {
  console.error(
    "FAILED: command/policy/key mismatch or existing result. Nothing sent; never share private keys.",
  );
  process.exitCode = 1;
}
