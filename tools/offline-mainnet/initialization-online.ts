// Mainnet-only read/verify/submit adapter. No private-key loading or activation.
import {
  PublicKey,
  NonceAccount,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  type AccountInfo,
} from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, unpackMint, unpackAccount } from "@solana/spl-token";
import {
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  readFileSync,
} from "node:fs";
import { IDL } from "../../packages/shared/src/client";
import { MAINNET_GENESIS, digest } from "./deployment-policy";
import {
  initializationAddresses,
  validateInitializationPins,
  initializationPinsDigest,
  buildInitialization,
  reviewInitialization,
  type InitializationPins,
  type InitializationRequest,
} from "./initialization-policy";
import {
  verifyInitializationSignature,
  type InitializationSignature,
} from "./initialization-signing";
import { freshUploadFee } from "./upload";
import type { SubmitRpc } from "./submission";
export type InitRpc = SubmitRpc;
export type InitLimits = {
  maxFeeLamports: number;
  maxAdminDebitLamports: number;
  adminReserveLamports: number;
};
export type InitSnapshot = {
  genesis: string;
  slot: number;
  addresses: string[];
  accounts: (AccountInfo<Buffer> | null)[];
};
export type InitPrepared = {
  schema: "yamc-initialization-review-v1";
  pinsSha256: string;
  request: InitializationRequest;
  slot: number;
  feeLamports: number;
  adminDebitLamports: number;
  adminBalanceLamports: number;
  broadcastAuthorization: false;
};
const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const coder = new BorshAccountsCoder(IDL);
const integer = (v: number) => Number.isSafeInteger(v) && v >= 0;
export function initStateKeys(p: InitializationPins) {
  const a = initializationAddresses(p);
  return [
    new PublicKey(p.deployment.nonceAccount),
    a.program,
    a.programData,
    new PublicKey(p.deployment.buffer),
    a.tokenMint,
    a.config,
    a.faucetVault,
    a.adminTokens,
    a.rewards,
    a.rewardVault,
    a.admin,
  ];
}
export async function readInitSnapshot(
  rpc: InitRpc,
  p: InitializationPins,
  minimumSlot = 1,
): Promise<InitSnapshot> {
  validateInitializationPins(p);
  if (!integer(minimumSlot)) throw Error("Invalid minimum slot");
  const genesis = await rpc.getGenesisHash();
  if (genesis !== MAINNET_GENESIS) throw Error("Wrong network");
  const keys = initStateKeys(p);
  const s = await rpc.getMultipleAccountsInfoAndContext(keys, {
    commitment: "finalized",
    minContextSlot: minimumSlot,
  });
  if (
    !integer(s.context.slot) ||
    s.context.slot < Math.max(1, minimumSlot) ||
    s.value.length !== keys.length
  )
    throw Error("Stale/malformed snapshot");
  return {
    genesis,
    slot: s.context.slot,
    addresses: keys.map((k) => k.toBase58()),
    accounts: s.value,
  };
}
export function inspectInitState(
  p: InitializationPins,
  elf: Buffer,
  s: InitSnapshot,
  stage: 0 | 1 | 2,
) {
  validateInitializationPins(p);
  if (
    ![0, 1, 2].includes(stage) ||
    s.genesis !== MAINNET_GENESIS ||
    !integer(s.slot) ||
    s.slot < 1 ||
    JSON.stringify(s.addresses) !==
      JSON.stringify(initStateKeys(p).map((k) => k.toBase58())) ||
    s.accounts.length !== 11
  )
    throw Error("Snapshot identity mismatch");
  if (
    elf.length !== p.deployment.binarySize ||
    digest(elf) !== p.deployment.binarySha256
  )
    throw Error("ELF mismatch");
  const a = initializationAddresses(p);
  function account(
    i: number,
    owner: PublicKey,
    size: number,
    executable = false,
  ) {
    const x = s.accounts[i];
    if (
      !x ||
      !x.owner.equals(owner) ||
      x.data.length !== size ||
      x.executable !== executable ||
      !integer(x.lamports) ||
      x.lamports === 0
    )
      throw Error("Account shape mismatch");
    return x;
  }
  const n = account(0, SystemProgram.programId, 80);
  if (n.data.readUInt32LE(0) !== 1 || n.data.readUInt32LE(4) !== 1)
    throw Error("Invalid nonce");
  const nonce = NonceAccount.fromAccountData(n.data);
  if (nonce.authorizedPubkey.toBase58() !== p.deployment.admin)
    throw Error("Nonce authority mismatch");
  const program = account(1, loader, 36, true),
    pd = account(2, loader, 45 + elf.length);
  if (
    program.data.readUInt32LE(0) !== 2 ||
    !program.data.subarray(4).equals(a.programData.toBuffer()) ||
    pd.data.readUInt32LE(0) !== 3 ||
    pd.data.readBigUInt64LE(4) > BigInt(s.slot) ||
    pd.data[12] !== 1 ||
    !pd.data.subarray(13, 45).equals(a.admin.toBuffer()) ||
    !pd.data.subarray(45).equals(elf) ||
    s.accounts[3] !== null
  )
    throw Error("Deployed program/authority/buffer mismatch");
  const admin = s.accounts[10];
  if (
    admin &&
    (!admin.owner.equals(SystemProgram.programId) ||
      admin.executable ||
      admin.data.length !== 0 ||
      !integer(admin.lamports))
  )
    throw Error("Admin wallet mismatch");
  if (stage === 0) {
    if (s.accounts.slice(4, 10).some(Boolean))
      throw Error("Expected fresh initialization");
    return nonce.nonce;
  }
  const mint = unpackMint(a.tokenMint, account(4, TOKEN_PROGRAM_ID, 82));
  if (
    !mint.isInitialized ||
    mint.decimals !== 6 ||
    mint.supply !== 100000000000000n ||
    mint.mintAuthority ||
    mint.freezeAuthority
  )
    throw Error("Mint supply/authority mismatch");
  const config = coder.decode("config", account(5, a.program, 170).data);
  function eq(actual: unknown, expected: unknown) {
    if (String(actual) !== String(expected))
      throw Error("Config/rewards value mismatch");
  }
  eq(config.admin, p.deployment.admin);
  eq(config.tokenMint, p.mint);
  eq(config.launchMode, true);
  eq(config.minLockAmount, 1000000000);
  eq(config.unlockCooldownSeconds, 86400);
  for (const field of [
    "faucetDistributed",
    "activatedAt",
    "ppCutoff",
    "totalAllocated",
    "faucetOpensAt",
    "waveTwoAt",
  ])
    eq(config[field], 0);
  eq(config.faucetIssuer, SystemProgram.programId);
  function token(i: number, key: PublicKey, owner: PublicKey, amount: bigint) {
    const t = unpackAccount(key, account(i, TOKEN_PROGRAM_ID, 165));
    if (
      !t.mint.equals(a.tokenMint) ||
      !t.owner.equals(owner) ||
      t.amount !== amount ||
      !t.isInitialized ||
      t.isFrozen ||
      t.delegate ||
      t.closeAuthority ||
      t.isNative ||
      t.delegatedAmount !== 0n
    )
      throw Error("Token account mismatch");
  }
  token(6, a.faucetVault, a.config, 1000000000000n);
  token(7, a.adminTokens, a.admin, stage === 1 ? 99000000000000n : 0n);
  if (stage === 1) {
    if (s.accounts[8] || s.accounts[9])
      throw Error("Premature rewards accounts");
    return nonce.nonce;
  }
  const rewards = coder.decode("rewardConfig", account(8, a.program, 113).data);
  eq(rewards.tokenMint, p.mint);
  eq(rewards.publisher, p.publisher);
  eq(rewards.duration, 86400);
  eq(rewards.emission, 250000000000n);
  for (const field of ["genesis", "nextCycle", "committedUnclaimed"])
    eq(rewards[field], 0);
  token(9, a.rewardVault, a.rewards, 99000000000000n);
  return nonce.nonce;
}
export async function prepareInitialization(
  rpc: InitRpc,
  p: InitializationPins,
  elf: Buffer,
  operation: InitializationRequest["operation"],
  limits: InitLimits,
  minimumSlot = 1,
): Promise<InitPrepared> {
  if (
    ![
      limits.maxFeeLamports,
      limits.maxAdminDebitLamports,
      limits.adminReserveLamports,
    ].every(integer)
  )
    throw Error("Invalid limits");
  const s = await readInitSnapshot(rpc, p, minimumSlot),
    nonceValue = inspectInitState(
      p,
      elf,
      s,
      operation === "initialize" ? 0 : 1,
    );
  const rents = await Promise.all(
    [82, 165, 170, 113].map((size) =>
      rpc.getMinimumBalanceForRentExemption(size, "finalized"),
    ),
  );
  if (
    !rents.every((n) => integer(n) && n > 0) ||
    rents[0] !== p.mintRentLamports
  )
    throw Error("Rent changed");
  const tx = buildInitialization(p, operation, nonceValue);
  const fee = await freshUploadFee(
    rpc,
    tx.compileMessage(),
    s.slot,
    limits.maxFeeLamports,
  );
  const debit =
    fee.value +
    (operation === "initialize"
      ? rents[0] + 2 * rents[1] + rents[2]
      : rents[1] + rents[3]);
  if (!integer(debit) || debit > limits.maxAdminDebitLamports)
    throw Error("Admin debit cap exceeded");
  const balance = await rpc.getBalanceAndContext(
    new PublicKey(p.deployment.admin),
    { commitment: "finalized", minContextSlot: fee.context.slot },
  );
  if (
    balance.context.slot < fee.context.slot ||
    !integer(balance.value) ||
    !integer(debit + limits.adminReserveLamports) ||
    balance.value < debit + limits.adminReserveLamports
  )
    throw Error("Admin balance insufficient/stale");
  const bytes = tx.serializeMessage();
  return {
    schema: "yamc-initialization-review-v1",
    pinsSha256: initializationPinsDigest(p),
    request: {
      operation,
      nonceValue,
      messageBase64: bytes.toString("base64"),
      messageSha256: digest(bytes),
    },
    slot: s.slot,
    feeLamports: fee.value,
    adminDebitLamports: debit,
    adminBalanceLamports: balance.value,
    broadcastAuthorization: false,
  };
}
function inspectPrepared(
  p: InitializationPins,
  elf: Buffer,
  prepared: InitPrepared,
) {
  if (
    prepared.schema !== "yamc-initialization-review-v1" ||
    prepared.pinsSha256 !== initializationPinsDigest(p) ||
    prepared.broadcastAuthorization !== false ||
    !integer(prepared.slot) ||
    prepared.slot < 1
  )
    throw Error("Prepared identity mismatch");
  reviewInitialization(p, prepared.request, elf);
}
async function fresh(
  rpc: InitRpc,
  p: InitializationPins,
  elf: Buffer,
  prepared: InitPrepared,
  limits: InitLimits,
  minSlot: number,
) {
  inspectPrepared(p, elf, prepared);
  const current = await prepareInitialization(
    rpc,
    p,
    elf,
    prepared.request.operation,
    limits,
    minSlot,
  );
  if (
    current.request.messageBase64 !== prepared.request.messageBase64 ||
    current.request.messageSha256 !== prepared.request.messageSha256
  )
    throw Error("State changed since signing");
  return current;
}
export async function assembleInitialization(
  rpc: InitRpc,
  p: InitializationPins,
  elf: Buffer,
  prepared: InitPrepared,
  results: InitializationSignature[],
  limits: InitLimits,
) {
  inspectPrepared(p, elf, prepared);
  const roles =
    prepared.request.operation === "initialize" ? ["admin", "mint"] : ["admin"];
  if (
    results.length !== roles.length ||
    new Set(results.map((r) => r.role)).size !== roles.length ||
    results.some((r) => !roles.includes(r.role))
  )
    throw Error("Missing/duplicate/wrong offline roles");
  for (const r of results)
    verifyInitializationSignature(p, prepared.request, elf, r);
  await fresh(rpc, p, elf, prepared, limits, prepared.slot);
  const tx = buildInitialization(
    p,
    prepared.request.operation,
    prepared.request.nonceValue,
  );
  for (const r of results)
    tx.addSignature(
      new PublicKey(r.signer),
      Buffer.from(r.signatureBase64, "base64"),
    );
  return tx.serialize();
}
export type InitAttempt = {
  schema: "yamc-initialization-attempt-v1";
  pinsSha256: string;
  messageSha256: string;
  wireSha256: string;
  signature: string;
  operation: InitializationRequest["operation"];
  nonce: string;
  preparedSlot: number;
};
export interface InitStore {
  create(record: InitAttempt): void;
  read(): InitAttempt;
}
export function initializationStore(file: string): InitStore {
  return {
    create(r) {
      const fd = openSync(file, "wx", 0o600);
      try {
        writeFileSync(fd, JSON.stringify(r, null, 2) + "\n");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    },
    read() {
      return JSON.parse(readFileSync(file, "utf8"));
    },
  };
}
function signed(
  p: InitializationPins,
  elf: Buffer,
  prepared: InitPrepared,
  raw: Buffer,
): InitAttempt {
  inspectPrepared(p, elf, prepared);
  const tx = Transaction.from(raw);
  if (
    raw.length > 1232 ||
    !tx.verifySignatures() ||
    !tx.serialize().equals(raw) ||
    !tx
      .serializeMessage()
      .equals(Buffer.from(prepared.request.messageBase64, "base64")) ||
    !tx.signature
  )
    throw Error("Signed message mismatch");
  let n = BigInt("0x" + tx.signature.toString("hex")),
    signature = "";
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  while (n) {
    signature = alphabet[Number(n % 58n)] + signature;
    n /= 58n;
  }
  for (const b of tx.signature) {
    if (b) break;
    signature = "1" + signature;
  }
  return {
    schema: "yamc-initialization-attempt-v1",
    pinsSha256: prepared.pinsSha256,
    messageSha256: prepared.request.messageSha256,
    wireSha256: digest(raw),
    signature,
    operation: prepared.request.operation,
    nonce: prepared.request.nonceValue,
    preparedSlot: prepared.slot,
  };
}
export async function submitInitializationOnce(
  rpc: InitRpc,
  p: InitializationPins,
  elf: Buffer,
  prepared: InitPrepared,
  raw: Buffer,
  limits: InitLimits,
  store: InitStore,
  approval: { messageSha256: string; pinsSha256: string },
) {
  const attempt = signed(p, elf, prepared, raw);
  if (
    approval.messageSha256 !== attempt.messageSha256 ||
    approval.pinsSha256 !== attempt.pinsSha256
  )
    throw Error("Explicit send approval required");
  const before = await fresh(rpc, p, elf, prepared, limits, prepared.slot);
  const sim = await rpc.simulateTransaction(
    VersionedTransaction.deserialize(raw),
    {
      sigVerify: true,
      replaceRecentBlockhash: false,
      commitment: "finalized",
      minContextSlot: before.slot,
    },
  );
  if (sim.value.err !== null || sim.context.slot < before.slot)
    throw Error("Signed simulation failed/stale");
  const checked = await fresh(rpc, p, elf, prepared, limits, sim.context.slot);
  store.create(attempt);
  try {
    const sig = await rpc.sendRawTransaction(raw, {
      skipPreflight: false,
      preflightCommitment: "finalized",
      minContextSlot: checked.slot,
      maxRetries: 0,
    });
    return {
      status:
        sig === attempt.signature
          ? "SUBMITTED_NOT_FINALIZED"
          : "UNKNOWN_DO_NOT_RESEND",
      signature: attempt.signature,
    };
  } catch {
    return { status: "UNKNOWN_DO_NOT_RESEND", signature: attempt.signature };
  }
}
export async function reconcileInitialization(
  rpc: InitRpc,
  p: InitializationPins,
  elf: Buffer,
  prepared: InitPrepared,
  raw: Buffer,
  store: InitStore,
) {
  const expected = signed(p, elf, prepared, raw),
    saved = store.read();
  for (const k of Object.keys(expected) as (keyof InitAttempt)[])
    if (saved[k] !== expected[k]) throw Error("Journal mismatch");
  let snapshot = await readInitSnapshot(rpc, p, prepared.slot);
  const status = (
    await rpc.getSignatureStatuses([expected.signature], {
      searchTransactionHistory: true,
    })
  ).value[0];
  if (status?.confirmationStatus !== "finalized")
    return { status: "PENDING_OR_UNKNOWN_DO_NOT_RESEND" };
  if (status.err !== null)
    return {
      status: "FINALIZED_FAILURE_REVIEW_NONCE",
      signature: expected.signature,
    };
  if (snapshot.slot < status.slot)
    snapshot = await readInitSnapshot(rpc, p, status.slot);
  const nonce = inspectInitState(
    p,
    elf,
    snapshot,
    expected.operation === "initialize" ? 1 : 2,
  );
  if (nonce === expected.nonce) throw Error("Nonce not consumed");
  return {
    status: "FINALIZED_AND_INITIALIZATION_STATE_VERIFIED",
    signature: expected.signature,
    slot: status.slot,
  };
}
