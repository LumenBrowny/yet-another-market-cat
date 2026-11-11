// Pure message review only. No RPC, private-key loading, signing or broadcasting.
import { createHash } from "node:crypto";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";

export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
export const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export type DeploymentPins = {
  schema: "yamc-mainnet-deployment-pins-v1";
  genesis: string;
  program: string;
  admin: string;
  payer: string;
  bufferAuthority: string;
  buffer: string;
  nonceAccount: string;
  binarySha256: string;
  binarySize: number;
  programRentLamports: number;
};
export type DeploymentRequest = {
  operation: "accept-buffer" | "deploy";
  nonceValue: string;
  messageBase64: string;
  messageSha256: string;
};
/** Pins must be reviewed/stored independently on the offline computer, NOT loaded
 * from a request envelope. Network identity and buffer bytes are not in the message.
 */
export function validatePins(p: DeploymentPins) {
  if (
    p.schema !== "yamc-mainnet-deployment-pins-v1" ||
    p.genesis !== MAINNET_GENESIS
  )
    throw Error("Mainnet deployment pins required");
  if (
    !/^[a-f0-9]{64}$/.test(p.binarySha256) ||
    !Number.isSafeInteger(p.binarySize) ||
    p.binarySize <= 0 ||
    p.binarySize > 10 * 1024 * 1024 ||
    !Number.isSafeInteger(p.programRentLamports) ||
    p.programRentLamports <= 0 ||
    p.programRentLamports > 2_000_000
  )
    throw Error("Invalid binary or program-account rent pins");
  const roles = [
    p.program,
    p.admin,
    p.payer,
    p.bufferAuthority,
    p.buffer,
    p.nonceAccount,
  ];
  const program = new PublicKey(p.program);
  const data = PublicKey.findProgramAddressSync(
    [program.toBuffer()],
    LOADER,
  )[0];
  const forbidden = [
    LOADER,
    SystemProgram.programId,
    SYSVAR_RENT_PUBKEY,
    SYSVAR_CLOCK_PUBKEY,
    data,
  ].map((k) => k.toBase58());
  forbidden.push(
    "BfNiASrYNqmARu2TQ1eBa1PJ6KgVHTNn44ATk5rJe6zW",
    "5Kgy6TMeTAhyZZNPdhgEkRkGKw5riMgFZoqyGtFi9Cjk",
  );
  if (
    new Set(roles).size !== roles.length ||
    roles.some(
      (k) => new PublicKey(k).toBase58() !== k || forbidden.includes(k),
    )
  )
    throw Error("Invalid, colliding or rehearsal role");
  return { program, data };
}
export function expectedDeploymentMessage(
  p: DeploymentPins,
  operation: DeploymentRequest["operation"],
  nonceValue: string,
) {
  const { program, data } = validatePins(p);
  if (
    new PublicKey(nonceValue).toBase58() !== nonceValue ||
    nonceValue === SystemProgram.programId.toBase58()
  )
    throw Error("Invalid nonce value");
  const payer = new PublicKey(p.payer),
    admin = new PublicKey(p.admin),
    buffer = new PublicKey(p.buffer);
  const tx = new Transaction({
    feePayer: payer,
    recentBlockhash: nonceValue,
  }).add(
    SystemProgram.nonceAdvance({
      noncePubkey: new PublicKey(p.nonceAccount),
      authorizedPubkey: admin,
    }),
  );
  if (operation === "accept-buffer") {
    tx.add(
      new TransactionInstruction({
        programId: LOADER,
        keys: [
          { pubkey: buffer, isWritable: true, isSigner: false },
          {
            pubkey: new PublicKey(p.bufferAuthority),
            isWritable: false,
            isSigner: true,
          },
          { pubkey: admin, isWritable: false, isSigner: true },
        ],
        data: Buffer.from([7, 0, 0, 0]),
      }),
    );
  } else if (operation === "deploy") {
    const bytes = Buffer.alloc(12);
    bytes.writeUInt32LE(2);
    bytes.writeBigUInt64LE(BigInt(p.binarySize), 4);
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      SystemProgram.createAccount({
        fromPubkey: payer,
        newAccountPubkey: program,
        lamports: p.programRentLamports,
        space: 36,
        programId: LOADER,
      }),
      new TransactionInstruction({
        programId: LOADER,
        keys: [
          { pubkey: payer, isWritable: true, isSigner: true },
          { pubkey: data, isWritable: true, isSigner: false },
          { pubkey: program, isWritable: true, isSigner: true },
          { pubkey: buffer, isWritable: true, isSigner: false },
          { pubkey: SYSVAR_RENT_PUBKEY, isWritable: false, isSigner: false },
          { pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false, isSigner: false },
          {
            pubkey: SystemProgram.programId,
            isWritable: false,
            isSigner: false,
          },
          { pubkey: admin, isWritable: false, isSigner: true },
        ],
        data: bytes,
      }),
    );
  } else throw Error("Unsupported operation");
  if (tx.serialize({ requireAllSignatures: false }).length > 1232)
    throw Error("Oversize deployment");
  return tx;
}
export function inspectDeployment(
  pins: DeploymentPins,
  request: DeploymentRequest,
  candidateElf: Uint8Array,
) {
  if (
    candidateElf.length !== pins.binarySize ||
    digest(candidateElf) !== pins.binarySha256
  )
    throw Error("Local ELF differs from trusted pins");
  const transaction = expectedDeploymentMessage(
    pins,
    request.operation,
    request.nonceValue,
  );
  const bytes = transaction.serializeMessage();
  if (
    bytes.toString("base64") !== request.messageBase64 ||
    digest(bytes) !== request.messageSha256
  )
    throw Error("Message differs from trusted deployment policy");
  return {
    status: "MATCHES_OFFLINE_POLICY" as const,
    transactionAuthorization: false as const,
    messageSha256: digest(bytes),
    expectedSigners: transaction
      .compileMessage()
      .accountKeys.slice(
        0,
        transaction.compileMessage().header.numRequiredSignatures,
      )
      .map((k) => k.toBase58()),
    requiredOnlineChecks: [
      "finalized mainnet genesis",
      "nonce account owner/authority/value",
      "buffer loader owner/authority/exact ELF",
      "program and ProgramData absent before deploy",
      "current rent and total funding/fee budget",
    ],
  };
}
