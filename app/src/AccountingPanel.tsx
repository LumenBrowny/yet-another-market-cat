import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { PROGRAM_ID } from "@yac/shared/src/client";
import { connection } from "./wallet";
import { reconcilePointDisplay } from "./ppDisplay";

type AccountingSnapshot = {
  wallet: string;
  position: string | null;
  effectiveLockedBaseUnits: string;
  tier: string;
  multiplier: string;
  pointUnits: string;
  pointScale: string;
  poopPoints: string;
  ratePointUnitsPerSecond: string;
  storedPointUnits: string;
  lastAccrualTimestamp: number | null;
  accountingFinalizedThroughTime: number;
  accountingFinalizedThroughSlot: number;
  indexerLagSlots: number;
  stale: boolean;
  programId: string;
  mint: string;
  genesisHash: string;
  currentCycleId: string | null;
  currentCyclePointUnits: string | null;
  currentCycleStart: number | null;
  currentCycleEnd: number | null;
};
const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "");

export function AccountingPanel({
  wallet,
  mint,
  locked,
}: {
  wallet: string | null;
  mint: string | null;
  locked: string | null;
}) {
  const [snapshot, setSnapshot] = useState<AccountingSnapshot | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [debug, setDebug] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [display, setDisplay] = useState({
    lifetime: 0,
    cycle: 0,
    paused: false,
  });
  const displayRef = useRef({
    lifetime: 0,
    cycle: 0,
    ready: false,
    cycleId: "",
    updatedAt: 0,
  });
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  useEffect(() => {
    setSnapshot(null);
    displayRef.current.ready = false;
    setUnavailable(false);
    if (!wallet || !mint) return;
    let alive = true;
    let inFlight = false;
    let currentRequest: AbortController | undefined;
    // The endpoint is fixed for this build; genesis never changes within a session.
    let genesis: string | undefined;
    const fetchSnapshot = async () => {
      if (inFlight || AppState.currentState !== "active") return;
      inFlight = true;
      currentRequest = new AbortController();
      const timeout = setTimeout(() => currentRequest?.abort(), 8000);
      try {
        if (!apiUrl || !mint) throw new Error("Accounting not configured");
        const [chainGenesis, response] = await Promise.all([
          genesis ? Promise.resolve(genesis) : connection.getGenesisHash(),
          fetch(`${apiUrl}/api/miners/${wallet}/accounting`, {
            signal: currentRequest.signal,
          }),
        ]);
        genesis = chainGenesis;
        if (!response.ok) throw new Error("Accounting unavailable");
        const data = (await response.json()) as AccountingSnapshot;
        if (
          data.wallet !== wallet ||
          data.programId !== PROGRAM_ID.toBase58() ||
          data.mint !== mint ||
          data.genesisHash !== genesis ||
          data.pointScale !== "1000" ||
          !/^\d+$/.test(data.pointUnits) ||
          !/^\d+$/.test(data.ratePointUnitsPerSecond)
        )
          throw new Error(
            "Accounting belongs to another chain or has invalid precision",
          );
        if (alive) {
          setSnapshot(data);
          setUnavailable(false);
        }
      } catch {
        if (alive) setUnavailable(true);
      } finally {
        clearTimeout(timeout);
        inFlight = false;
      }
    };
    void fetchSnapshot();
    const timer = setInterval(() => void fetchSnapshot(), 5000);
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void fetchSnapshot();
    });
    return () => {
      alive = false;
      currentRequest?.abort();
      clearInterval(timer);
      listener.remove();
    };
  }, [wallet, mint, refreshKey]);
  const catchingUp =
    unavailable ||
    snapshot?.stale ||
    (snapshot &&
      locked !== null &&
      snapshot.effectiveLockedBaseUnits !== locked);
  useEffect(() => {
    if (!snapshot) return;
    const tick = () => {
      // Display only. Integer finalized snapshots remain the accounting authority.
      const now = Date.now();
      const age = now / 1000 - snapshot.accountingFinalizedThroughTime;
      // Short outages/stake transitions keep the last known rate animating.
      // Never extrapolate indefinitely when authoritative updates stop.
      const elapsed = Math.max(0, Math.min(90, age));
      const rate = Number(snapshot.ratePointUnitsPerSecond) / 1000;
      const target = Number(snapshot.pointUnits) / 1000 + elapsed * rate;
      const cycleElapsed =
        snapshot.currentCycleEnd == null
          ? elapsed
          : Math.min(
              elapsed,
              Math.max(
                0,
                snapshot.currentCycleEnd -
                  snapshot.accountingFinalizedThroughTime,
              ),
            );
      const cycleTarget =
        Number(snapshot.currentCyclePointUnits ?? "0") / 1000 +
        cycleElapsed * rate;
      const prior = displayRef.current;
      const dt = (now - prior.updatedAt) / 1000;
      const reconciled = reconcilePointDisplay(
        prior.lifetime,
        target,
        rate,
        prior.ready,
        !!catchingUp,
        false,
        dt,
      );
      if (reconciled.largeCorrection)
        console.warn("PP display reconciled to authoritative snapshot", {
          differencePP: target - prior.lifetime,
        });
      const lifetime = reconciled.value;
      const cycleId = snapshot.currentCycleId ?? "";
      const cycle = reconcilePointDisplay(
        prior.cycle,
        cycleTarget,
        rate,
        prior.ready,
        !!catchingUp,
        cycleId !== prior.cycleId,
        dt,
      ).value;
      displayRef.current = {
        lifetime,
        cycle,
        ready: true,
        cycleId,
        updatedAt: now,
      };
      setDisplay({ lifetime, cycle, paused: age >= 90 });
    };
    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [snapshot, unavailable, catchingUp]);
  return (
    <View style={styles.panel}>
      <Text style={styles.label}>LIFETIME PP</Text>
      <Text accessibilityLabel="Lifetime Poop Points" style={styles.points}>
        {snapshot ? `${display.lifetime.toFixed(1)} PP` : "— PP"}
      </Text>
      <Text style={styles.rate}>
        {snapshot
          ? `+${snapshot.multiplier} PP/sec`
          : wallet
            ? unavailable
              ? "ACCOUNTING UNAVAILABLE"
              : "LOADING ACCOUNTING…"
            : "CONNECT WALLET TO VIEW POINTS"}
      </Text>
      <Text style={styles.label}>
        CURRENT SHIT CYCLE{" "}
        {snapshot?.currentCycleId != null ? `#${snapshot.currentCycleId}` : ""}
      </Text>
      <Text style={styles.rate}>
        {snapshot?.currentCyclePointUnits != null
          ? `${display.cycle.toFixed(1)} PP`
          : "— PP"}
      </Text>
      <Text style={styles.status}>
        LIVE ESTIMATE · FINALIZED ACCOUNTING BELOW
      </Text>
      <Text style={styles.rate}>
        {snapshot ? `${snapshot.poopPoints} PP finalized` : ""}
      </Text>
      {(catchingUp || display.paused) && snapshot && (
        <Text style={styles.status}>
          {display.paused
            ? "ESTIMATE CAPPED · WAITING FOR FINALIZED DATA"
            : "SYNCING · ESTIMATING AT LAST FINALIZED RATE"}
        </Text>
      )}
      {__DEV__ && (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => setDebug((v) => !v)}
          >
            <Text style={styles.control}>
              {debug ? "HIDE ACCOUNTING" : "ACCOUNTING DEBUG"}
            </Text>
          </Pressable>
          {debug && (
            <>
              <Text
                selectable
                style={styles.debug}
              >{`wallet: ${wallet ?? "—"}\nposition: ${snapshot?.position ?? "—"}\neffective locked: ${snapshot?.effectiveLockedBaseUnits ?? "—"}\ntier: ${snapshot?.tier ?? "—"}\nexact rate: ${snapshot?.ratePointUnitsPerSecond ?? "—"} milli-PP/sec\nstored units: ${snapshot?.storedPointUnits ?? "—"}\ncalculated units: ${snapshot?.pointUnits ?? "—"}\nlast accrual: ${snapshot?.lastAccrualTimestamp ?? "—"}\nfinalized time: ${snapshot?.accountingFinalizedThroughTime ?? "—"}\nfinalized slot: ${snapshot?.accountingFinalizedThroughSlot ?? "—"}\nlag slots: ${snapshot?.indexerLagSlots ?? "—"}\nLocal interpolation is display only.`}</Text>
              <Pressable accessibilityRole="button" onPress={refresh}>
                <Text style={styles.control}>REFRESH ACCOUNTING</Text>
              </Pressable>
            </>
          )}
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  panel: { paddingVertical: 12 },
  label: { color: "#a9b49b", fontSize: 11, letterSpacing: 2 },
  points: { color: "#e2f3bf", fontSize: 32, fontWeight: "900" },
  rate: { color: "#c0d992", fontSize: 13 },
  status: { color: "#edbc68", fontSize: 11, marginTop: 5 },
  control: { color: "#a9b49b", fontSize: 10, paddingVertical: 9 },
  debug: { color: "#a9b49b", fontSize: 10 },
});
