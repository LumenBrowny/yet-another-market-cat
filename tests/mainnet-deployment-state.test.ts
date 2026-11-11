import test from "node:test";
import assert from "node:assert/strict";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  digest,
  MAINNET_GENESIS,
  type DeploymentPins,
} from "../tools/offline-mainnet/deployment-policy";
import {
  deploymentStateAddresses,
  readDeploymentSnapshot,
  inspectDeploymentState,
  type DeploymentSnapshot,
} from "../tools/offline-mainnet/deployment-state";
const key = (n: number) => new PublicKey(Buffer.alloc(32, n)).toBase58();
const elf = Buffer.from("synthetic test-only program");
const loader = "BPFLoaderUpgradeab1e11111111111111111111111";
const pins: DeploymentPins = {
  schema: "yamc-mainnet-deployment-pins-v1",
  genesis: MAINNET_GENESIS,
  program: key(1),
  admin: key(2),
  payer: key(3),
  bufferAuthority: key(4),
  buffer: key(5),
  nonceAccount: key(6),
  binarySize: elf.length,
  binarySha256: digest(elf),
  programRentLamports: 1141440,
};
test("state reader requests finalized atomic account set and stops on wrong genesis", async () => {
  const expected = fixture("accept-buffer");
  let reads = 0;
  const rpc: Parameters<typeof readDeploymentSnapshot>[0] = {
    getGenesisHash: async () => MAINNET_GENESIS,
    getMultipleAccountsInfoAndContext: async (addresses, commitment) => {
      reads++;
      assert.deepEqual(
        addresses.map((a) => a.toBase58()),
        expected.addresses,
      );
      assert.equal(commitment, "finalized");
      return {
        context: { slot: expected.slot },
        value: expected.accounts.map((a) =>
          a === null ? null : { ...a, owner: new PublicKey(a.owner) },
        ),
      };
    },
  };
  assert.deepEqual(await readDeploymentSnapshot(rpc, pins), expected);
  assert.equal(reads, 1);
  await assert.rejects(
    readDeploymentSnapshot(
      { ...rpc, getGenesisHash: async () => key(25) },
      pins,
    ),
  );
  assert.equal(reads, 1);
});
function fixture(
  stage: "accept-buffer" | "deploy" | "deployed",
): DeploymentSnapshot {
  const n = Buffer.alloc(80);
  n.writeUInt32LE(1);
  n.writeUInt32LE(1, 4);
  new PublicKey(pins.admin).toBuffer().copy(n, 8);
  new PublicKey(key(stage === "deployed" ? 8 : 7)).toBuffer().copy(n, 40);
  const b = Buffer.alloc(37 + elf.length);
  b.writeUInt32LE(1);
  b[4] = 1;
  new PublicKey(stage === "accept-buffer" ? pins.bufferAuthority : pins.admin)
    .toBuffer()
    .copy(b, 5);
  elf.copy(b, 37);
  const addresses = deploymentStateAddresses(pins);
  const a = (data: Buffer, owner = loader, executable = false) => ({
    data,
    owner,
    executable,
    lamports: 10000000,
  });
  const pr = Buffer.alloc(36);
  pr.writeUInt32LE(2);
  new PublicKey(addresses[3]).toBuffer().copy(pr, 4);
  const pd = Buffer.alloc(45 + elf.length);
  pd.writeUInt32LE(3);
  pd.writeBigUInt64LE(99n, 4);
  pd[12] = 1;
  new PublicKey(pins.admin).toBuffer().copy(pd, 13);
  elf.copy(pd, 45);
  return {
    genesis: MAINNET_GENESIS,
    commitment: "finalized",
    slot: 100,
    addresses,
    accounts: [
      a(n, SystemProgram.programId.toBase58()),
      stage === "deployed" ? null : a(b),
      stage === "deployed" ? a(pr, loader, true) : null,
      stage === "deployed" ? a(pd) : null,
    ],
  };
}
for (const stage of ["accept-buffer", "deploy", "deployed"] as const) {
  test(`mainnet state ${stage}: rejects wrong network, accounts and program bytes`, () => {
    const check = (s: DeploymentSnapshot) =>
      inspectDeploymentState(pins, elf, s, stage, key(7));
    assert.equal(check(fixture(stage)).transactionAuthorization, false);
    const mutate = (fn: (s: DeploymentSnapshot) => void) => {
      const s = fixture(stage);
      fn(s);
      assert.throws(() => check(s));
    };
    mutate((s) => {
      s.genesis = key(20);
    });
    mutate((s) => {
      s.slot = 0;
    });
    mutate((s) => {
      s.addresses.reverse();
    });
    mutate((s) => {
      s.accounts[0]!.owner = loader;
    });
    mutate((s) => {
      s.accounts[0]!.data[8] ^= 1;
    });
    mutate((s) => {
      s.accounts[0]!.data[4] = 0;
    });
    if (stage !== "deployed") {
      mutate((s) => {
        s.accounts[0]!.data[40] ^= 1;
      });
      mutate((s) => {
        s.accounts[2] = s.accounts[1];
      });
      for (const offset of [0, 4, 5, 37])
        mutate((s) => {
          s.accounts[1]!.data[offset] ^= 1;
        });
      mutate((s) => {
        s.accounts[1]!.executable = true;
      });
      mutate((s) => {
        s.accounts[1]!.lamports = 0;
      });
    } else {
      mutate((s) => {
        new PublicKey(key(7)).toBuffer().copy(s.accounts[0]!.data, 40);
      });
      mutate((s) => {
        s.accounts[2]!.executable = false;
      });
      for (const offset of [0, 12, 13, 45])
        mutate((s) => {
          s.accounts[3]!.data[offset] ^= 1;
        });
      mutate((s) => {
        s.accounts[3]!.data.writeBigUInt64LE(101n, 4);
      });
      mutate((s) => {
        s.accounts[1] = s.accounts[3];
      });
    }
    assert.throws(() =>
      inspectDeploymentState(
        pins,
        Buffer.alloc(elf.length),
        fixture(stage),
        stage,
        key(7),
      ),
    );
  });
}
