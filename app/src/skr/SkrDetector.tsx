/* eslint-disable @typescript-eslint/no-require-imports -- Metro sprite assets. */
import React, { memo, useEffect, useRef, useState } from "react";
import { AppState, Image, Pressable, View } from "react-native";
import { loopFrame } from "../chamber/loops";

const OFF = require("../../assets/skr-detector/detector-off.png");
const ON = require("../../assets/skr-detector/detector-on.png");
const ROOM = [
  require("../../assets/skr-detector/detector-on-frame-1.png"),
  require("../../assets/skr-detector/detector-on-frame-2.png"),
];
const CLUB = [
  require("../../assets/skr-detector/club-neon-frame-1.png"),
  require("../../assets/skr-detector/club-neon-frame-2.png"),
];
const ROOM_TIMES = [3000, 400, 100, 200];
const CLUB_TIMES = [952, 952];

export const SkrDetector = memo(function SkrDetector({
  width,
  status,
  club,
  arming,
  onPress,
  onRefresh,
  paused = false,
  layer = "touch",
}: {
  width: number;
  status: string;
  club: boolean;
  arming: boolean;
  onPress: () => void;
  onRefresh: () => void;
  paused?: boolean;
  layer?: "art" | "touch";
}) {
  const [active, setActive] = useState(AppState.currentState === "active");
  const [frame, setFrame] = useState(0);
  const elapsed = useRef(0);
  const found = status === "found";
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => sub.remove();
  }, []);
  useEffect(() => {
    elapsed.current = 0;
    setFrame(0);
  }, [club, found]);
  useEffect(() => {
    if (layer !== "art" || !active || paused || !found) return;
    const start = performance.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const next = loopFrame(
        elapsed.current + performance.now() - start,
        club ? CLUB_TIMES : ROOM_TIMES,
      );
      setFrame(next.index % 2);
      timer = setTimeout(tick, Math.max(16, Math.ceil(next.remaining)));
    };
    tick();
    return () => {
      clearTimeout(timer);
      elapsed.current += performance.now() - start;
    };
  }, [active, paused, found, club, layer]);
  const s = Math.min(width / 340, 1);
  const left = (width - 340 * s) / 2,
    top = (290 - 290 * s) / 2;
  const x = club ? 198 : 199,
    y = club ? 37 : 36;
  const w = club ? 30 : 32.5,
    h = club ? 24 : 25;
  const touchWidth = Math.max(44, w * s),
    touchHeight = Math.max(44, h * s);
  const label = arming
    ? "OVERRIDE"
    : club
      ? "RETURN READY"
      : found
        ? "SKR DETECTED"
        : status === "absent"
          ? "NO SKR"
          : status === "checking"
            ? "SCANNING"
            : status === "offline"
              ? "NO WALLET"
              : "NO SIGNAL";
  return (
    <View
      pointerEvents={layer === "art" ? "none" : "box-none"}
      style={{ position: "absolute", inset: 0 }}
    >
      {layer === "art" && !club && (
        <Image
          source={found ? ON : OFF}
          fadeDuration={0}
          resizeMode="stretch"
          style={{
            position: "absolute",
            left: left + 190 * s,
            top: top + 35 * s,
            width: (found ? 45.5 : 43) * s,
            height: 46 * s,
          }}
        />
      )}
      {layer === "art" && found && (
        <Image
          source={(club ? CLUB : ROOM)[frame]}
          fadeDuration={0}
          resizeMode="stretch"
          style={{
            position: "absolute",
            left: left + x * s,
            top: top + y * s,
            width: w * s,
            height: h * s,
          }}
        />
      )}
      {layer === "touch" && arming && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "#b882ed",
            opacity: 0.14,
          }}
        />
      )}
      {/* One stable transparent touch target; animation frames never own handlers. */}
      {layer === "touch" && (
        <Pressable
          testID="skr-detector"
          accessibilityRole="button"
          accessibilityLabel={`SKR detector. ${label}`}
          accessibilityHint="Nine taps within four seconds to switch rooms when eligible. Long press to refresh mainnet detection."
          onPress={onPress}
          onLongPress={onRefresh}
          delayLongPress={650}
          style={{
            position: "absolute",
            left: left + (x + w / 2) * s - touchWidth / 2,
            top: top + (y + h / 2) * s - touchHeight / 2,
            width: touchWidth,
            height: touchHeight,
          }}
        />
      )}
    </View>
  );
});
