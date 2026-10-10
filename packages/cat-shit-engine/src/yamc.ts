import manifest from "./yamc-manifest.json";
import purrAnchors from "./yamc-purr-anchors.json";
import type { CatBodyState, CatState, Vec3 } from "./types";
import { perspectiveScale } from "./math";

export const YAMC_DIRECTIONS = [
  "front",
  "front-right",
  "right",
  "back-right",
  "back",
  "back-left",
  "left",
  "front-left",
] as const;
export type YamcDirection = (typeof YAMC_DIRECTIONS)[number];
export type YamcSpriteId =
  | YamcDirection
  | "upward-thrust"
  | "falling"
  | "bonk-impact"
  | "transcendent-panic";
export type MotionGroup =
  "calm" | "working" | "boosted" | "airborne" | "transcendent";
export type Anchor = { x: number; y: number };
export interface YamcSprite {
  id: YamcSpriteId;
  imagePath: string;
  direction: YamcDirection;
  defaultScale: number;
  zScaleBias: number;
  rearAnchor: Anchor;
  centerAnchor: Anchor;
  shadowAnchor: Anchor;
  mouthAnchor?: Anchor;
  rotationBias: number;
}
export const YAMC_VIEW = {
  width: 340,
  height: 290,
  spriteSize: 128,
  projection: 0.3,
} as const;
// Normalized coordinates on the full transparent canvas, not cropped ink bounds.
export const YAMC_SPRITES = manifest as Record<YamcSpriteId, YamcSprite>;
/** Purr uses the side pose's scale, but its own full-canvas anchors. */
export const YAMC_PURR_SPRITES: Record<"left" | "right", YamcSprite> = {
  left: {
    ...YAMC_SPRITES.left,
    ...purrAnchors["left-purr"],
    imagePath: "yamc/left-purr.png",
  },
  right: {
    ...YAMC_SPRITES.right,
    ...purrAnchors["right-purr"],
    imagePath: "yamc/right-purr.png",
  },
};
export function renderSpriteMetadata(
  id: YamcSpriteId,
  tier: CatState,
  purrSide: "left" | "right",
): YamcSprite {
  return tier === "DEAD_INSIDE" && id !== "bonk-impact"
    ? YAMC_PURR_SPRITES[purrSide]
    : YAMC_SPRITES[id];
}
export const MOTION_GROUP: Record<CatState, MotionGroup> = {
  DEAD_INSIDE: "calm",
  CALM: "calm",
  SUSPICIOUS: "working",
  ACTIVE: "working",
  CONCERNED: "boosted",
  DISTRESSED: "boosted",
  AIRBORNE: "airborne",
  PANIC: "airborne",
  OVERDRIVE: "airborne",
  TRANSCENDENT: "transcendent",
};
export interface YamcPresentation {
  direction: YamcDirection;
  motion: MotionGroup;
  expression: "anxious" | "strained" | "panic" | "dazed";
  spriteId: YamcSpriteId;
}
/** Stateful direction choice lives in simulation time, never mutates from render/snapshot. */
export class YamcSelector {
  private direction: YamcDirection = "front";
  private filtered = { x: 0, z: 0 };
  private held = 1;
  private special: YamcSpriteId | null = null;
  private specialHeld = 1;
  update(
    velocity: Vec3,
    state: CatState,
    bonk: boolean,
    dt: number,
  ): YamcPresentation {
    const blend = 1 - Math.exp(-Math.max(0, dt) / 0.16);
    this.filtered.x += (velocity.x - this.filtered.x) * blend;
    this.filtered.z += (velocity.z - this.filtered.z) * blend;
    this.held += dt;
    const angle = Math.atan2(this.filtered.x, this.filtered.z);
    const current = (YAMC_DIRECTIONS.indexOf(this.direction) * Math.PI) / 4;
    const delta = Math.atan2(
      Math.sin(angle - current),
      Math.cos(angle - current),
    );
    if (
      Math.hypot(this.filtered.x, this.filtered.z) > 0.12 &&
      Math.abs(delta) > Math.PI / 8 + 0.14 &&
      this.held >= 0.22
    ) {
      this.direction =
        YAMC_DIRECTIONS[(Math.round(angle / (Math.PI / 4)) + 8) % 8];
      this.held = 0;
    }
    const motion = MOTION_GROUP[state];
    this.specialHeld += dt;
    const candidate =
      motion === "transcendent"
        ? "transcendent-panic"
        : motion === "airborne" && velocity.y < -0.6
          ? "upward-thrust"
          : motion === "airborne" && velocity.y > 0.6
            ? "falling"
            : null;
    if (candidate !== this.special && this.specialHeld > 0.3) {
      this.special = candidate;
      this.specialHeld = 0;
    }
    return {
      direction: this.direction,
      motion,
      expression: bonk
        ? "dazed"
        : motion === "transcendent" || motion === "airborne"
          ? "panic"
          : motion === "boosted"
            ? "strained"
            : "anxious",
      spriteId: bonk ? "bonk-impact" : (this.special ?? this.direction),
    };
  }
}
export function spriteScale(body: CatBodyState, sprite: YamcSprite) {
  return (
    perspectiveScale(body.position.z) *
    sprite.defaultScale *
    (1 + sprite.zScaleBias * body.position.z)
  );
}
/** Inverse of the exact SVG transform/projection, including perspective and squash. */
export function anchorWorld(
  body: CatBodyState,
  sprite: YamcSprite,
  anchor: Anchor,
): Vec3 {
  const scale = spriteScale(body, sprite) * YAMC_VIEW.spriteSize;
  const x = (anchor.x - sprite.centerAnchor.x) * scale * body.squashX;
  const y = (anchor.y - sprite.centerAnchor.y) * scale * body.squashY;
  const angle = body.rotation + sprite.rotationBias;
  return {
    x:
      body.position.x +
      (x * Math.cos(angle) - y * Math.sin(angle)) /
        (YAMC_VIEW.width * YAMC_VIEW.projection),
    y:
      body.position.y +
      (x * Math.sin(angle) + y * Math.cos(angle)) /
        (YAMC_VIEW.height * YAMC_VIEW.projection),
    z: body.position.z,
  };
}
