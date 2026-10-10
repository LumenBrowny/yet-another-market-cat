import type { CatState } from "@yac/shared";
export type { CatState } from "@yac/shared";
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface CatBodyState {
  position: Vec3;
  velocity: Vec3;
  rotation: number;
  angularVelocity: number;
  orientation: number;
  squashX: number;
  squashY: number;
}
export type Direction = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
export type Plane = "left" | "right" | "top" | "bottom" | "rear" | "front";
export type SpecialKind = "SHIT_PRESSURE_CRITICAL" | "CAT_ORBIT";
export interface ImpactState {
  age: number;
  strength: number;
  phase: "IMPACT" | "RECOVER";
}
export interface SpecialState {
  kind: SpecialKind;
  remaining: number;
}
export interface PoopParticle {
  id: number;
  position: Vec3;
  velocity: Vec3;
  age: number;
  lifetime: number;
  size: number;
  rotation: number;
  stream: boolean;
  /** Depth tie-break at emission, independent of the cat's subsequent turns. */
  emittedInFront: boolean;
}
export interface ScreenSplat {
  id: number;
  normalizedX: number;
  normalizedY: number;
  scale: number;
  rotation: number;
  age: number;
  opacity: number;
  dripOffset: number;
}
export type CatEngineEvent =
  | {
      type: "POOP";
      position: Vec3;
      direction: Vec3;
      intensity: number;
      tier: CatState;
      timestamp: number;
    }
  | { type: "COLLISION"; plane: Plane; speed: number; timestamp: number }
  | {
      type: "FRONT_IMPACT";
      x: number;
      y: number;
      impactVelocity: number;
      impactStrength: number;
      timestamp: number;
    }
  | { type: "SPLAT"; id: number; timestamp: number }
  | { type: "STATE_CHANGED"; state: CatState; timestamp: number }
  | { type: SpecialKind; timestamp: number }
  | { type: "SAFETY_RESET"; timestamp: number };
export interface CatSimulationState {
  body: CatBodyState;
  catState: CatState;
  simulationTime: number;
  poopAccumulator: number;
  impactState?: ImpactState;
  specialState?: SpecialState;
}
export interface CatRenderState extends CatSimulationState {
  presentation: import("./yamc").YamcPresentation;
  particles: readonly PoopParticle[];
  splats: readonly ScreenSplat[];
  direction: Direction;
  facing: "front" | "back" | "side";
  scale: number;
  camera: { x: number; y: number };
  message: string;
}
