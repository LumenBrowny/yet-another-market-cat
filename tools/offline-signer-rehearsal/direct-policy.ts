import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import { LOADER, PROGRAM, DATA, digest } from "./upgrade-policy";
export { LOADER, PROGRAM, DATA, digest };
export type DirectPolicy = {
  kind: string;
  rpc: string;
  genesis: string;
  programId: string;
  programData: string;
  payer: string;
  bufferAuthority: string;
  admin: string;
  buffer: string;
  nonceAccount: string;
  binarySha256: string;
  binarySize: number;
  programRentLamports: number;
};
export type DirectOperation = "accept-buffer" | "deploy";
export type DirectRequest = {
  operation: DirectOperation;
  nonceValue: string;
  messageBase64: string;
  messageSha256: string;
};
export function buildDirect(
  p: DirectPolicy,
  operation: DirectOperation,
  nonceValue: string,
) {
  if (
    p.kind !== "YAMC_LOCAL_DIRECT_DEPLOY_V1" ||
    p.rpc !== "http://127.0.0.1:9033" ||
    p.programId !== PROGRAM.toBase58() ||
    p.programData !== DATA.toBase58() ||
    p.genesis === "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
  )
    throw Error("Local policy mismatch");
  new PublicKey(p.genesis);
  new PublicKey(nonceValue);
  if (
    nonceValue === SystemProgram.programId.toBase58() ||
    !/^[a-f0-9]{64}$/.test(p.binarySha256) ||
    p.binarySize !== 608160 ||
    !Number.isSafeInteger(p.programRentLamports) ||
    p.programRentLamports <= 0 ||
    p.programRentLamports > 2_000_000
  )
    throw Error("Binary/rent bounds mismatch");
  const roles = [p.payer, p.bufferAuthority, p.admin, p.buffer, p.nonceAccount];
  if (
    new Set(roles).size !== roles.length ||
    roles.some((k) =>
      [
        PROGRAM,
        DATA,
        LOADER,
        SystemProgram.programId,
        SYSVAR_RENT_PUBKEY,
        SYSVAR_CLOCK_PUBKEY,
      ].some((x) => x.toBase58() === k),
    )
  )
    throw Error("Role collision");
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
  if (operation === "accept-buffer")
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
  else if (operation === "deploy") {
    const data = Buffer.alloc(12);
    data.writeUInt32LE(2);
    data.writeBigUInt64LE(BigInt(p.binarySize), 4);
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      SystemProgram.createAccount({
        fromPubkey: payer,
        newAccountPubkey: PROGRAM,
        lamports: p.programRentLamports,
        space: 36,
        programId: LOADER,
      }),
      new TransactionInstruction({
        programId: LOADER,
        keys: [
          { pubkey: payer, isSigner: true, isWritable: true },
          { pubkey: DATA, isSigner: false, isWritable: true },
          { pubkey: PROGRAM, isSigner: false, isWritable: true },
          { pubkey: buffer, isSigner: false, isWritable: true },
          { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
          { pubkey: admin, isSigner: true, isWritable: false },
        ],
        data,
      }),
    );
  } else throw Error("Unknown operation");
  if (tx.serialize({ requireAllSignatures: false }).length > 1232)
    throw Error("Oversize");
  return tx;
}
export function inspectDirect(p: DirectPolicy, r: DirectRequest) {
  const tx = buildDirect(p, r.operation, r.nonceValue),
    b = tx.serializeMessage();
  if (b.toString("base64") !== r.messageBase64 || digest(b) !== r.messageSha256)
    throw Error("Message mismatch");
  return tx;
}
