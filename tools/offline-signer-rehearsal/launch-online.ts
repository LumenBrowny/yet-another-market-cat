// Connected-PC driver. Hard-local policy; never a mainnet deployment command.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  NonceAccount,
  SystemProgram,
  type AccountInfo,
} from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { unpackMint, unpackAccount } from "@solana/spl-token";
import { IDL, PROGRAM_ID } from "../../packages/shared/src/client";
import {
  addresses,
  build,
  hash,
  inspect,
  loader,
  programData,
  validatePolicy,
  type Policy,
  type Request,
  type Operation,
} from "./launch-policy";
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const save = (p: string, v: unknown) =>
  writeFileSync(p, JSON.stringify(v, null, 2) + "\n", { flag: "wx" });
const eq = (actual: unknown, expected: unknown) => {
  if (String(actual) !== String(expected))
    throw Error(`State mismatch: ${actual} != ${expected}`);
};
const wait = () => new Promise((r) => setTimeout(r, 2000));
async function main() {
  const [mode, operation, resultPath] = process.argv.slice(2);
  if (
    !["prepare", "send", "status"].includes(mode) ||
    !["initialize", "rewards", "schedule"].includes(operation) ||
    process.argv.length !== (mode === "send" ? 5 : 4)
  )
    throw Error("Use prepare|status OP or send OP RESULT_PATH");
  const meta = read(".dev/offline-launch-current.json"),
    dir = meta.directory;
  const p: Policy = read(`${dir}/launch-policy.json`);
  validatePolicy(p);
  if (
    hash(readFileSync("target/deploy/cat_shit_mining.so")) !== meta.binarySha256
  )
    throw Error("Local binary changed");
  const c = new Connection(p.rpc, "finalized"),
    a = addresses(p),
    coder = new BorshAccountsCoder(IDL);
  eq(await c.getGenesisHash(), p.genesis);
  const keys = [
    new PublicKey(p.nonceAccount),
    PROGRAM_ID,
    programData,
    a.mint,
    a.config,
    a.faucetVault,
    a.adminTokens,
    a.rewards,
    a.rewardVault,
  ];
  const snapshot = async () =>
    c.getMultipleAccountsInfoAndContext(keys, "finalized");
  function common(infos: (AccountInfo<Buffer> | null)[]) {
    const [n, prog, pd] = infos;
    if (
      !n ||
      n.executable ||
      !n.owner.equals(SystemProgram.programId) ||
      n.data.length !== 80 ||
      n.data.readUInt32LE(0) !== 1 ||
      n.data.readUInt32LE(4) !== 1
    )
      throw Error("Invalid nonce");
    const nonce = NonceAccount.fromAccountData(n.data);
    eq(nonce.authorizedPubkey, p.admin);
    if (
      !prog?.executable ||
      !prog.owner.equals(loader) ||
      prog.data.readUInt32LE(0) !== 2 ||
      !prog.data.subarray(4).equals(programData.toBuffer()) ||
      !pd ||
      !pd.owner.equals(loader) ||
      pd.executable ||
      pd.data.readUInt32LE(0) !== 3 ||
      pd.data[12] !== 1 ||
      !pd.data.subarray(13, 45).equals(a.admin.toBuffer())
    )
      throw Error("Upgrade authority/program mismatch");
    const elf = readFileSync("target/deploy/cat_shit_mining.so");
    if (
      !pd.data.subarray(45, 45 + elf.length).equals(elf) ||
      pd.data.subarray(45 + elf.length).some((v) => v !== 0)
    )
      throw Error("On-chain executable mismatch");
    return nonce.nonce;
  }
  function check(infos: (AccountInfo<Buffer> | null)[], stage: number) {
    common(infos);
    if (stage === 0) {
      if (infos.slice(3).some(Boolean))
        throw Error("Fresh deployment required");
      return;
    }
    const mint = unpackMint(a.mint, infos[3]);
    eq(mint.supply, 100_000_000_000_000n);
    eq(mint.decimals, 6);
    if (mint.mintAuthority || mint.freezeAuthority || !mint.isInitialized)
      throw Error("Mint authorities not revoked");
    const decode = (i: number, name: string) => {
      const x = infos[i];
      if (!x || !x.owner.equals(PROGRAM_ID) || x.executable)
        throw Error("Invalid program account");
      return coder.decode(name, x.data);
    };
    const config = decode(4, "config");
    eq(config.admin, p.admin);
    eq(config.tokenMint, p.mint);
    eq(config.launchMode, true);
    for (const field of ["faucetDistributed", "ppCutoff", "totalAllocated"])
      eq(config[field], 0);
    eq(config.minLockAmount, 1_000_000_000);
    eq(config.unlockCooldownSeconds, 86400);
    eq(config.activatedAt, stage === 3 ? p.schedule.miningStartsAt : 0);
    eq(config.faucetOpensAt, stage === 3 ? p.schedule.faucetOpensAt : 0);
    eq(config.waveTwoAt, stage === 3 ? p.schedule.waveTwoAt : 0);
    eq(config.faucetIssuer, stage === 3 ? p.issuer : SystemProgram.programId);
    const token = (i: number, owner: PublicKey, amount: bigint) => {
      const x = unpackAccount(keys[i], infos[i]);
      eq(x.mint, p.mint);
      eq(x.owner, owner);
      eq(x.amount, amount);
      if (x.delegate || x.closeAuthority || x.isFrozen || !x.isInitialized)
        throw Error("Unexpected token authority/state");
    };
    token(5, a.config, 1_000_000_000_000n);
    token(6, a.admin, stage === 1 ? 99_000_000_000_000n : 0n);
    if (stage === 1) {
      if (infos[7] || infos[8]) throw Error("Unexpected reward accounts");
      return;
    }
    const rewards = decode(7, "rewardConfig");
    eq(rewards.tokenMint, p.mint);
    eq(rewards.publisher, p.publisher);
    eq(rewards.duration, 86400);
    eq(rewards.emission, 250_000_000_000n);
    eq(rewards.nextCycle, 0);
    eq(rewards.committedUnclaimed, 0);
    eq(rewards.genesis, stage === 3 ? p.schedule.miningStartsAt : 0);
    token(8, a.rewards, 99_000_000_000_000n);
  }
  const stage = ["initialize", "rewards", "schedule"].indexOf(operation),
    requestPath = `${dir}/request.${operation}.json`,
    attemptPath = `${dir}/attempt.${operation}.json`;
  const status = async () => {
    if (!existsSync(attemptPath)) throw Error("No submission attempt");
    const attempt = read(attemptPath),
      s = (
        await c.getSignatureStatuses([attempt.signature], {
          searchTransactionHistory: true,
        })
      ).value[0];
    if (s?.confirmationStatus !== "finalized") {
      console.log("PENDING_OR_UNKNOWN_DO_NOT_RESIGN", attempt.signature);
      return false;
    }
    if (s.err)
      throw Error(
        "Finalized transaction failed; inspect nonce before any replacement",
      );
    const after = await snapshot();
    check(after.value, stage + 1);
    if (common(after.value) === read(requestPath).nonceValue)
      throw Error("Nonce did not advance");
    const report = {
      status: "FINALIZED_LOCAL_LAUNCH_STEP",
      operation,
      signature: attempt.signature,
      slot: s.slot,
      nonceAdvanced: true,
      invariantsVerified: true,
    };
    if (!existsSync(`${dir}/report.${operation}.json`))
      save(`${dir}/report.${operation}.json`, report);
    console.log(JSON.stringify(report, null, 2));
    return true;
  };
  if (mode === "status" || (mode === "send" && existsSync(attemptPath))) {
    await status();
    return;
  }
  const before = await snapshot();
  check(before.value, stage);
  const nonceValue = common(before.value);
  if (operation === "schedule") {
    const now = await c.getBlockTime(before.context.slot);
    if (now === null || p.schedule.faucetOpensAt < now + 300)
      throw Error(
        "Schedule has less than five minutes lead; new reviewed policy required",
      );
  }
  const tx = build(p, operation as Operation, nonceValue);
  const request: Request = {
    operation: operation as Operation,
    nonceValue,
    messageBase64: tx.serializeMessage().toString("base64"),
    messageSha256: hash(tx.serializeMessage()),
  };
  if (mode === "send") {
    const original = read(requestPath),
      result = read(resultPath);
    for (const [k, v] of Object.entries(request))
      if (original[k] !== v || result[k] !== v)
        throw Error("Request/nonce changed");
    inspect(p, result);
    eq(result.admin, p.admin);
    const sig = Buffer.from(result.adminSignature, "base64");
    if (sig.length !== 64 || sig.toString("base64") !== result.adminSignature)
      throw Error("Invalid signature encoding");
    tx.addSignature(a.admin, sig);
    if (operation === "initialize") {
      const mint = Keypair.fromSecretKey(
        Uint8Array.from(read(`${dir}/TEST-mint.json`)),
      );
      eq(mint.publicKey, p.mint);
      tx.partialSign(mint);
    }
    if (!tx.verifySignatures()) throw Error("Bad returned signatures");
  }
  const raw = tx.serialize({
    requireAllSignatures: mode === "send",
    verifySignatures: mode === "send",
  });
  const simulation = await fetch(p.rpc, {
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
  if (simulation.error || simulation.result.value.err)
    throw Error(
      `Simulation failed: ${JSON.stringify(simulation.error ?? simulation.result.value)}`,
    );
  const simulated = simulation.result.value.accounts.map(
    (v: { owner: string; data: string[] } | null) =>
      v
        ? {
            ...v,
            owner: new PublicKey(v.owner),
            data: Buffer.from(v.data[0], "base64"),
          }
        : null,
  );
  check(simulated, stage + 1);
  if (common(simulated) === nonceValue)
    throw Error("Simulation did not advance nonce");
  if (mode === "prepare") {
    save(requestPath, request);
    console.log("PREPARED", requestPath, "bytes", raw.length);
    return;
  }
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt("0x" + tx.signature!.toString("hex")),
    signature = "";
  while (value) {
    signature = alphabet[Number(value % 58n)] + signature;
    value /= 58n;
  }
  for (const byte of tx.signature!) {
    if (byte) break;
    signature = "1" + signature;
  }
  // Persist before any network send: unknown outcomes are status-only, never automatic resend.
  save(attemptPath, {
    signature,
    operation,
    messageSha256: request.messageSha256,
  });
  await c.sendRawTransaction(raw, {
    skipPreflight: false,
    preflightCommitment: "finalized",
    maxRetries: 0,
    minContextSlot: before.context.slot,
  });
  for (let i = 0; i < 30; i++) {
    await wait();
    if (await status()) return;
  }
  throw Error("Finality not observed; use status, do not sign a replacement");
}
main().catch((e) => {
  console.error(String(e));
  process.exitCode = 1;
});
