import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  NonceAccount,
  type AccountInfo,
} from "@solana/web3.js";
import {
  buildUpgrade,
  inspectUpgrade,
  digest,
  LOADER,
  PROGRAM,
  DATA,
  type UpgradePolicy,
  type UpgradeRequest,
} from "./upgrade-policy";
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const save = (p: string, v: unknown) =>
  writeFileSync(p, JSON.stringify(v, null, 2) + "\n", { flag: "wx" });
async function main() {
  const mode = process.argv[2];
  if (
    process.argv.length !== 3 ||
    !["prepare", "send", "status"].includes(mode)
  )
    throw Error("Use prepare/send/status");
  const m = read(".dev/offline-loader-current.json"),
    dir = m.directory,
    p: UpgradePolicy = read(`${dir}/upgrade-policy.json`);
  const c = new Connection(p.rpc, "finalized");
  buildUpgrade(p, PROGRAM.toBase58());
  if (
    (await c.getGenesisHash()) !== p.genesis ||
    m.genesis !== p.genesis ||
    m.binarySha256 !== p.binarySha256
  )
    throw Error("Identity mismatch");
  const elf = readFileSync("target/deploy/cat_shit_mining.so");
  if (digest(elf) !== p.binarySha256) throw Error("Binary changed");
  const config = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM,
  )[0];
  const keys = [PROGRAM, DATA, new PublicKey(p.nonceAccount), config];
  function check(v: (AccountInfo<Buffer> | null)[], authority: string) {
    const [prog, pd, n, cfg] = v;
    if (
      !prog?.executable ||
      !prog.owner.equals(LOADER) ||
      prog.data.length !== 36 ||
      prog.data.readUInt32LE(0) !== 2 ||
      !prog.data.subarray(4).equals(DATA.toBuffer()) ||
      !pd ||
      !pd.owner.equals(LOADER) ||
      pd.executable ||
      pd.data.length !== 45 + elf.length ||
      pd.data.readUInt32LE(0) !== 3 ||
      pd.data[12] !== 1 ||
      !pd.data.subarray(13, 45).equals(new PublicKey(authority).toBuffer()) ||
      !pd.data.subarray(45).equals(elf) ||
      cfg
    )
      throw Error("Program/authority/Config state mismatch");
    if (
      !n ||
      !n.owner.equals(SystemProgram.programId) ||
      n.executable ||
      n.data.length !== 80 ||
      n.data.readUInt32LE(0) !== 1 ||
      n.data.readUInt32LE(4) !== 1
    )
      throw Error("Nonce account mismatch");
    const nonce = NonceAccount.fromAccountData(n.data);
    if (nonce.authorizedPubkey.toBase58() !== p.newAuthority)
      throw Error("Nonce authority mismatch");
    return { nonce: nonce.nonce, pd };
  }
  const snapshot = () => c.getMultipleAccountsInfoAndContext(keys, "finalized");
  const attemptPath = `${dir}/upgrade-attempt.json`,
    requestPath = `${dir}/request.upgrade.json`;
  async function status() {
    if (!existsSync(attemptPath)) throw Error("No attempt");
    const a = read(attemptPath),
      s = (
        await c.getSignatureStatuses([a.signature], {
          searchTransactionHistory: true,
        })
      ).value[0];
    if (s?.confirmationStatus !== "finalized") {
      console.log("PENDING_OR_UNKNOWN_DO_NOT_RESIGN");
      return false;
    }
    if (s.err) throw Error("Finalized failure; reconcile nonce");
    const state = check((await snapshot()).value, p.newAuthority),
      original = Buffer.from(
        read(`${dir}/upgrade-before.json`).programDataBase64,
        "base64",
      );
    new PublicKey(p.newAuthority).toBuffer().copy(original, 13);
    if (
      !original.equals(state.pd.data) ||
      state.nonce === read(requestPath).nonceValue
    )
      throw Error("Unexpected post-state");
    const report = {
      status: "FINALIZED_LOCAL_UPGRADE_AUTHORITY_HANDOFF",
      signature: a.signature,
      slot: s.slot,
      onlyAuthorityChanged: true,
      nonceAdvanced: true,
      binarySha256: p.binarySha256,
      configStillAbsent: true,
    };
    if (!existsSync(`${dir}/upgrade-report.json`))
      save(`${dir}/upgrade-report.json`, report);
    console.log(JSON.stringify(report, null, 2));
    return true;
  }
  if (mode === "status" || (mode === "send" && existsSync(attemptPath))) {
    await status();
    return;
  }
  const before = await snapshot(),
    state = check(before.value, p.oldAuthority);
  if (digest(state.pd.data) !== p.programDataSha256)
    throw Error("Pinned program data changed");
  const tx = buildUpgrade(p, state.nonce),
    bytes = tx.serializeMessage(),
    r: UpgradeRequest = {
      nonceValue: state.nonce,
      messageBase64: bytes.toString("base64"),
      messageSha256: digest(bytes),
    };
  if (mode === "send") {
    const result = read(
        "temp/offline-signer-upgrade-return/result.upgrade.json",
      ),
      original = read(requestPath);
    for (const [k, v] of Object.entries(r))
      if (result[k] !== v || original[k] !== v) throw Error("Request changed");
    inspectUpgrade(p, result);
    if (result.newAuthority !== p.newAuthority)
      throw Error("Wrong incoming signer");
    const sig = Buffer.from(result.signature, "base64");
    if (sig.length !== 64 || sig.toString("base64") !== result.signature)
      throw Error("Invalid signature encoding");
    tx.addSignature(new PublicKey(p.newAuthority), sig);
    for (const [role, address] of [
      ["payer", p.payer],
      ["authority", p.oldAuthority],
    ]) {
      const k = Keypair.fromSecretKey(
        Uint8Array.from(read(`${dir}/TEST-${role}.json`)),
      );
      if (k.publicKey.toBase58() !== address) throw Error("Wrong local signer");
      tx.partialSign(k);
    }
    if (!tx.verifySignatures()) throw Error("Signature check failed");
  }
  const wire = tx.serialize({
    requireAllSignatures: mode === "send",
    verifySignatures: mode === "send",
  });
  const sim = await fetch(p.rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "simulateTransaction",
      params: [
        wire.toString("base64"),
        {
          encoding: "base64",
          sigVerify: mode === "send",
          commitment: "finalized",
          minContextSlot: before.context.slot,
          accounts: {
            encoding: "base64",
            addresses: keys.map((k) => k.toBase58()),
          },
        },
      ],
    }),
  }).then((r) => r.json());
  if (sim.error || sim.result.value.err)
    throw Error(
      `Simulation rejected: ${JSON.stringify(sim.error ?? sim.result.value.err)}`,
    );
  const vals = sim.result.value.accounts.map(
      (v: { owner: string; data: string[] } | null) =>
        v
          ? {
              ...v,
              owner: new PublicKey(v.owner),
              data: Buffer.from(v.data[0], "base64"),
            }
          : null,
    ),
    after = check(vals, p.newAuthority),
    expected = Buffer.from(state.pd.data);
  new PublicKey(p.newAuthority).toBuffer().copy(expected, 13);
  if (!expected.equals(after.pd.data) || after.nonce === state.nonce)
    throw Error("Unexpected simulation changes");
  if (mode === "prepare") {
    save(`${dir}/upgrade-before.json`, {
      programDataBase64: state.pd.data.toString("base64"),
    });
    save(requestPath, r);
    console.log("PREPARED local checked authority transfer", wire.length);
    return;
  }
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt("0x" + tx.signature!.toString("hex")),
    signature = "";
  while (n) {
    signature = alphabet[Number(n % 58n)] + signature;
    n /= 58n;
  }
  for (const byte of tx.signature!) {
    if (byte) break;
    signature = "1" + signature;
  }
  save(attemptPath, { signature, messageSha256: r.messageSha256 });
  await c.sendRawTransaction(wire, {
    skipPreflight: false,
    preflightCommitment: "finalized",
    minContextSlot: before.context.slot,
    maxRetries: 0,
  });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await status()) return;
  }
  throw Error("Unknown outcome; status only");
}
main().catch((e) => {
  console.error(String(e));
  process.exitCode = 1;
});
