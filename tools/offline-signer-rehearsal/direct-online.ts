import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  NonceAccount,
  type AccountInfo,
} from "@solana/web3.js";
import {
  buildDirect,
  inspectDirect,
  digest,
  LOADER,
  PROGRAM,
  DATA,
  type DirectPolicy,
  type DirectRequest,
  type DirectOperation,
} from "./direct-policy";
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const save = (p: string, v: unknown) =>
  writeFileSync(p, JSON.stringify(v, null, 2) + "\n", { flag: "wx" });
async function main() {
  const [mode, op, resultFile] = process.argv.slice(2);
  if (
    !["prepare", "send", "status"].includes(mode) ||
    !["accept-buffer", "deploy"].includes(op) ||
    process.argv.length !== (mode === "send" ? 5 : 4)
  )
    throw Error("Use prepare/status OP or send OP RESULT");
  const operation = op as DirectOperation,
    m = read(".dev/offline-direct-current.json"),
    dir = m.directory,
    p: DirectPolicy = read(`${dir}/direct-policy.json`);
  buildDirect(p, operation, PROGRAM.toBase58());
  const c = new Connection(p.rpc, "finalized");
  if (
    (await c.getGenesisHash()) !== p.genesis ||
    m.genesis !== p.genesis ||
    m.binarySha256 !== p.binarySha256
  )
    throw Error("Local identity changed");
  const elf = readFileSync("target/deploy/cat_shit_mining.so");
  if (digest(elf) !== p.binarySha256 || elf.length !== p.binarySize)
    throw Error("ELF changed");
  const config = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      PROGRAM,
    )[0],
    keys = [
      new PublicKey(p.nonceAccount),
      new PublicKey(p.buffer),
      PROGRAM,
      DATA,
      config,
    ];
  const snapshot = () => c.getMultipleAccountsInfoAndContext(keys, "finalized");
  function check(v: (AccountInfo<Buffer> | null)[], stage: number) {
    const [n, b, prog, pd, cfg] = v;
    if (cfg) throw Error("Unexpected Config");
    if (
      !n ||
      !n.owner.equals(SystemProgram.programId) ||
      n.executable ||
      n.data.length !== 80 ||
      n.data.readUInt32LE(0) !== 1 ||
      n.data.readUInt32LE(4) !== 1
    )
      throw Error("Invalid nonce");
    const nonce = NonceAccount.fromAccountData(n.data);
    if (nonce.authorizedPubkey.toBase58() !== p.admin)
      throw Error("Nonce authority");
    if (stage < 2) {
      if (prog || pd) throw Error("Program already exists");
      if (
        !b ||
        !b.owner.equals(LOADER) ||
        b.executable ||
        b.data.length !== 37 + elf.length ||
        b.data.readUInt32LE(0) !== 1 ||
        b.data[4] !== 1 ||
        !b.data
          .subarray(5, 37)
          .equals(
            new PublicKey(stage === 0 ? p.bufferAuthority : p.admin).toBuffer(),
          ) ||
        !b.data.subarray(37).equals(elf)
      )
        throw Error("Buffer authority/content mismatch");
    } else {
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
        !pd.data.subarray(13, 45).equals(new PublicKey(p.admin).toBuffer()) ||
        !pd.data.subarray(45).equals(elf)
      )
        throw Error("Deployed program mismatch");
      if (
        b &&
        (b.lamports !== 0 || !b.owner.equals(LOADER) || b.data.length !== 37)
      )
        throw Error("Buffer not consumed");
    }
    return nonce.nonce;
  }
  const stage = operation === "accept-buffer" ? 0 : 1,
    requestPath = `${dir}/request.${operation}.json`,
    attemptPath = `${dir}/attempt.${operation}.json`;
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
    if (s.err) throw Error("Finalized failure, reconcile nonce");
    const after = await snapshot(),
      nonce = check(after.value, stage + 1);
    if (nonce === read(requestPath).nonceValue) throw Error("Nonce unchanged");
    const report = {
      status: "FINALIZED_LOCAL_DIRECT_STEP",
      operation,
      signature: a.signature,
      slot: s.slot,
      nonceAdvanced: true,
      binarySha256: p.binarySha256,
      programExists: stage === 1,
      authority: p.admin,
      configAbsent: true,
    };
    if (!existsSync(`${dir}/report.${operation}.json`))
      save(`${dir}/report.${operation}.json`, report);
    console.log(JSON.stringify(report, null, 2));
    return true;
  }
  if (mode === "status" || (mode === "send" && existsSync(attemptPath))) {
    await status();
    return;
  }
  const before = await snapshot(),
    nonce = check(before.value, stage),
    tx = buildDirect(p, operation, nonce),
    bytes = tx.serializeMessage(),
    r: DirectRequest = {
      operation,
      nonceValue: nonce,
      messageBase64: bytes.toString("base64"),
      messageSha256: digest(bytes),
    };
  if (mode === "send") {
    const original = read(requestPath),
      result = read(resultFile);
    for (const [k, v] of Object.entries(r))
      if (original[k] !== v || result[k] !== v) throw Error("Request changed");
    inspectDirect(p, result);
    if (result.admin !== p.admin) throw Error("Wrong admin");
    const sig = Buffer.from(result.signature, "base64");
    if (sig.length !== 64 || sig.toString("base64") !== result.signature)
      throw Error("Signature encoding");
    tx.addSignature(new PublicKey(p.admin), sig);
    for (const [path, address] of [
      [`${dir}/TEST-payer.json`, p.payer],
      operation === "accept-buffer"
        ? [`${dir}/TEST-authority.json`, p.bufferAuthority]
        : ["target/deploy/cat_shit_mining-keypair.json", p.programId],
    ]) {
      const k = Keypair.fromSecretKey(Uint8Array.from(read(path)));
      if (k.publicKey.toBase58() !== address)
        throw Error("Wrong online signer");
      tx.partialSign(k);
    }
    if (!tx.verifySignatures()) throw Error("Invalid signature");
  }
  const raw = tx.serialize({
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
        raw.toString("base64"),
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
      `Simulation failed: ${JSON.stringify(sim.error ?? sim.result.value)}`,
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
  );
  if (check(vals, stage + 1) === nonce) throw Error("Nonce did not advance");
  if (mode === "prepare") {
    save(requestPath, r);
    console.log("PREPARED", operation, "wire bytes", raw.length);
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
  await c.sendRawTransaction(raw, {
    skipPreflight: false,
    preflightCommitment: "finalized",
    minContextSlot: before.context.slot,
    maxRetries: 0,
  });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await status()) return;
  }
  throw Error("Unknown outcome; use status");
}
main().catch((e) => {
  console.error(String(e));
  process.exitCode = 1;
});
