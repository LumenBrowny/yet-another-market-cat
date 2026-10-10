import type { CatState } from "./types";
import type { YamcSpriteId } from "./yamc";
export const QUIET_TIERS: readonly CatState[] = [
  "CALM",
  "SUSPICIOUS",
  "ACTIVE",
  "CONCERNED",
  "DISTRESSED",
];
/** Uses real playback time, never attempts or simulation time. */
export class MeowMouth {
  private until = 0;
  start(now: number) {
    this.until = now + 0.5;
  }
  reset() {
    this.until = 0;
  }
  open(now: number) {
    return now < this.until;
  }
}
export function artworkKey(
  sprite: YamcSpriteId,
  tier: CatState,
  meow: boolean,
  purr: "left" | "right" = "right",
): string {
  if (sprite === "bonk-impact") return sprite;
  if (tier === "DEAD_INSIDE") return `${purr}-purr`;
  if (
    ["back", "falling", "upward-thrust", "transcendent-panic"].includes(sprite)
  )
    return sprite;
  return `${sprite}-${QUIET_TIERS.includes(tier) ? (meow ? "open" : "closed") : "open"}`;
}
