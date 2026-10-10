import React, { memo } from "react";
import { G, Path, Rect, Ellipse, Circle, Image } from "react-native-svg";
import {
  FLOOR_COINS,
  roomForTier,
  type RoomPresentation,
} from "@yac/cat-shit-engine/src/chamber";
import type { CatState } from "@yac/cat-shit-engine";
import { CHAMBER_ART } from "./assets";
import { CHAMBER_LAYOUT as L } from "./layout";

function Coin({
  x,
  y,
  radius = 3,
  tilt = 0,
}: {
  x: number;
  y: number;
  radius?: number;
  tilt?: number;
}) {
  return (
    <G transform={`translate(${x} ${y}) rotate(${tilt})`}>
      <Ellipse
        cy={1.3}
        rx={radius + 1}
        ry={radius * 0.5}
        fill="#1c1913"
        opacity={0.4}
      />
      <Ellipse cy={0.7} rx={radius} ry={radius * 0.52} fill="#66512c" />
      <Ellipse
        rx={radius}
        ry={radius * 0.48}
        fill="#b29a55"
        stroke="#d0b873"
        strokeWidth={0.5}
      />
      <Path
        d={`M${-radius * 0.35} 0h${radius * 0.7}`}
        stroke="#756133"
        strokeWidth={0.7}
      />
    </G>
  );
}

function Monitor({ room }: { room: Readonly<RoomPresentation> }) {
  const { x, y, width, height } = L.monitor;
  const danger = room.monitor === "warning" || room.monitor === "crash";
  return (
    <G transform={`translate(${x} ${y})`}>
      <Rect
        x={-2}
        y={-2}
        width={width + 4}
        height={height + 4}
        rx={2}
        fill={room.lamp}
        opacity={0.11}
      />
      <Rect width={width} height={height} rx={1} fill="#15221f" />
      <Path
        d="M2 8H30M2 15H30M9 3V22M19 3V22"
        stroke="#35443b"
        strokeWidth={0.5}
      />
      <Path
        d={
          room.monitor === "chart"
            ? "M2 19L7 17L11 19L16 13L20 15L24 9L29 10"
            : room.monitor === "spike"
              ? "M2 21L7 20L11 17L16 18L20 11L24 13L29 3"
              : "M2 5L8 4L13 8L18 7L23 21L29 23"
        }
        fill="none"
        stroke={room.lamp}
        strokeWidth={1.5}
      />
      {danger ? (
        <G>
          <Path
            d="M18 4L26 18H10Z"
            fill="#b99152"
            stroke="#222c26"
            strokeWidth={1}
          />
          <Path d="M18 8V12M18 14V15" stroke="#332921" strokeWidth={1.8} />
        </G>
      ) : (
        <Rect x={2} y={23} width={10} height={2} rx={1} fill={room.lamp} />
      )}
    </G>
  );
}

function Indicator({ room }: { room: Readonly<RoomPresentation> }) {
  const { x, y, width, height } = L.indicator;
  return (
    <G transform={`translate(${x} ${y})`}>
      <Rect
        x={-4}
        y={-4}
        width={width + 8}
        height={height + 8}
        rx={5}
        fill={room.lamp}
        opacity={0.09}
      />
      <Rect
        width={width}
        height={height}
        rx={2}
        fill="#202a25"
        stroke="#7c7760"
        strokeWidth={1}
      />
      <Circle cx={width / 2} cy={8} r={4} fill={room.lamp} />
      {[0, 1, 2, 3].map((i) => (
        <Rect
          key={i}
          x={4}
          y={height - 10 - i * 8}
          width={width - 8}
          height={5}
          rx={1}
          fill={i < room.bars ? room.lamp : "#384039"}
        />
      ))}
    </G>
  );
}

function Bowl({ room }: { room: Readonly<RoomPresentation> }) {
  return (
    <G
      transform={`translate(${L.bowl.x} ${L.bowl.y}) rotate(${room.id === "DISASTER" ? 13 : 0})`}
    >
      <Ellipse cy={12} rx={25} ry={6} fill="#141b16" opacity={0.5} />
      <Path
        d="M-23 -2L-17 12Q0 21 17 12L23 -2Z"
        fill="#616e67"
        stroke="#242e28"
        strokeWidth={1.5}
      />
      <Path
        d="M-18 3L-13 11Q0 16 13 11L17 3"
        fill="none"
        stroke="#89958a"
        strokeWidth={2}
      />
      <Ellipse
        rx={23}
        ry={8}
        fill="#9a9d86"
        stroke="#333e32"
        strokeWidth={1.5}
      />
      <Ellipse rx={19} ry={5.6} fill="#343d2c" />
      {Array.from({ length: room.bowlCoins }, (_, i) => (
        <Coin
          key={i}
          x={-12 + ((i * 9) % 25)}
          y={-2 + Math.floor(i / 3) * 2}
          radius={4.5}
          tilt={i % 2 ? 13 : -10}
        />
      ))}
      <Path
        d="M-20 2Q0 12 20 2"
        fill="none"
        stroke="#bac1a7"
        strokeWidth={1.8}
      />
      {/* One readable paw-shaped bowl stamp, no tiny explanatory text. */}
      <Ellipse cx={0} cy={10} rx={3} ry={2.3} fill="#303e33" />
      <Circle cx={-4} cy={7} r={1.4} fill="#303e33" />
      <Circle cx={0} cy={6} r={1.4} fill="#303e33" />
      <Circle cx={4} cy={7} r={1.4} fill="#303e33" />
    </G>
  );
}

// Only tier changes render this subtree; no clock, subscriptions, RPC or random.
export const ChamberArtwork = memo(function ChamberArtwork({
  tier,
}: {
  tier: CatState;
}) {
  const room = roomForTier(tier);
  return (
    <G>
      <Image href={CHAMBER_ART.room} {...L.room} preserveAspectRatio="none" />
      <Rect {...L.room} fill="#0e1b19" opacity={0.15} />
      <Monitor room={room} />
      <Indicator room={room} />
      {FLOOR_COINS.slice(0, room.floorCoins).map((coin, i) => (
        <Coin key={i} {...coin} />
      ))}
      <Image
        href={CHAMBER_ART[room.pose]}
        {...L.character[room.pose]}
        preserveAspectRatio="xMidYMax meet"
        opacity={0.94}
      />
      {room.id === "DISASTER" && (
        <G>
          <Coin x={171} y={255} radius={4} />
          <Coin x={181} y={261} radius={3.5} />
          <Path
            d="M36 226L53 221L56 234L41 240Z"
            fill="#887c5e"
            stroke="#453f31"
          />
          <Path
            d="M300 194l-9 9 7 6-8 12"
            stroke="#272e27"
            fill="none"
            strokeWidth={2}
          />
        </G>
      )}
      <Bowl room={room} />
    </G>
  );
});
