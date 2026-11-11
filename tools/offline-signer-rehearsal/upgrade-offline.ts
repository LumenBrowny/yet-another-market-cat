import { readFileSync, writeFileSync } from "node:fs";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  inspectUpgrade,
  type UpgradePolicy,
  type UpgradeRequest,
} from "./upgrade-policy";
const read = (p: string) => {
  const b = readFileSync(p);
  if (b.length > 32768) throw Error("Large input");
  return JSON.parse(b.toString("utf8"));
};
try {
  const [mode, confirm] = process.argv.slice(2);
  if (
    !["review", "sign"].includes(mode) ||
    process.argv.length !== (mode === "sign" ? 4 : 3) ||
    (mode === "sign" && confirm !== "--confirm-local-test")
  )
    throw Error("Command");
  const p: UpgradePolicy = read("upgrade-policy.json"),
    r: UpgradeRequest = read("work/request.upgrade.json"),
    tx = inspectUpgrade(p, r);
  const identity = read("work/identity.public.json");
  if (identity.admin !== p.newAuthority) throw Error("Not your test admin");
  console.log(
    JSON.stringify(
      {
        warning:
          "LOCAL TEST ONLY; binary hash is an online attestation, not encoded in the authority instruction",
        instructions: ["advanceNonceAccount", "SetAuthorityChecked"],
        ...p,
        nonceValue: r.nonceValue,
        messageSha256: r.messageSha256,
        signers: tx
          .compileMessage()
          .accountKeys.slice(0, 3)
          .map((k) => k.toBase58()),
        effect:
          "Only upgrade authority changes. No upgrade, close, revoke, token movement or Config initialization.",
      },
      null,
      2,
    ),
  );
  if (mode === "sign") {
    const secret = read("work/TEST-ONLY-PRIVATE-KEYS.json");
    if (secret.kind !== "YAMC_NON_BROADCASTABLE_REHEARSAL_V1")
      throw Error("Test keys only");
    const key = createPrivateKey({
        key: Buffer.from(secret.keys[0], "base64"),
        format: "der",
        type: "pkcs8",
      }),
      pub = createPublicKey(key);
    if (
      key.asymmetricKeyType !== "ed25519" ||
      new PublicKey(
        pub.export({ format: "der", type: "spki" }).subarray(-32),
      ).toBase58() !== p.newAuthority
    )
      throw Error("Wrong key");
    const message = tx.serializeMessage(),
      signature = sign(null, message, key);
    if (!verify(null, message, pub, signature)) throw Error("Signature");
    writeFileSync(
      "work/result.upgrade.json",
      JSON.stringify(
        {
          ...r,
          newAuthority: p.newAuthority,
          signature: signature.toString("base64"),
        },
        null,
        2,
      ) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    console.log("LOCAL_HANDOFF_SIGNED; nothing sent");
  }
} catch {
  console.error(
    "FAILED: command/policy/key mismatch or result already exists. Nothing sent; never share private keys.",
  );
  process.exitCode = 1;
}
