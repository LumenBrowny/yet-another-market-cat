// Ordered, journalled preparation. No automatic retries or private-key paths.
import {
  Keypair,
  NonceAccount,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { digest, validatePins, type DeploymentPins } from "./deployment-policy";
import { pinsDigest } from "./signing";
import { readDeploymentSnapshot } from "./deployment-state";
import type { ReviewRpc } from "./online-review";

const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
export type UploadPlan = {
  schema: "yamc-upload-plan-v1";
  pinsSha256: string;
  nonceRent: number;
  bufferRent: number;
  maxFeeLamports: number;
  maxTotalDebitLamports: number;
  payerReserveLamports: number;
};
export type UploadRpc = ReviewRpc &
  Pick<
    Connection,
    | "getLatestBlockhashAndContext"
    | "simulateTransaction"
    | "sendRawTransaction"
    | "getSignatureStatuses"
  >;
export type UploadRecord = {
  planSha256: string;
  step: number;
  wireBase64: string;
  feeLamports: number;
  lastValidBlockHeight: number;
  observedSlot: number;
};
export interface UploadJournal {
  read(step: number): UploadRecord | null;
  create(step: number, record: UploadRecord): void;
}
export function fileUploadJournal(directory: string): UploadJournal {
  const file = (step: number) => join(directory, `step-${step}.json`);
  return {
    read(step) {
      return existsSync(file(step))
        ? JSON.parse(readFileSync(file(step), "utf8"))
        : null;
    },
    create(step, record) {
      const fd = openSync(file(step), "wx", 0o600);
      try {
        writeFileSync(fd, JSON.stringify(record, null, 2));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    },
  };
}
export function uploadPlanDigest(plan: UploadPlan) {
  return digest(
    Buffer.from(
      JSON.stringify([
        plan.schema,
        plan.pinsSha256,
        plan.nonceRent,
        plan.bufferRent,
        plan.maxFeeLamports,
        plan.maxTotalDebitLamports,
        plan.payerReserveLamports,
      ]),
    ),
  );
}
export function uploadStepCount(elf: Buffer) {
  return 2 + Math.ceil(elf.length / 900);
}
// RPC backends may lag the node that supplied the finalized blockhash.
// Retry only read-only quotes for the SAME unsigned message, never send/sign.
export async function freshUploadFee(
  rpc: Pick<UploadRpc, "getFeeForMessage">,
  message: ReturnType<Transaction["compileMessage"]>,
  minimumSlot: number,
  cap: number,
) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const quote = await rpc.getFeeForMessage(message, "finalized");
    if (
      !Number.isSafeInteger(quote.context.slot) ||
      quote.context.slot < 0 ||
      (quote.value !== null &&
        (!Number.isSafeInteger(quote.value) ||
          quote.value < 0 ||
          quote.value > cap))
    )
      throw Error("Fee limit or invalid quote");
    if (quote.context.slot >= minimumSlot && quote.value !== null)
      return quote as typeof quote & { value: number };
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw Error("Fee quote unavailable or stale after read retries");
}
function validate(p: DeploymentPins, elf: Buffer, plan: UploadPlan) {
  validatePins(p);
  if (
    elf.length !== p.binarySize ||
    digest(elf) !== p.binarySha256 ||
    plan.schema !== "yamc-upload-plan-v1" ||
    plan.pinsSha256 !== pinsDigest(p) ||
    ![
      plan.nonceRent,
      plan.bufferRent,
      plan.maxFeeLamports,
      plan.maxTotalDebitLamports,
      plan.payerReserveLamports,
    ].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    !plan.nonceRent ||
    !plan.bufferRent ||
    !plan.maxFeeLamports
  )
    throw Error("Invalid upload plan");
  const worst =
    plan.nonceRent +
    plan.bufferRent +
    uploadStepCount(elf) * plan.maxFeeLamports;
  if (!Number.isSafeInteger(worst) || worst > plan.maxTotalDebitLamports)
    throw Error("Upload budget exceeded");
}
export function uploadTransaction(
  p: DeploymentPins,
  elf: Buffer,
  plan: UploadPlan,
  step: number,
  blockhash: string,
) {
  validate(p, elf, plan);
  if (!Number.isInteger(step) || step < 0 || step >= uploadStepCount(elf))
    throw Error("Invalid step");
  const payer = new PublicKey(p.payer),
    buffer = new PublicKey(p.buffer),
    authority = new PublicKey(p.bufferAuthority);
  const tx = new Transaction({ feePayer: payer, recentBlockhash: blockhash });
  if (step === 0)
    tx.add(
      SystemProgram.createNonceAccount({
        fromPubkey: payer,
        noncePubkey: new PublicKey(p.nonceAccount),
        authorizedPubkey: new PublicKey(p.admin),
        lamports: plan.nonceRent,
      }),
    );
  else if (step === 1)
    tx.add(
      SystemProgram.createAccount({
        fromPubkey: payer,
        newAccountPubkey: buffer,
        space: 37 + elf.length,
        lamports: plan.bufferRent,
        programId: loader,
      }),
      new TransactionInstruction({
        programId: loader,
        keys: [
          { pubkey: buffer, isSigner: false, isWritable: true },
          { pubkey: authority, isSigner: false, isWritable: false },
        ],
        data: Buffer.alloc(4),
      }),
    );
  else {
    const offset = (step - 2) * 900,
      chunk = elf.subarray(offset, offset + 900),
      data = Buffer.alloc(16 + chunk.length);
    data.writeUInt32LE(1);
    data.writeUInt32LE(offset, 4);
    data.writeBigUInt64LE(BigInt(chunk.length), 8);
    chunk.copy(data, 16);
    tx.add(
      new TransactionInstruction({
        programId: loader,
        keys: [
          { pubkey: buffer, isSigner: false, isWritable: true },
          { pubkey: authority, isSigner: true, isWritable: false },
        ],
        data,
      }),
    );
  }
  return tx;
}
async function state(
  rpc: UploadRpc,
  p: DeploymentPins,
  elf: Buffer,
  plan: UploadPlan,
  completed: number,
  minSlot: number,
) {
  const s = await readDeploymentSnapshot(rpc, p, Math.max(1, minSlot));
  if (!Number.isSafeInteger(s.slot) || s.slot < Math.max(1, minSlot))
    throw Error("Invalid or stale upload snapshot");
  if (s.accounts[2] || s.accounts[3])
    throw Error("Program or ProgramData already exists");
  const [nonce, buffer] = s.accounts;
  if (!completed) {
    if (nonce || buffer) throw Error("Accounts already exist");
    return s.slot;
  }
  if (
    !nonce ||
    nonce.owner !== SystemProgram.programId.toBase58() ||
    nonce.executable ||
    nonce.data.length !== 80 ||
    nonce.lamports < plan.nonceRent ||
    nonce.data.readUInt32LE(0) !== 1 ||
    nonce.data.readUInt32LE(4) !== 1 ||
    NonceAccount.fromAccountData(nonce.data).authorizedPubkey.toBase58() !==
      p.admin
  )
    throw Error("Nonce mismatch");
  if (completed === 1) {
    if (buffer) throw Error("Buffer already exists");
    return s.slot;
  }
  if (
    !buffer ||
    buffer.owner !== loader.toBase58() ||
    buffer.executable ||
    buffer.lamports < plan.bufferRent ||
    buffer.data.length !== 37 + elf.length ||
    buffer.data.readUInt32LE(0) !== 1 ||
    buffer.data[4] !== 1 ||
    !buffer.data
      .subarray(5, 37)
      .equals(new PublicKey(p.bufferAuthority).toBuffer())
  )
    throw Error("Buffer mismatch");
  const written = Math.min((completed - 2) * 900, elf.length);
  if (
    !buffer.data.subarray(37, 37 + written).equals(elf.subarray(0, written)) ||
    buffer.data.subarray(37 + written).some((b) => b !== 0)
  )
    throw Error("Buffer bytes mismatch");
  return s.slot;
}
function signature(tx: Transaction) {
  let n = BigInt("0x" + tx.signature!.toString("hex")),
    out = "";
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  while (n) {
    out = alphabet[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of tx.signature!) {
    if (b) break;
    out = "1" + out;
  }
  return out;
}
/** One invocation reconciles existing steps and submits AT MOST one new step.
 * Unknown/failed attempts stop progress. No expired-blockhash replacement. */
export async function advanceUpload(
  rpc: UploadRpc,
  p: DeploymentPins,
  elf: Buffer,
  plan: UploadPlan,
  journal: UploadJournal,
  approval: string,
  loadKey: (
    role: "payer" | "nonceAccount" | "buffer" | "bufferAuthority",
  ) => unknown,
) {
  validate(p, elf, plan);
  const planHash = uploadPlanDigest(plan);
  if (approval !== planHash) throw Error("Upload approval required");
  // Guard the network before querying history or reading keys.
  await readDeploymentSnapshot(rpc, p);
  let minSlot = 1,
    totalFees = 0,
    step = 0;
  let statuses: Awaited<
    ReturnType<UploadRpc["getSignatureStatuses"]>
  >["value"] = [];
  for (; step < uploadStepCount(elf); step++) {
    const record = journal.read(step);
    if (!record) break;
    const raw = Buffer.from(record.wireBase64, "base64"),
      tx = Transaction.from(raw);
    if (
      record.planSha256 !== planHash ||
      record.step !== step ||
      !Number.isSafeInteger(record.feeLamports) ||
      record.feeLamports < 0 ||
      record.feeLamports > plan.maxFeeLamports ||
      !Number.isSafeInteger(record.observedSlot) ||
      record.observedSlot < minSlot ||
      !tx.verifySignatures() ||
      raw.length > 1232 ||
      !raw.equals(tx.serialize()) ||
      !tx
        .serializeMessage()
        .equals(
          uploadTransaction(
            p,
            elf,
            plan,
            step,
            tx.recentBlockhash!,
          ).serializeMessage(),
        )
    )
      throw Error("Journal mismatch");
    if (step % 256 === 0) {
      const signatures: string[] = [];
      for (let i = step; i < Math.min(step + 256, uploadStepCount(elf)); i++) {
        const entry = journal.read(i);
        if (!entry) break;
        signatures.push(
          signature(Transaction.from(Buffer.from(entry.wireBase64, "base64"))),
        );
      }
      statuses = (
        await rpc.getSignatureStatuses(signatures, {
          searchTransactionHistory: true,
        })
      ).value;
    }
    const status = statuses[step % 256];
    if (status?.confirmationStatus !== "finalized")
      return { status: "PENDING_OR_UNKNOWN_DO_NOT_RESEND", step };
    if (status.err !== null)
      return { status: "FINALIZED_FAILURE_MANUAL_REVIEW", step };
    minSlot = Math.max(record.observedSlot, status.slot, minSlot);
    totalFees += record.feeLamports;
  }
  // Gaps indicate an incomplete/corrupt journal, not permission to start over.
  for (let i = step + 1; i < uploadStepCount(elf); i++)
    if (journal.read(i)) throw Error("Journal gap");
  const slot = await state(rpc, p, elf, plan, step, minSlot);
  if (step === uploadStepCount(elf))
    return { status: "UPLOAD_FINALIZED_AND_VERIFIED", step, totalFees };
  const [nonceRent, bufferRent] = await Promise.all([
    rpc.getMinimumBalanceForRentExemption(80),
    rpc.getMinimumBalanceForRentExemption(37 + elf.length),
  ]);
  if (nonceRent !== plan.nonceRent || bufferRent !== plan.bufferRent)
    throw Error("Rent changed");
  const latest = await rpc.getLatestBlockhashAndContext({
    commitment: "finalized",
    minContextSlot: slot,
  });
  if (latest.context.slot < slot) throw Error("Stale blockhash");
  const tx = uploadTransaction(p, elf, plan, step, latest.value.blockhash);
  const fee = await freshUploadFee(
    rpc,
    tx.compileMessage(),
    latest.context.slot,
    plan.maxFeeLamports,
  );
  const balance = await rpc.getBalanceAndContext(new PublicKey(p.payer), {
    commitment: "finalized",
    minContextSlot: fee.context.slot,
  });
  const remaining =
    (step === 0 ? plan.nonceRent : 0) +
    (step <= 1 ? plan.bufferRent : 0) +
    (uploadStepCount(elf) - step) * plan.maxFeeLamports +
    plan.payerReserveLamports;
  if (
    !Number.isSafeInteger(remaining) ||
    balance.context.slot < fee.context.slot ||
    balance.value < remaining
  )
    throw Error("Insufficient remaining budget");
  const roles = [
    "payer",
    step === 0 ? "nonceAccount" : step === 1 ? "buffer" : "bufferAuthority",
  ] as const;
  for (const role of roles) {
    const secret = loadKey(role);
    if (
      !Array.isArray(secret) ||
      secret.length !== 64 ||
      !secret.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    )
      throw Error("Invalid key");
    const key = Keypair.fromSecretKey(Uint8Array.from(secret));
    if (key.publicKey.toBase58() !== p[role]) throw Error("Wrong role");
    tx.partialSign(key);
  }
  const raw = tx.serialize();
  if (raw.length > 1232) throw Error("Packet too large");
  const simulation = await rpc.simulateTransaction(
    VersionedTransaction.deserialize(raw),
    {
      commitment: "finalized",
      minContextSlot: balance.context.slot,
      sigVerify: true,
      replaceRecentBlockhash: false,
    },
  );
  if (
    simulation.context.slot < balance.context.slot ||
    simulation.value.err !== null
  )
    throw Error("Simulation failed/stale");
  const checkedSlot = await state(
    rpc,
    p,
    elf,
    plan,
    step,
    simulation.context.slot,
  );
  journal.create(step, {
    planSha256: planHash,
    step,
    wireBase64: raw.toString("base64"),
    feeLamports: fee.value,
    lastValidBlockHeight: latest.value.lastValidBlockHeight,
    observedSlot: checkedSlot,
  });
  try {
    const result = await rpc.sendRawTransaction(raw, {
      skipPreflight: false,
      preflightCommitment: "finalized",
      minContextSlot: checkedSlot,
      maxRetries: 0,
    });
    return {
      status:
        result === signature(tx)
          ? "SUBMITTED_NOT_FINALIZED"
          : "UNKNOWN_DO_NOT_RESEND",
      step,
    };
  } catch {
    return { status: "UNKNOWN_DO_NOT_RESEND", step };
  }
}
