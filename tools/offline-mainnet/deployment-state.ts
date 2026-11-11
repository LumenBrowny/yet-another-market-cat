// Pure verification of a finalized RPC snapshot. Never signs or sends.
import {
  NonceAccount,
  PublicKey,
  SystemProgram,
  type Connection,
} from "@solana/web3.js";
import {
  digest,
  MAINNET_GENESIS,
  validatePins,
  type DeploymentPins,
} from "./deployment-policy";

const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
// Deliberately accept only read methods. Caller owns the private RPC configuration;
// do not print Connection errors (they may contain a credential-bearing endpoint).
export async function readDeploymentSnapshot(
  rpc: Pick<Connection, "getGenesisHash" | "getMultipleAccountsInfoAndContext">,
  p: DeploymentPins,
  minimumSlot = 0,
): Promise<DeploymentSnapshot> {
  if (!Number.isSafeInteger(minimumSlot) || minimumSlot < 0)
    throw Error("Invalid minimum slot");
  const addresses = deploymentStateAddresses(p);
  const genesis = await rpc.getGenesisHash();
  if (genesis !== MAINNET_GENESIS) throw Error("Wrong network");
  let result:
    | Awaited<ReturnType<typeof rpc.getMultipleAccountsInfoAndContext>>
    | undefined;
  for (let attempt = 0; attempt < (minimumSlot ? 4 : 1); attempt++) {
    try {
      result = await rpc.getMultipleAccountsInfoAndContext(
        addresses.map((a) => new PublicKey(a)),
        minimumSlot
          ? { commitment: "finalized", minContextSlot: minimumSlot }
          : "finalized",
      );
      if (!Number.isSafeInteger(result.context.slot) || result.context.slot < 1)
        throw Error("Invalid snapshot slot");
      if (result.context.slot >= minimumSlot) break;
      result = undefined;
    } catch (error) {
      // Solana's explicit min-context-slot-not-reached response. No generic
      // RPC retry and no transaction resubmission.
      if (!minimumSlot || (error as { code?: number }).code !== -32016)
        throw error;
      result = undefined;
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!result) throw Error("Snapshot stale after read retries");
  return {
    genesis,
    commitment: "finalized",
    slot: result.context.slot,
    addresses,
    accounts: result.value.map((a) =>
      a === null
        ? null
        : {
            owner: a.owner.toBase58(),
            executable: a.executable,
            lamports: a.lamports,
            data: a.data,
          },
    ),
  };
}
export type ObservedAccount = {
  owner: string;
  executable: boolean;
  lamports: number;
  data: Buffer;
} | null;
export type DeploymentSnapshot = {
  genesis: string;
  commitment: "finalized";
  slot: number;
  // Entries must come from ONE getMultipleAccounts response, in this exact order.
  addresses: string[];
  accounts: ObservedAccount[];
};
export function deploymentStateAddresses(p: DeploymentPins) {
  const { data } = validatePins(p);
  return [p.nonceAccount, p.buffer, p.program, data.toBase58()];
}
function account(
  a: ObservedAccount,
  owner: string,
  size: number,
  executable = false,
) {
  if (
    !a ||
    a.owner !== owner ||
    a.executable !== executable ||
    !Number.isSafeInteger(a.lamports) ||
    a.lamports <= 0 ||
    a.data.length !== size
  )
    throw Error("Account owner, size, executable flag or balance mismatch");
  return a.data;
}
export function inspectDeploymentState(
  p: DeploymentPins,
  elf: Buffer,
  snapshot: DeploymentSnapshot,
  stage: "accept-buffer" | "deploy" | "deployed",
  expectedNonce: string,
) {
  const addresses = deploymentStateAddresses(p);
  if (
    snapshot.genesis !== MAINNET_GENESIS ||
    snapshot.commitment !== "finalized" ||
    !Number.isSafeInteger(snapshot.slot) ||
    snapshot.slot < 1 ||
    JSON.stringify(snapshot.addresses) !== JSON.stringify(addresses) ||
    snapshot.accounts.length !== 4
  )
    throw Error("Wrong network, commitment, slot or account ordering");
  if (elf.length !== p.binarySize || digest(elf) !== p.binarySha256)
    throw Error("Local ELF differs from pins");
  if (
    new PublicKey(expectedNonce).toBase58() !== expectedNonce ||
    expectedNonce === SystemProgram.programId.toBase58()
  )
    throw Error("Invalid expected nonce");
  const [nonce, buffer, program, programData] = snapshot.accounts;
  const n = account(nonce, SystemProgram.programId.toBase58(), 80);
  if (n.readUInt32LE(0) !== 1 || n.readUInt32LE(4) !== 1)
    throw Error("Nonce not current initialized version");
  const parsed = NonceAccount.fromAccountData(n);
  if (parsed.authorizedPubkey.toBase58() !== p.admin)
    throw Error("Nonce authority mismatch");
  if (stage === "accept-buffer" || stage === "deploy") {
    if (parsed.nonce !== expectedNonce)
      throw Error("Nonce changed; request is stale");
    if (program !== null || programData !== null)
      throw Error("Program already exists");
    const b = account(buffer, LOADER, 37 + elf.length);
    const authority = stage === "accept-buffer" ? p.bufferAuthority : p.admin;
    if (
      b.readUInt32LE(0) !== 1 ||
      b[4] !== 1 ||
      !b.subarray(5, 37).equals(new PublicKey(authority).toBuffer()) ||
      !b.subarray(37).equals(elf)
    )
      throw Error("Buffer variant, authority or ELF mismatch");
  } else if (stage === "deployed") {
    if (parsed.nonce === expectedNonce)
      throw Error("Deployment nonce was not consumed");
    const pr = account(program, LOADER, 36, true);
    const pd = account(programData, LOADER, 45 + elf.length);
    if (
      pr.readUInt32LE(0) !== 2 ||
      !pr.subarray(4).equals(new PublicKey(addresses[3]).toBuffer()) ||
      pd.readUInt32LE(0) !== 3 ||
      pd[12] !== 1 ||
      !pd.subarray(13, 45).equals(new PublicKey(p.admin).toBuffer()) ||
      !pd.subarray(45).equals(elf) ||
      pd.readBigUInt64LE(4) > BigInt(snapshot.slot)
    )
      throw Error("Deployed program differs from pins");
    if (
      buffer !== null &&
      !(
        buffer.owner === LOADER &&
        !buffer.executable &&
        buffer.lamports === 0 &&
        buffer.data.length === 37
      )
    )
      throw Error("Buffer not closed after deployment");
  } else throw Error("Unsupported stage");
  return {
    status: "MATCHES_OBSERVED_STATE" as const,
    stage,
    slot: snapshot.slot,
    transactionAuthorization: false as const,
  };
}
