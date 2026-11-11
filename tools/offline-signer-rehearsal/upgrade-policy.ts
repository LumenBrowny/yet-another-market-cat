// Local checked loader authority handoff, not a general loader signer.
import { createHash } from "node:crypto";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
export const LOADER = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
export const PROGRAM = new PublicKey(
  "BfNiASrYNqmARu2TQ1eBa1PJ6KgVHTNn44ATk5rJe6zW",
);
export const DATA = PublicKey.findProgramAddressSync(
  [PROGRAM.toBuffer()],
  LOADER,
)[0];
export const digest = (b: Uint8Array) =>
  createHash("sha256").update(b).digest("hex");
export type UpgradePolicy = {
  kind: string;
  rpc: string;
  genesis: string;
  programId: string;
  programData: string;
  payer: string;
  oldAuthority: string;
  newAuthority: string;
  nonceAccount: string;
  binarySha256: string;
  programDataSha256: string;
};
export type UpgradeRequest = {
  nonceValue: string;
  messageBase64: string;
  messageSha256: string;
};
export function transferInstruction(
  oldAuthority: PublicKey,
  newAuthority: PublicKey,
) {
  return new TransactionInstruction({
    programId: LOADER,
    keys: [
      { pubkey: DATA, isSigner: false, isWritable: true },
      { pubkey: oldAuthority, isSigner: true, isWritable: false },
      { pubkey: newAuthority, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([7, 0, 0, 0]),
  });
}
export function buildUpgrade(p: UpgradePolicy, nonceValue: string) {
  if (
    p.kind !== "YAMC_LOCAL_LOADER_HANDOFF_V1" ||
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
    ![p.binarySha256, p.programDataSha256].every((x) =>
      /^[a-f0-9]{64}$/.test(x),
    )
  )
    throw Error("Invalid pins");
  const roles = [p.payer, p.oldAuthority, p.newAuthority, p.nonceAccount];
  if (
    new Set(roles).size !== 4 ||
    roles.some((k) =>
      [PROGRAM, DATA, LOADER, SystemProgram.programId].some(
        (x) => x.toBase58() === k,
      ),
    )
  )
    throw Error("Role collision");
  const tx = new Transaction({
    feePayer: new PublicKey(p.payer),
    recentBlockhash: nonceValue,
  }).add(
    SystemProgram.nonceAdvance({
      noncePubkey: new PublicKey(p.nonceAccount),
      authorizedPubkey: new PublicKey(p.newAuthority),
    }),
    transferInstruction(
      new PublicKey(p.oldAuthority),
      new PublicKey(p.newAuthority),
    ),
  );
  return tx;
}
export function inspectUpgrade(p: UpgradePolicy, r: UpgradeRequest) {
  const tx = buildUpgrade(p, r.nonceValue),
    b = tx.serializeMessage();
  if (b.toString("base64") !== r.messageBase64 || digest(b) !== r.messageSha256)
    throw Error("Exact message mismatch");
  return tx;
}
