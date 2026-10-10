import type { CatState } from "./types";
export interface CatPhysicsProfile {
  poopRate: number;
  pressure: number;
  thrustMin: number;
  thrustMax: number;
  linearDamping: number;
  angularDamping: number;
  turbulence: number;
  angularImpulse: number;
  maxSpeed: number;
  maxAngularSpeed: number;
  restoring: number;
  gravity: number;
  restitution: number;
  depthThrust: number;
  upwardBias: number;
  cameraShakeMultiplier: number;
  splatProbability: number;
  particleSize: number;
  cluster: number;
  streamProbability: number;
  specialInterval: number;
}
// Visual tuning only; economic thresholds remain in shared. Values are not PP accounting.
function profile(
  m: number,
  drag: number,
  turbulence: number,
  restoring: number,
): CatPhysicsProfile {
  const pressure = m ** 1.2;
  return Object.freeze({
    poopRate: m,
    pressure,
    thrustMin: pressure * 0.022,
    thrustMax: pressure * 0.038,
    linearDamping: drag,
    angularDamping: Math.max(0.8, drag * 0.65),
    turbulence,
    angularImpulse: pressure * 0.1,
    maxSpeed: Math.max(0.4, Math.sqrt(m) * 1.5),
    maxAngularSpeed: Math.max(0.4, Math.sqrt(m) * 2),
    restoring,
    gravity: 0.12,
    restitution: 0.48 + Math.min(m, 25) * 0.008,
    depthThrust: Math.min(0.8, m * 0.08),
    upwardBias: Math.max(0.05, 0.65 - m * 0.05),
    cameraShakeMultiplier: Math.min(1, m / 12),
    splatProbability: Math.min(0.8, m / 30),
    particleSize: 0.018 + Math.sqrt(m) * 0.006,
    cluster: m >= 3 ? 2 : 1,
    streamProbability: Math.max(0, Math.min(0.95, (m - 3) / 18)),
    specialInterval: m === 25 ? 18 : m === 20 ? 35 : 0,
  });
}
export const PROFILES: Readonly<Record<CatState, CatPhysicsProfile>> =
  Object.freeze({
    DEAD_INSIDE: profile(0, 10, 0, 6),
    CALM: profile(1, 8, 0.008, 4),
    SUSPICIOUS: profile(1.5, 5, 0.025, 2.5),
    ACTIVE: profile(2, 2, 0.1, 0.55),
    CONCERNED: profile(3, 1.3, 0.25, 0.2),
    DISTRESSED: profile(5, 0.85, 0.45, 0.08),
    AIRBORNE: profile(8, 0.5, 0.7, 0.03),
    PANIC: profile(12, 0.4, 1.4, 0.015),
    OVERDRIVE: profile(20, 0.3, 2, 0.01),
    TRANSCENDENT: profile(25, 0.25, 2.5, 0.01),
  });
export const LIMITS = Object.freeze({
  particles: 120,
  splats: 10,
  events: 128,
  fixedStep: 1 / 60,
  maxFrameDelta: 0.1,
  impactDuration: 0.1,
  recoverDuration: 0.2,
  bonkThreshold: 0.65,
  splatLifetime: 5,
  particleLifetime: 1.6,
  maxShake: 0.025,
});
