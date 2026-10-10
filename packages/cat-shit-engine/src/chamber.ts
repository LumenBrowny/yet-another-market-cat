import type { CatState } from "./types";
import { SeededRandom } from "./math";

export type RoomState = "IDLE" | "NOTICE" | "PANIC" | "DISASTER";
export type CharacterPose = "normal" | "notice" | "panic" | "disaster";
export interface RoomPresentation {
  id: RoomState;
  pose: CharacterPose;
  lamp: string;
  bars: number;
  floorCoins: number;
  bowlCoins: number;
  monitor: "chart" | "spike" | "warning" | "crash";
  description: string;
}

// Presentation only. Never reflects a wallet balance, claim or publisher state.
export const ROOM_STATES: Readonly<
  Record<RoomState, Readonly<RoomPresentation>>
> = {
  IDLE: {
    id: "IDLE",
    pose: "normal",
    lamp: "#91ae79",
    bars: 1,
    floorCoins: 2,
    bowlCoins: 7,
    monitor: "chart",
    description:
      "Quiet trader room. Seated trader, full coin bowl, green indicator.",
  },
  NOTICE: {
    id: "NOTICE",
    pose: "notice",
    lamp: "#d4b65d",
    bars: 2,
    floorCoins: 8,
    bowlCoins: 5,
    monitor: "spike",
    description:
      "Trader turns toward Yamc. Spilled coins and a yellow indicator.",
  },
  PANIC: {
    id: "PANIC",
    pose: "panic",
    lamp: "#d48c52",
    bars: 3,
    floorCoins: 18,
    bowlCoins: 3,
    monitor: "warning",
    description:
      "Trader shields his head. Scattered coins and an orange warning.",
  },
  DISASTER: {
    id: "DISASTER",
    pose: "disaster",
    lamp: "#c45d4f",
    bars: 4,
    floorCoins: 32,
    bowlCoins: 1,
    monitor: "crash",
    description:
      "Trader crawls after coins. Spilled bowl and red overload indicator.",
  },
};

const ROOM_FOR_TIER: Record<CatState, RoomState> = {
  DEAD_INSIDE: "IDLE",
  CALM: "IDLE",
  SUSPICIOUS: "IDLE",
  ACTIVE: "IDLE",
  CONCERNED: "NOTICE",
  DISTRESSED: "NOTICE",
  AIRBORNE: "PANIC",
  PANIC: "PANIC",
  OVERDRIVE: "DISASTER",
  TRANSCENDENT: "DISASTER",
};
const LOAF_ROOM: Readonly<RoomPresentation> = {
  ...ROOM_STATES.IDLE,
  floorCoins: 0,
};
export function roomForTier(tier: CatState): Readonly<RoomPresentation> {
  return tier === "DEAD_INSIDE" ? LOAF_ROOM : ROOM_STATES[ROOM_FOR_TIER[tier]];
}

// Fixed scatter: stable through rerenders and tier changes, bounded visual dressing.
// Deliberately concentrated at the sides; central flight space stays clear.
const scatterRandom = new SeededRandom(11002);
export const FLOOR_COINS = Array.from({ length: 32 }, (_, i) => {
  const z = scatterRandom.next();
  const left = i % 3 === 0;
  return {
    x: left ? 53 + scatterRandom.next() * 56 : 228 + scatterRandom.next() * 60,
    y: 246 + z * 31,
    radius: 2.6 + z * 1.8,
    tilt: scatterRandom.next() * 50 - 25,
  };
});
