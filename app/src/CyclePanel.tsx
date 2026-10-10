import React, { useCallback, useEffect, useState } from "react";
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { formatTokens } from "@yac/shared";
import {
  claimInstruction,
  fetchClaimReceipt,
  fetchCycle,
  fetchRewards,
} from "@yac/shared/src/cycles";
import {
  leafHash,
  verifyProof,
  type CycleManifest,
  type ProofNode,
} from "@yac/shared/src/settlement";
import { Buffer } from "buffer";
import { connection } from "./wallet";

type Cycle = {
  cycleId: string;
  status: string;
  manifest: CycleManifest;
  manifestHash: string;
  claimedWallets: string[];
};
type Response = {
  current: {
    cycleId: string;
    endTime: string;
    currentCyclePointUnits: string;
  } | null;
  cycles: Cycle[];
  nextBefore: string | null;
  config: { nextCycle: string };
  finalizedChainTime: number;
  stale: boolean;
};
type Proof = {
  cycleId: string;
  wallet: string;
  pointUnits: string;
  rewardBaseUnits: string;
  merkleRoot: string;
  manifestHash: string;
  proof: ProofNode[];
};
const api = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "");
const pp = (s: string) =>
  `${BigInt(s) / 1000n}${BigInt(s) % 1000n ? "." + (BigInt(s) % 1000n).toString().padStart(3, "0").replace(/0+$/, "") : ""}`;
export function CyclePanel({
  wallet,
  mint,
  busy,
  submit,
}: {
  wallet: PublicKey | null;
  mint: PublicKey | null;
  busy: boolean;
  submit: (ix: TransactionInstruction) => Promise<string>;
}) {
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [tick, setTick] = useState(0);
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const before = pages[pages.length - 1];
  const [clock, setClock] = useState({ now: Date.now(), received: Date.now() });
  useEffect(() => {
    const timer = setInterval(
      () => setClock((c) => ({ ...c, now: Date.now() })),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  const owner = wallet?.toBase58();
  const tokenMint = mint?.toBase58();
  useEffect(() => setPages([null]), [owner]);
  useEffect(() => {
    let alive = true;
    let pending = false;
    let controller: AbortController | null = null;
    setData(null);
    setClaimed([]);
    setMessage("");
    setSelected(null);
    async function refresh() {
      if (
        !api ||
        !owner ||
        !tokenMint ||
        pending ||
        AppState.currentState !== "active"
      )
        return;
      pending = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 8000);
      try {
        const response = await fetch(
          `${api}/api/cycles?wallet=${owner}${before ? `&before=${before}` : ""}`,
          {
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error("Cycle accounting unavailable");
        const value = (await response.json()) as Response;
        for (const cycle of value.cycles)
          if (cycle.manifest.mint !== tokenMint)
            throw new Error("Cycle mint mismatch");
        if (alive) {
          setData(value);
          setClock({ now: Date.now(), received: Date.now() });
          // Indexed receipts are display hints. Claim rechecks finalized chain data.
          setClaimed((previous) => [
            ...new Set([
              ...previous,
              ...value.cycles
                .filter((c) => c.claimedWallets.includes(owner!))
                .map((c) => c.cycleId),
            ]),
          ]);
          setError("");
        }
      } catch {
        if (alive)
          setError(
            "Cycle data unavailable. Check your connection and tap REFRESH CYCLES.",
          );
      } finally {
        pending = false;
        clearTimeout(timeout);
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refresh();
    });
    return () => {
      alive = false;
      controller?.abort();
      clearInterval(timer);
      sub.remove();
    };
  }, [owner, tokenMint, tick, before]);
  const cycles = data?.cycles.filter((c) => c.status === "PUBLISHED") ?? [];
  const cycle = cycles.find((c) => c.cycleId === selected) ?? cycles[0];
  const miner = cycle?.manifest.miners.find((m) => m.wallet === owner);
  const isClaimed = cycle && claimed.includes(cycle.cycleId);
  const remaining = data?.current
    ? Math.max(
        0,
        Number(data.current.endTime) -
          data.finalizedChainTime -
          Math.floor((clock.now - clock.received) / 1000),
      )
    : 0;
  const claim = useCallback(async () => {
    if (!wallet || !mint || !cycle || busy || !api) return;
    try {
      setError("");
      setMessage("CHECKING PROOF…");
      const chainConfig = await fetchRewards(connection);
      if (!chainConfig || chainConfig.tokenMint !== mint.toBase58())
        throw new Error("Cycle chain mismatch");
      if (await fetchClaimReceipt(connection, BigInt(cycle.cycleId), wallet)) {
        setClaimed((c) => [...c, cycle.cycleId]);
        setMessage("CLAIMED");
        return;
      }
      const response = await fetch(
        `${api}/api/cycles/${cycle.cycleId}/proof/${wallet.toBase58()}`,
      );
      if (!response.ok) throw new Error("Proof unavailable");
      const proof = (await response.json()) as Proof;
      const chain = await fetchCycle(connection, BigInt(cycle.cycleId));
      if (
        !chain ||
        proof.wallet !== wallet.toBase58() ||
        proof.cycleId !== cycle.cycleId ||
        proof.merkleRoot !== cycle.manifest.merkleRoot ||
        proof.manifestHash !== cycle.manifestHash ||
        Buffer.from(chain.root).toString("hex") !== proof.merkleRoot ||
        Buffer.from(chain.manifestHash).toString("hex") !==
          proof.manifestHash ||
        !verifyProof(
          leafHash(proof.cycleId, {
            wallet: proof.wallet,
            pointUnits: proof.pointUnits,
            rewardBaseUnits: proof.rewardBaseUnits,
          }),
          proof.proof,
          proof.merkleRoot,
        )
      )
        throw new Error("Proof does not match immutable on-chain cycle");
      setMessage("APPROVE CLAIM IN YOUR WALLET…");
      await submit(
        claimInstruction(
          wallet,
          mint,
          BigInt(proof.cycleId),
          BigInt(proof.pointUnits),
          BigInt(proof.rewardBaseUnits),
          proof.proof,
        ),
      );
      if (!(await fetchClaimReceipt(connection, BigInt(proof.cycleId), wallet)))
        throw new Error("Finalized claim receipt missing");
      setClaimed((c) => [...c, proof.cycleId]);
      setMessage(
        `SHIT ACQUIRED. +${formatTokens(BigInt(proof.rewardBaseUnits))} CATSHIT`,
      );
    } catch (e) {
      setError(String(e));
      setMessage("");
    }
  }, [wallet, mint, cycle, busy, submit]);
  if (!owner) return null;
  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>SHIT CYCLES</Text>
      {data?.current && (
        <>
          <Text style={styles.text}>
            ACCRUING NOW · #{data.current.cycleId}
          </Text>
          <Text style={styles.text}>
            Your PP: {pp(data.current.currentCyclePointUnits)}
          </Text>
          <Text style={styles.note}>
            ~{Math.floor(remaining / 60)}:
            {String(remaining % 60).padStart(2, "0")} remaining · finalized
            chain estimate
          </Text>
          <Text style={styles.text}>
            LATEST PUBLISHED ·{" "}
            {data.config.nextCycle === "0"
              ? "NONE"
              : `#${BigInt(data.config.nextCycle) - 1n}`}
          </Text>
          {BigInt(data.current.cycleId) > BigInt(data.config.nextCycle) && (
            <Text style={styles.note}>
              Earlier cycles are still being published. Rewards become claimable
              after publication; current PP continue accruing.
            </Text>
          )}
        </>
      )}
      {cycle ? (
        <>
          <Text style={styles.note}>COMPLETED CYCLES · TAP A NUMBER</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            accessibilityLabel="Completed cycle selection"
          >
            {cycles.map((item) => (
              <Pressable
                key={item.cycleId}
                accessibilityRole="button"
                disabled={busy}
                accessibilityLabel={`Select completed cycle ${item.cycleId}`}
                accessibilityState={{
                  selected: item.cycleId === cycle.cycleId,
                }}
                onPress={() => {
                  setSelected(item.cycleId);
                  setMessage("");
                }}
                style={[
                  styles.cycleChoice,
                  item.cycleId === cycle.cycleId && styles.cycleSelected,
                ]}
              >
                <Text style={styles.text}>
                  #{item.cycleId}
                  {claimed.includes(item.cycleId) ? " ✓" : ""}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.navigation}>
            <Pressable
              accessibilityRole="button"
              disabled={pages.length === 1 || busy}
              style={[styles.navButton, pages.length === 1 && styles.disabled]}
              onPress={() => setPages((p) => p.slice(0, -1))}
            >
              <Text style={styles.link}>NEWER CYCLES</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!data?.nextBefore || busy}
              style={[styles.navButton, !data?.nextBefore && styles.disabled]}
              onPress={() => {
                if (data?.nextBefore) setPages((p) => [...p, data.nextBefore]);
              }}
            >
              <Text style={styles.link}>OLDER CYCLES</Text>
            </Pressable>
          </View>
          {cycles.length > 1 && (
            <Pressable
              accessibilityRole="button"
              disabled={
                busy ||
                (cycle.cycleId === cycles[cycles.length - 1]?.cycleId &&
                  !data?.nextBefore)
              }
              style={styles.navButton}
              onPress={() => {
                const index = cycles.findIndex(
                  (c) => c.cycleId === cycle.cycleId,
                );
                if (index + 1 < cycles.length)
                  setSelected(cycles[index + 1].cycleId);
                else if (data?.nextBefore)
                  setPages((p) => [...p, data.nextBefore]);
                setMessage("");
              }}
            >
              <Text style={styles.link}>PREVIOUS CYCLE</Text>
            </Pressable>
          )}
          <Text style={styles.heading}>
            SHIT CYCLE #{cycle.cycleId} COMPLETE
          </Text>
          <Text style={styles.text}>
            You: {pp(miner?.pointUnits ?? "0")} PP · Network:{" "}
            {pp(cycle.manifest.totalPointUnits)} PP
          </Text>
          <Text style={styles.text}>
            {miner && BigInt(cycle.manifest.totalPointUnits) > 0n
              ? `Share: ${Number((BigInt(miner.pointUnits) * 10000n) / BigInt(cycle.manifest.totalPointUnits)) / 100}%`
              : ""}
          </Text>
          <Text style={styles.reward}>
            {miner ? formatTokens(BigInt(miner.rewardBaseUnits)) : "0"} CATSHIT
          </Text>
          {isClaimed ? (
            <Text style={styles.text}>CLAIMED</Text>
          ) : miner && BigInt(miner.rewardBaseUnits) > 0n ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy || !!error || data?.stale}
              onPress={() => void claim()}
              style={styles.button}
            >
              <Text style={styles.buttonText}>
                {busy ? "CONFIRMING…" : "CLAIM CATSHIT"}
              </Text>
            </Pressable>
          ) : (
            <Text style={styles.note}>NO SHIT THIS CYCLE</Text>
          )}
        </>
      ) : (
        <Text style={styles.note}>
          {data
            ? "No published cycles yet."
            : error
              ? "Cycle history unavailable."
              : "Loading cycles…"}
        </Text>
      )}
      {!!message && <Text style={styles.text}>{message}</Text>}
      {!!error && <Text style={styles.error}>{error}</Text>}
      {data?.stale && <Text style={styles.note}>SETTLEMENT CATCHING UP…</Text>}
      <Pressable
        accessibilityRole="button"
        style={[styles.navButton, { marginTop: 20 }]}
        onPress={() => setTick((t) => t + 1)}
      >
        <Text style={styles.link}>REFRESH CYCLES</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  navigation: { flexDirection: "row", gap: 12, marginVertical: 16 },
  navButton: {
    minHeight: 48,
    paddingHorizontal: 12,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#566744",
    borderRadius: 9,
  },
  disabled: { opacity: 0.4 },
  cycleChoice: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginRight: 8,
    borderWidth: 1,
    borderColor: "#566744",
    borderRadius: 8,
  },
  cycleSelected: { backgroundColor: "#35452a", borderColor: "#cbee8c" },
  panel: {
    backgroundColor: "#202619",
    borderRadius: 18,
    padding: 16,
    marginVertical: 12,
  },
  heading: {
    color: "#c7dd9c",
    fontWeight: "800",
    fontSize: 13,
    marginVertical: 8,
  },
  text: { color: "#d8e3c5", fontSize: 13, marginVertical: 3 },
  note: { color: "#9eac8d", fontSize: 11 },
  reward: {
    color: "#e3f6b7",
    fontSize: 25,
    fontWeight: "900",
    marginVertical: 8,
  },
  button: { backgroundColor: "#c1df83", padding: 14, borderRadius: 9 },
  buttonText: { color: "#17200d", fontWeight: "900", textAlign: "center" },
  link: { color: "#b1c390", fontSize: 11, paddingVertical: 9 },
  error: { color: "#edb18c", fontSize: 11 },
});
