/* eslint-disable @typescript-eslint/no-require-imports -- Metro cached artwork. */
import React, { memo, useEffect, useRef, useState } from "react";
import { G, Path, Rect, Circle, Text } from "react-native-svg";
import { AppState, Image as NativeImage, View } from "react-native";
import { roomForTier } from "@yac/cat-shit-engine/src/chamber";
import type { CatState } from "@yac/cat-shit-engine";
import { CHAMBER_LAYOUT as L } from "./layout";
import { MODULAR_PLATES, LOOP_ART } from "./modular-assets";
import SCENE from "./scene-011a.json";
import { loopFrame } from "./loops";
import type { RoomState } from "@yac/cat-shit-engine/src/chamber";
import { EXPORTED_LAYOUT } from "./exported-layout";
import { ExportedChamber } from "./ExportedChamber";

// Independent component state: a prop swap does not re-render the cat/PP tree.
const RoomLoops = memo(function RoomLoops({
  state,
  scale,
  paused,
}: {
  state: RoomState;
  scale: number;
  paused: boolean;
}) {
  const [active, setActive] = useState(AppState.currentState === "active");
  const [elapsed, setElapsed] = useState(0);
  const accumulated = useRef(0);
  const timings = SCENE.states[state];
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) =>
      setActive(s === "active"),
    );
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (paused || !active) return;
    const start = performance.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const now = accumulated.current + performance.now() - start;
      setElapsed(now);
      const next = Math.min(
        ...[timings.characterMs, timings.monitorMs, timings.indicatorMs].map(
          (ds) => loopFrame(now, ds).remaining,
        ),
      );
      timer = setTimeout(tick, Math.max(16, Math.ceil(next)));
    };
    tick();
    return () => {
      clearTimeout(timer);
      accumulated.current += performance.now() - start;
    };
  }, [paused, active, timings]);
  return (
    <>
      {(["character", "monitor", "indicator"] as const).map((kind) => {
        const rect =
          kind === "character" ? SCENE.character[state] : SCENE[kind];
        const frame = loopFrame(elapsed, timings[`${kind}Ms`]).index;
        return (
          <NativeImage
            key={kind}
            source={LOOP_ART[state][kind][frame]}
            fadeDuration={0}
            resizeMode="stretch"
            style={{
              position: "absolute",
              left: rect.x * scale,
              top: rect.y * scale,
              width: rect.width * scale,
              height: rect.height * scale,
            }}
          />
        );
      })}
    </>
  );
});

// Generated from ChamberArtwork.tsx. One texture instead of repainting hundreds
// of static SVG nodes inside the cat's animated canvas on every frame.
const PLATES = {
  loaf: require("../../assets/chamber-v2/plates/loaf.png"),
  IDLE: require("../../assets/chamber-v2/plates/idle.png"),
  NOTICE: require("../../assets/chamber-v2/plates/notice.png"),
  PANIC: require("../../assets/chamber-v2/plates/panic.png"),
  DISASTER: require("../../assets/chamber-v2/plates/disaster.png"),
};
export const ChamberEnvironment = memo(function ChamberEnvironment({
  tier,
  viewportWidth,
  cameraX,
  cameraY,
  paused = false,
  legacy = false,
}: {
  tier: CatState;
  viewportWidth: number;
  cameraX: number;
  cameraY: number;
  paused?: boolean;
  legacy?: boolean;
}) {
  const key = tier === "DEAD_INSIDE" ? "loaf" : roomForTier(tier).id;
  // Match SVG's xMidYMid meet, including letterboxing on narrow/wide phones.
  const scale = Math.min(viewportWidth / L.room.width, 1);
  const width = L.room.width * scale,
    height = L.room.height * scale;
  return (
    <View
      pointerEvents="none"
      renderToHardwareTextureAndroid
      style={{
        position: "absolute",
        width,
        height,
        left: (viewportWidth - width) / 2,
        top: (L.room.height - height) / 2,
        transform: [
          { translateX: cameraX * width },
          { translateY: cameraY * height },
        ],
      }}
    >
      {!legacy && EXPORTED_LAYOUT ? (
        <ExportedChamber
          key={key}
          layers={EXPORTED_LAYOUT[key]}
          scale={scale}
          paused={paused}
        />
      ) : (
        <>
          <NativeImage
            source={legacy ? PLATES[key] : MODULAR_PLATES[key]}
            resizeMode="stretch"
            fadeDuration={0}
            style={{ width, height }}
          />
          {!legacy && (
            <RoomLoops
              key={roomForTier(tier).id}
              state={roomForTier(tier).id}
              scale={scale}
              paused={paused}
            />
          )}
        </>
      )}
    </View>
  );
});

// Frame belongs to the viewer; the world and cat shake together behind it.
export const ChamberFrame = memo(function ChamberFrame({
  tier,
}: {
  tier: CatState;
}) {
  const room = roomForTier(tier);
  return (
    <G>
      <Path
        d="M3 34V5H30M310 5H337V34M3 265V287H24M316 287H337V265"
        fill="none"
        stroke="#2c3630"
        strokeWidth={5}
      />
      <Rect
        x={15}
        y={11}
        width={207}
        height={20}
        rx={3}
        fill="#1c2924"
        stroke="#756e51"
        strokeWidth={0.7}
      />
      <Text x={24} y={24.5} fontSize={8.4} letterSpacing={0.55} fill="#bcbaa2">
        CONTAINMENT CHAMBER / 002
      </Text>
      <Path
        d="M15 34H70M20 31l-3 6M30 31l-3 6M40 31l-3 6M50 31l-3 6M60 31l-3 6"
        stroke="#958252"
        strokeWidth={2}
        opacity={0.7}
      />
      <Circle cx={321} cy={21} r={4} fill={room.lamp} />
      {room.id === "DISASTER" && (
        <Path
          d="M328 36l-9 9 3 8-12 6M319 45l-7-2"
          stroke="#adb6a0"
          strokeWidth={0.8}
          opacity={0.45}
          fill="none"
        />
      )}
    </G>
  );
});
