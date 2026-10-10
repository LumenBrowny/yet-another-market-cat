import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import {
  formatTokens,
  getMiningTier,
  getNextTier,
  parseTokens,
  MIN_LOCK,
  TOKEN_SCALE,
  UNLOCK_COOLDOWN,
} from "@yac/shared";
import {
  ensureAta,
  instruction,
  ownerAccounts,
  readConfig,
  readWalletSnapshot,
  readPosition,
  type Config,
  type Position,
} from "@yac/shared/src/client";
import { CatScene } from "./CatScene";
import { AccountingPanel } from "./AccountingPanel";
import { ProductNavigation } from "./ProductNavigation";
import { CyclePanel } from "./CyclePanel";
import {
  cluster,
  connection,
  connectWallet,
  disconnectWallet,
  restoredWallet,
  sendInstructions,
} from "./wallet";

type Snapshot = {
  balance: bigint;
  position: Position | null;
  claimed: boolean;
};
export default function App() {
  const [owner, setOwner] = useState<PublicKey | null>(null);
  const [walletRevision, setWalletRevision] = useState(0);
  const [config, setConfig] = useState<Config | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [amount, setAmount] = useState("1000");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const ownerRef = useRef<PublicKey | null>(null);
  const refreshSequence = useRef(0);
  const backgroundRefreshRunning = useRef(false);
  const refreshRetryAfter = useRef(0);
  const [refreshError, setRefreshError] = useState("");
  const scrollRef = useRef<ScrollView>(null);
  const cyclesY = useRef(0);
  const [message, setMessage] = useState(
    "Another cat token? Unfortunately, yes.",
  );
  const [error, setError] = useState("");
  const [signature, setSignature] = useState("");
  const [now, setNow] = useState(Date.now());
  const selectOwner = (key: PublicKey | null) => {
    setWalletRevision((v) => v + 1);
    refreshSequence.current++;
    ownerRef.current = key;
    setOwner(key);
    setSnapshot(null);
  };
  const refresh = useCallback(async (wallet = ownerRef.current) => {
    const sequence = ++refreshSequence.current;
    const c = await readConfig(connection);
    if (sequence !== refreshSequence.current) return;
    setConfig(c);
    if (!c)
      throw new Error(
        "Program config is missing. Run the dev setup script on this cluster.",
      );
    if (!wallet) return;
    const next = await readWalletSnapshot(connection, wallet, c.tokenMint);
    if (
      sequence === refreshSequence.current &&
      ownerRef.current?.equals(wallet)
    ) {
      setSnapshot(next);
      setRefreshError("");
      refreshRetryAfter.current = 0;
    }
  }, []);
  useEffect(() => {
    let alive = true;
    // Foreground can arrive before SecureStore restores the wallet. Do not start
    // an owner-less request that would suppress the real initial refresh.
    let walletRestored = false;
    const backgroundRefresh = async (wallet = ownerRef.current) => {
      if (
        !walletRestored ||
        backgroundRefreshRunning.current ||
        Date.now() < refreshRetryAfter.current
      )
        return;
      backgroundRefreshRunning.current = true;
      try {
        await refresh(wallet);
        if (alive) setRefreshError("");
      } catch (e) {
        const limited = /429|rate limit/i.test(String(e));
        refreshRetryAfter.current = Date.now() + (limited ? 60_000 : 30_000);
        if (alive)
          setRefreshError(
            limited
              ? "Devnet RPC is rate limited. Showing the last loaded balance; retrying in one minute."
              : "Could not refresh on-chain balances. Check your connection; retrying shortly.",
          );
      } finally {
        backgroundRefreshRunning.current = false;
      }
    };
    restoredWallet()
      .then((key) => {
        if (alive) {
          selectOwner(key);
          walletRestored = true;
          return backgroundRefresh(key);
        }
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    const timer = setInterval(() => {
      setNow(Date.now());
      if (AppState.currentState === "active" && !busyRef.current)
        void backgroundRefresh();
    }, 30_000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && !busyRef.current) void backgroundRefresh();
    });
    return () => {
      alive = false;
      refreshSequence.current++;
      clearInterval(timer);
      sub.remove();
    };
  }, [refresh]);
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setSignature("");
    try {
      await action();
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      setMessage(
        "Action interrupted. Refresh on-chain state before trying again.",
      );
      setError(
        detail.includes("CLOSED")
          ? "Wallet connection closed. Reopen your wallet, then try again."
          : detail,
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const transact = async (ixs: TransactionInstruction[], success: string) => {
    if (!owner) throw new Error("Connect a wallet first");
    if ((await connection.getBalance(owner, "confirmed")) < 5000)
      throw new Error(
        "You need devnet SOL for fees and account rent. Use GET DEVNET SOL below, then retry. CATSHIT alone cannot pay transaction fees.",
      );
    setMessage("Approve in your wallet…");
    await sendInstructions(owner, ixs, (sig) => {
      setSignature(sig);
      setMessage("Submitted. Waiting for confirmation…");
    });
    setMessage(success);
    try {
      await refresh(owner);
    } catch (e) {
      throw new Error(
        `Transaction confirmed; refresh failed. Tap REFRESH. ${String(e)}`,
      );
    }
  };
  const submitClaim = async (ix: TransactionInstruction) => {
    if (!owner || busyRef.current) throw new Error("Wallet is busy");
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const signature = await sendInstructions(
        owner,
        [ix],
        setSignature,
        "finalized",
      );
      setMessage("SHIT ACQUIRED.");
      await refresh(owner);
      return signature;
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const locked = snapshot?.position?.lockedAmount ?? 0n;
  const tier = getMiningTier(locked);
  const next = getNextTier(locked);
  const pending = snapshot?.position?.pendingWithdrawAmount ?? 0n;
  const unlockAt = pending
    ? Number(
        (snapshot?.position?.withdrawRequestedAt ?? 0n) +
          (config?.unlockCooldownSeconds ?? UNLOCK_COOLDOWN),
      ) * 1000
    : 0;
  const accounts =
    owner && config ? ownerAccounts(owner, config.tokenMint) : null;
  const ready = !!accounts && !!snapshot && !busy;
  const button = (
    label: string,
    action: () => Promise<void>,
    disabled = false,
    secondary = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={() => void run(action)}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        (disabled || busy) && styles.disabled,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.buttonText, secondary && { color: "#d6dccb" }]}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.top}>
            <Text style={styles.eyebrow}>CLOCK IN. ZONE OUT.</Text>
            <Text style={styles.badge}>{cluster.toUpperCase()}</Text>
          </View>
          <Text style={styles.title}>Yet Another Market Cat 💩</Text>
          <Text style={styles.note}>CANONICAL DEVNET · 1-HOUR SHIT CYCLES</Text>
          <Text style={styles.subtitle}>Powered by PoS™ — Proof of Shit</Text>
          <ProductNavigation
            wallet={owner?.toBase58()}
            onCycles={() =>
              scrollRef.current?.scrollTo({
                y: cyclesY.current,
                animated: true,
              })
            }
          />
          <View style={styles.wallet}>
            <View style={styles.dot} />
            <Text selectable style={styles.walletText}>
              {owner ? owner.toBase58() : "No wallet. No shit."}
            </Text>
          </View>
          {!owner &&
            button("CONNECT WALLET", async () => {
              const key = await connectWallet();
              selectOwner(key);
              await refresh(key);
              setMessage("Wallet connected. The cat remains unimpressed.");
            })}
          <AccountingPanel
            wallet={owner?.toBase58() ?? null}
            mint={config?.tokenMint.toBase58() ?? null}
            locked={snapshot ? locked.toString() : null}
          />
          <View style={styles.panel}>
            <View style={styles.top}>
              <Text style={styles.eyebrow}>CAT SHIT ENGINE / 002</Text>
              <Text style={styles.active}>
                {owner && !snapshot
                  ? "LOADING POSITION…"
                  : locked >= MIN_LOCK
                    ? "● MINING ACTIVE"
                    : "○ MINING INACTIVE"}
              </Text>
            </View>
            <CatScene
              state={tier.catState}
              wallet={owner?.toBase58() ?? null}
              walletRevision={walletRevision}
            />
          </View>
          <View style={styles.stats}>
            <View>
              <Text style={styles.label}>IN YOUR WALLET</Text>
              <Text style={styles.number}>
                {snapshot ? formatTokens(snapshot.balance) : "—"}
              </Text>
            </View>
            <View>
              <Text style={styles.label}>CATSHIT LOCKED</Text>
              <Text style={styles.number}>
                {snapshot ? formatTokens(locked) : "—"}
              </Text>
            </View>
          </View>
          <View
            onLayout={(event) => {
              cyclesY.current = event.nativeEvent.layout.y;
            }}
          >
            <CyclePanel
              wallet={owner}
              mint={config?.tokenMint ?? null}
              busy={busy}
              submit={submitClaim}
            />
          </View>
          <Text style={styles.note}>
            {next
              ? `Next: ${next.displayMultiplier} ${next.id} · ${formatTokens(next.minimumLocked - locked)} more CATSHIT`
              : "Highest tier reached"}
          </Text>
          {button(
            snapshot?.claimed ? "YOU MISSED IT. ALREADY." : "I MISSED THE CAT",
            async () => {
              if (accounts && owner && config)
                await transact(
                  [
                    ensureAta(owner, config.tokenMint),
                    instruction("claimFaucet", accounts),
                  ],
                  "YOU MISSED IT.\nAGAIN.\n+2,000 CATSHIT",
                );
            },
            !ready || !!snapshot?.claimed,
            true,
          )}
          <Text style={styles.note}>
            I MISSED THE CAT gives 2,000 test CATSHIT once per wallet while the
            faucet reserve lasts. You also need devnet SOL for fees and account
            rent.
          </Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => void Linking.openURL("https://faucet.solana.com")}
          >
            <Text style={styles.note}>GET DEVNET SOL ↗ · free test tokens</Text>
          </Pressable>
          <Text style={styles.sectionLabel}>PUT THE CAT TO WORK</Text>
          <View style={styles.presets}>
            {["1000", "2500", "5000", "MAX"].map((value) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                disabled={!ready}
                onPress={() =>
                  setAmount(
                    value === "MAX"
                      ? ((snapshot?.balance ?? 0n) / TOKEN_SCALE).toString() +
                          "." +
                          ((snapshot?.balance ?? 0n) % TOKEN_SCALE)
                            .toString()
                            .padStart(6, "0")
                      : value,
                  )
                }
                style={styles.preset}
              >
                <Text style={styles.presetText}>{value}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            accessibilityLabel="CATSHIT amount to lock or withdraw"
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
            style={styles.input}
            editable={!busy}
          />
          {button(
            locked > 0n ? "LOCK MORE CATSHIT" : "LOCK CATSHIT",
            async () => {
              if (!accounts || !owner || !config || !snapshot) return;
              const value = parseTokens(amount);
              if (value === 0n || value > snapshot.balance)
                throw new Error(
                  "Enter an amount above zero within your wallet balance",
                );
              const position = await readPosition(connection, owner);
              await transact(
                [
                  ...(position
                    ? []
                    : [instruction("createPosition", accounts)]),
                  instruction("deposit", accounts, value),
                ],
                "LOCKED. Your cat has a job now.",
              );
            },
            !ready,
          )}
          <Text style={styles.note}>
            Custody release requires a 24-hour cooldown.
          </Text>
          {pending > 0n ? (
            <View style={styles.withdraw}>
              <Text style={styles.hint}>
                {formatTokens(pending)} CATSHIT pending
              </Text>
              <Text style={styles.note}>
                Release after {new Date(unlockAt).toLocaleString()}. These
                tokens no longer mine.
              </Text>
              {button(
                "RELEASE CATSHIT",
                async () => {
                  if (accounts && owner && config)
                    await transact(
                      [
                        ensureAta(owner, config.tokenMint),
                        instruction("executeWithdraw", accounts),
                      ],
                      "Withdrawn to your wallet.",
                    );
                },
                !ready || now < unlockAt,
                true,
              )}
            </View>
          ) : (
            button(
              "REQUEST WITHDRAWAL",
              async () => {
                if (accounts)
                  await transact(
                    [
                      instruction(
                        "requestWithdraw",
                        accounts,
                        parseTokens(amount),
                      ),
                    ],
                    "Withdrawal requested. Mining amount reduced immediately.",
                  );
              },
              !ready || locked === 0n,
              true,
            )
          )}
          <Text accessibilityLiveRegion="polite" style={styles.message}>
            {busy ? "◌ " : ""}
            {message}
          </Text>
          {!!refreshError && (
            <Text accessibilityLiveRegion="polite" style={styles.error}>
              {refreshError}
            </Text>
          )}
          {!!error && (
            <Text
              accessibilityLiveRegion="assertive"
              selectable
              style={styles.error}
            >
              {error}
              {signature
                ? "\nSubmission status may be uncertain. Refresh before retrying."
                : ""}
            </Text>
          )}
          {!!signature && (
            <Text selectable style={styles.signature}>
              TX: {signature}
            </Text>
          )}
          {owner && (
            <View>
              {button(
                "REFRESH",
                async () => {
                  await refresh();
                  setMessage("On-chain state refreshed.");
                },
                false,
                true,
              )}
              {button(
                "DISCONNECT / RESET SESSION",
                async () => {
                  selectOwner(null);
                  await disconnectWallet();
                },
                false,
                true,
              )}
            </View>
          )}
          <Text style={styles.footer}>
            Not audited. Hackathon/dev software.{"\n"}Test network only.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#11160f" },
  content: {
    padding: 22,
    gap: 14,
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
  },
  top: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.5,
    color: "#99a58b",
    fontWeight: "700",
  },
  badge: {
    fontSize: 10,
    color: "#c6f078",
    borderWidth: 1,
    borderColor: "#485638",
    borderRadius: 5,
    padding: 5,
  },
  title: {
    fontSize: 32,
    fontWeight: "900",
    color: "#f0f0df",
    letterSpacing: -1,
  },
  subtitle: { color: "#a4af99", fontSize: 13, marginTop: -7 },
  wallet: { flexDirection: "row", gap: 8, alignItems: "center" },
  dot: { height: 7, width: 7, borderRadius: 4, backgroundColor: "#96a67c" },
  walletText: { color: "#a4af99", fontSize: 12, flexShrink: 1 },
  panel: {
    backgroundColor: "#20251c",
    borderWidth: 1,
    borderColor: "#333f29",
    borderRadius: 20,
    padding: 14,
    gap: 6,
  },
  active: { fontSize: 10, color: "#c6f078" },
  tier: { color: "#eef3df", fontSize: 21, fontWeight: "800" },
  rate: { color: "#c6f078", fontSize: 18, fontWeight: "800" },
  note: { color: "#99a58b", fontSize: 12, lineHeight: 18 },
  hint: { color: "#d9dfca", fontSize: 14, lineHeight: 21 },
  stats: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    gap: 12,
    flexWrap: "wrap",
  },
  label: { fontSize: 10, letterSpacing: 1, color: "#99a58b" },
  number: { color: "#eef3df", fontSize: 26, fontWeight: "700", marginTop: 7 },
  button: {
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: "#c6f078",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
  },
  secondary: {
    backgroundColor: "#222b1c",
    borderWidth: 1,
    borderColor: "#3f4b34",
  },
  disabled: { opacity: 0.4 },
  buttonText: {
    color: "#1b2512",
    fontWeight: "800",
    fontSize: 13,
    letterSpacing: 1,
  },
  sectionLabel: {
    color: "#99a58b",
    fontSize: 11,
    letterSpacing: 1.5,
    marginTop: 12,
  },
  presets: { flexDirection: "row", gap: 8 },
  preset: {
    flex: 1,
    minHeight: 44,
    backgroundColor: "#222b1c",
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  presetText: { color: "#d9dfca", fontWeight: "700" },
  input: {
    borderWidth: 1,
    borderColor: "#465239",
    borderRadius: 10,
    color: "#eef3df",
    fontSize: 22,
    padding: 14,
  },
  withdraw: { gap: 10 },
  message: { color: "#d9efb4", fontSize: 14, lineHeight: 22 },
  error: {
    color: "#ffad91",
    backgroundColor: "#39261f",
    borderRadius: 10,
    padding: 12,
    lineHeight: 20,
  },
  signature: { color: "#99a58b", fontSize: 11 },
  footer: {
    textAlign: "center",
    color: "#6f7b64",
    fontSize: 11,
    lineHeight: 19,
    marginVertical: 18,
  },
});
