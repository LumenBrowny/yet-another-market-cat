import type { CatBodyState, Direction, Plane, Vec3 } from "./types";
export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
export const length = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
export function limit(v: Vec3, max: number) {
  const n = length(v);
  if (n > max) {
    v.x *= max / n;
    v.y *= max / n;
    v.z *= max / n;
  }
}
export function perspectiveScale(z: number) {
  return 0.45 + clamp(Number.isFinite(z) ? z : 0.5, 0, 1) * 1.35;
}
export function project(p: Vec3) {
  return {
    x: 0.5 + p.x * 0.3,
    y: 0.5 + p.y * 0.3,
    scale: perspectiveScale(p.z),
  };
}
export function directionFor(v: Vec3, fallback: number): Direction {
  const angle = Math.hypot(v.x, v.y) > 0.06 ? Math.atan2(v.y, v.x) : fallback;
  return (["E", "SE", "S", "SW", "W", "NW", "N", "NE"] as const)[
    ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8
  ];
}
export function createBody(): CatBodyState {
  return {
    position: { x: 0, y: 0.35, z: 0.35 },
    velocity: { x: 0, y: 0, z: 0 },
    rotation: 0,
    angularVelocity: 0,
    orientation: 0,
    squashX: 1,
    squashY: 1,
  };
}
export class SeededRandom {
  private value: number;
  constructor(seed: number) {
    this.value = seed >>> 0;
  }
  next() {
    let t = (this.value += 0x6d2b79f5);
    this.value >>>= 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  signed() {
    return this.next() * 2 - 1;
  }
}
export function collide(
  body: CatBodyState,
  restitution: number,
): { plane: Plane; speed: number }[] {
  const hits: { plane: Plane; speed: number }[] = [];
  for (const [axis, lo, hi, low, high] of [
    ["x", -1, 1, "left", "right"],
    ["y", -1, 1, "top", "bottom"],
    ["z", 0, 1, "rear", "front"],
  ] as const) {
    const p = body.position[axis],
      v = body.velocity[axis];
    if (p < lo || p > hi) {
      body.position[axis] = clamp(p, lo, hi);
      if ((p < lo && v < 0) || (p > hi && v > 0)) {
        body.velocity[axis] = -v * restitution;
        for (const tangent of ["x", "y", "z"] as const)
          if (tangent !== axis) body.velocity[tangent] *= 0.94;
        hits.push({ plane: p < lo ? low : high, speed: Math.abs(v) });
      }
    }
  }
  return hits;
}
