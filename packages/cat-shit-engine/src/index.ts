import {
  YamcSelector,
  YAMC_SPRITES,
  anchorWorld,
  type YamcPresentation,
} from "./yamc";
export * from "./yamc";
import { PROFILES, LIMITS } from "./profiles";
import {
  clamp,
  collide,
  createBody,
  directionFor,
  length,
  limit,
  project,
  SeededRandom,
} from "./math";
import type {
  CatBodyState,
  CatEngineEvent,
  CatRenderState,
  CatSimulationState,
  CatState,
  PoopParticle,
  ScreenSplat,
  SpecialKind,
} from "./types";
export * from "./types";
export { PROFILES, LIMITS } from "./profiles";
export {
  perspectiveScale,
  project,
  directionFor,
  collide,
  createBody,
} from "./math";
export type CatEngineConfig = {
  seed: number;
  fixedStep: number;
  maxFrameDelta: number;
};
export class CatEngine {
  readonly config: CatEngineConfig;
  private rng: SeededRandom;
  private selector = new YamcSelector();
  private presentation: YamcPresentation = this.selector.update(
    { x: 0, y: 0, z: 0 },
    "DEAD_INSIDE",
    false,
    0,
  );
  private state: CatSimulationState = {
    body: createBody(),
    catState: "DEAD_INSIDE",
    simulationTime: 0,
    poopAccumulator: 0,
  };
  private accumulator = 0;
  private particles: PoopParticle[] = [];
  private splats: ScreenSplat[] = [];
  private events: CatEngineEvent[] = [];
  private serial = 0;
  private nextSpecial = 18;
  private specialCount = 0;
  private shake = 0;
  private message = "";
  private messageUntil = 0;
  private lastMessage = -10;
  constructor(config: Partial<CatEngineConfig> = {}) {
    this.config = {
      seed: 12345,
      fixedStep: LIMITS.fixedStep,
      maxFrameDelta: LIMITS.maxFrameDelta,
      ...config,
    };
    if (
      !Object.values(this.config).every(Number.isFinite) ||
      this.config.fixedStep < 1 / 240 ||
      this.config.fixedStep > 1 / 30 ||
      this.config.maxFrameDelta <= 0 ||
      this.config.maxFrameDelta > 0.25
    )
      throw new Error("Invalid simulation configuration");
    this.rng = new SeededRandom(this.config.seed);
  }
  setState(catState: CatState) {
    if (!PROFILES[catState]) throw new Error("Unknown cat state");
    if (catState === this.state.catState) return;
    this.state.catState = catState;
    this.presentation = this.selector.update(
      this.state.body.velocity,
      catState,
      false,
      1,
    );
    this.state.poopAccumulator = 0;
    this.state.specialState = undefined;
    this.nextSpecial = this.state.simulationTime + 12 + this.rng.next() * 12;
    if (catState === "DEAD_INSIDE") {
      this.state.body = createBody();
      this.particles.length = 0;
      this.state.impactState = undefined;
      this.shake = 0;
    }
    this.emit({
      type: "STATE_CHANGED",
      state: catState,
      timestamp: this.state.simulationTime,
    });
  }
  /** Explicit initial conditions for deterministic experiments; invalid input resets safely. */
  setBody(body: CatBodyState) {
    this.state.body = {
      ...body,
      position: { ...body.position },
      velocity: { ...body.velocity },
    };
    this.ensureSafe();
  }
  pause() {
    this.accumulator = 0;
    this.events.length = 0;
  }
  drainEvents(): CatEngineEvent[] {
    const batch = this.events;
    this.events = [];
    return batch;
  }
  private emit(event: CatEngineEvent) {
    if (this.events.length < LIMITS.events) this.events.push(event);
  }
  private announce(text: string, force = false) {
    const t = this.state.simulationTime;
    if (force || t - this.lastMessage > 3) {
      this.message = text;
      this.messageUntil = t + 1.7;
      this.lastMessage = t;
    }
  }
  triggerSpecial(kind: SpecialKind) {
    if (this.state.catState !== "TRANSCENDENT") return;
    this.state.specialState = { kind, remaining: 2.2 };
    this.state.body.angularVelocity += kind === "CAT_ORBIT" ? 3 : 5;
    this.shake = LIMITS.maxShake;
    this.emit({ type: kind, timestamp: this.state.simulationTime });
    this.announce(
      kind === "CAT_ORBIT"
        ? "CAT HAS ACHIEVED ORBIT"
        : "SHIT PRESSURE CRITICAL",
      true,
    );
  }
  advance(delta: number): CatRenderState {
    this.tick(delta);
    return this.snapshot();
  }
  /** Advance without allocating a render snapshot (tests/headless simulation). */
  tick(delta: number) {
    if (!Number.isFinite(delta) || delta < 0) {
      this.reset();
      return;
    }
    this.accumulator += Math.min(delta, this.config.maxFrameDelta);
    while (this.accumulator + 1e-12 >= this.config.fixedStep) {
      this.step(this.config.fixedStep);
      this.accumulator -= this.config.fixedStep;
    }
  }
  private reset() {
    this.state.body = createBody();
    this.state.impactState = undefined;
    this.state.specialState = undefined;
    this.state.poopAccumulator = 0;
    this.accumulator = 0;
    this.particles.length = 0;
    this.splats.length = 0;
    this.shake = 0;
    this.emit({ type: "SAFETY_RESET", timestamp: this.state.simulationTime });
  }
  private ensureSafe() {
    const b = this.state.body;
    if (
      ![
        ...Object.values(b.position),
        ...Object.values(b.velocity),
        b.rotation,
        b.angularVelocity,
        b.orientation,
        b.squashX,
        b.squashY,
      ].every(Number.isFinite) ||
      Math.max(
        Math.abs(b.position.x),
        Math.abs(b.position.y),
        Math.abs(b.position.z),
      ) > 10
    ) {
      this.reset();
      return;
    }
    const p = PROFILES[this.state.catState];
    limit(b.velocity, p.maxSpeed);
    b.angularVelocity = clamp(
      b.angularVelocity,
      -p.maxAngularSpeed,
      p.maxAngularSpeed,
    );
  }
  private step(dt: number) {
    this.ensureSafe();
    const s = this.state,
      b = s.body,
      p = PROFILES[s.catState];
    s.simulationTime += dt;
    this.updateEffects(dt);
    this.presentation = this.selector.update(
      b.velocity,
      s.catState,
      !!s.impactState,
      dt,
    );
    if (s.catState === "DEAD_INSIDE") return;
    this.updateSpecial(dt);
    const surge = s.specialState?.kind === "SHIT_PRESSURE_CRITICAL";
    s.poopAccumulator += p.poopRate * (surge ? 1.7 : 1) * dt;
    while (s.poopAccumulator + 1e-12 >= 1) {
      s.poopAccumulator -= 1;
      this.poop(surge ? 1.7 : 1);
    }
    // Body-local thrust direction slowly tumbles; this same direction feeds particles.
    b.orientation +=
      b.angularVelocity * dt * 0.7 + this.rng.signed() * p.turbulence * dt;
    for (const axis of ["x", "y", "z"] as const) {
      const rest = axis === "y" ? 0.35 : axis === "z" ? 0.35 : 0;
      b.velocity[axis] +=
        (this.rng.signed() * p.turbulence -
          p.restoring * (b.position[axis] - rest) +
          (axis === "y" ? p.gravity : 0)) *
        dt;
      b.velocity[axis] *= Math.exp(-p.linearDamping * dt);
    }
    b.angularVelocity -= Math.sin(b.rotation) * p.restoring * dt;
    b.angularVelocity *= Math.exp(-p.angularDamping * dt);
    limit(b.velocity, p.maxSpeed);
    b.angularVelocity = clamp(
      b.angularVelocity,
      -p.maxAngularSpeed,
      p.maxAngularSpeed,
    );
    for (const axis of ["x", "y", "z"] as const)
      b.position[axis] += b.velocity[axis] * dt;
    b.rotation = (b.rotation + b.angularVelocity * dt) % (Math.PI * 2);
    b.orientation %= Math.PI * 2;
    for (const hit of collide(b, p.restitution)) {
      this.emit({ type: "COLLISION", ...hit, timestamp: s.simulationTime });
      b.angularVelocity += this.rng.signed() * hit.speed * 0.15;
      if (hit.plane === "front" && hit.speed >= LIMITS.bonkThreshold)
        this.bonk(hit.speed);
    }
    this.ensureSafe();
  }
  private updateSpecial(dt: number) {
    const s = this.state,
      p = PROFILES[s.catState],
      b = s.body;
    if (s.specialState) {
      s.specialState.remaining -= dt;
      if (s.specialState.remaining <= 0) s.specialState = undefined;
      else if (s.specialState.kind === "CAT_ORBIT") {
        // Tangential drive plus a centripetal spring: forces, never a prescribed path.
        b.velocity.x += (-b.position.y * 8 - b.position.x * 2) * dt;
        b.velocity.y += (b.position.x * 8 - b.position.y * 2) * dt;
        b.velocity.z += Math.sin(s.simulationTime * 3) * dt;
      }
    } else if (p.specialInterval && s.simulationTime >= this.nextSpecial) {
      this.nextSpecial =
        s.simulationTime + p.specialInterval + this.rng.next() * 15;
      if (s.catState === "TRANSCENDENT")
        this.triggerSpecial(
          this.specialCount++ % 2 === 0
            ? "SHIT_PRESSURE_CRITICAL"
            : "CAT_ORBIT",
        );
      else {
        b.velocity.z += 2;
        b.angularVelocity += 2;
        this.announce("STRUCTURAL INTEGRITY QUESTIONABLE");
      }
    }
  }
  private poop(boost: number) {
    const s = this.state,
      b = s.body,
      p = PROFILES[s.catState];
    const angle = b.rotation;
    const sprite = YAMC_SPRITES[this.presentation.spriteId];
    const position = anchorWorld(b, sprite, sprite.rearAnchor);
    const direction = {
      x: position.x - b.position.x,
      y: position.y - b.position.y,
      z:
        (this.presentation.direction.startsWith("back")
          ? 1
          : this.presentation.direction.startsWith("front")
            ? -1
            : 0) *
        p.depthThrust *
        0.25,
    };
    const n = Math.max(0.001, length(direction));
    for (const axis of ["x", "y", "z"] as const) direction[axis] /= n;
    const thrust = { x: -direction.x, y: -direction.y, z: -direction.z };
    const intensity =
      (p.thrustMin + (p.thrustMax - p.thrustMin) * this.rng.next()) * boost;
    this.emit({
      type: "POOP",
      position: { ...position },
      direction,
      intensity,
      tier: s.catState,
      timestamp: s.simulationTime,
    });
    for (const axis of ["x", "y", "z"] as const)
      b.velocity[axis] += thrust[axis] * intensity;
    b.angularVelocity += this.rng.signed() * p.angularImpulse;
    for (let i = 0; i < p.cluster; i++) {
      const particle: PoopParticle = {
        id: this.serial++,
        position: { ...position },
        velocity: {
          x: b.velocity.x * 0.35 + direction.x * 0.7 + this.rng.signed() * 0.08,
          y: b.velocity.y * 0.35 + direction.y * 0.7,
          z: b.velocity.z * 0.35 + direction.z * 0.7,
        },
        age: 0,
        lifetime: LIMITS.particleLifetime,
        size: p.particleSize,
        rotation: angle,
        emittedInFront: this.presentation.direction.startsWith("back"),
        stream: i > 0 && (this.rng.next() < p.streamProbability || boost > 1),
      };
      if (particle.stream) {
        particle.lifetime = 0.28;
        particle.size *= 1.3;
      }
      if (this.particles.length === LIMITS.particles) this.particles.shift();
      this.particles.push(particle);
    }
  }
  private bonk(speed: number) {
    const s = this.state,
      p = PROFILES[s.catState],
      strength = clamp(speed / 4, 0.15, 1);
    s.impactState = { age: 0, strength, phase: "IMPACT" };
    this.presentation = this.selector.update(
      s.body.velocity,
      s.catState,
      true,
      0,
    );
    s.body.squashX = 1 + 0.38 * strength;
    s.body.squashY = 1 - 0.3 * strength;
    this.shake = Math.min(
      LIMITS.maxShake,
      strength * 0.025 * p.cameraShakeMultiplier,
    );
    this.emit({
      type: "FRONT_IMPACT",
      x: s.body.position.x,
      y: s.body.position.y,
      impactVelocity: speed,
      impactStrength: strength,
      timestamp: s.simulationTime,
    });
    this.announce("CAT IMPACT DETECTED");
    if (speed > 1 && this.rng.next() < p.splatProbability) {
      const projected = project(s.body.position),
        id = this.serial++;
      if (this.splats.length === LIMITS.splats) this.splats.shift();
      this.splats.push({
        id,
        normalizedX: projected.x,
        normalizedY: projected.y,
        scale: 0.6 + strength,
        rotation: this.rng.next() * 360,
        age: 0,
        opacity: 0.8,
        dripOffset: 0,
      });
      this.emit({ type: "SPLAT", id, timestamp: s.simulationTime });
    }
  }
  private updateEffects(dt: number) {
    const s = this.state;
    this.shake *= Math.exp(-12 * dt);
    if (s.impactState) {
      const impact = s.impactState;
      impact.age += dt;
      impact.phase = impact.age < LIMITS.impactDuration ? "IMPACT" : "RECOVER";
      const amount =
        impact.age < LIMITS.impactDuration
          ? 1
          : Math.max(
              0,
              1 - (impact.age - LIMITS.impactDuration) / LIMITS.recoverDuration,
            );
      s.body.squashX = 1 + 0.38 * impact.strength * amount;
      s.body.squashY = 1 - 0.3 * impact.strength * amount;
      if (amount === 0) s.impactState = undefined;
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.lifetime) {
        this.particles.splice(i, 1);
        continue;
      }
      p.velocity.y += (p.stream ? -0.03 : 0.65) * dt;
      for (const axis of ["x", "y", "z"] as const)
        p.position[axis] += p.velocity[axis] * dt;
    }
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const splat = this.splats[i];
      splat.age += dt;
      if (splat.age >= LIMITS.splatLifetime) {
        this.splats.splice(i, 1);
        continue;
      }
      splat.opacity = 0.8 * Math.min(1, (LIMITS.splatLifetime - splat.age) / 2);
      splat.dripOffset = splat.age * 0.015;
    }
  }
  snapshot(): CatRenderState {
    const s = this.state,
      b = s.body;
    return {
      ...s,
      presentation: { ...this.presentation },
      body: { ...b, position: { ...b.position }, velocity: { ...b.velocity } },
      impactState: s.impactState ? { ...s.impactState } : undefined,
      specialState: s.specialState ? { ...s.specialState } : undefined,
      particles: this.particles.map((p) => ({
        ...p,
        position: { ...p.position },
        velocity: { ...p.velocity },
      })),
      splats: this.splats.map((p) => ({ ...p })),
      direction: directionFor(b.velocity, b.orientation),
      facing:
        b.velocity.z > 0.15 ? "front" : b.velocity.z < -0.15 ? "back" : "side",
      scale: project(b.position).scale,
      camera: {
        x: Math.sin(s.simulationTime * 97) * this.shake,
        y: Math.cos(s.simulationTime * 83) * this.shake,
      },
      message: s.simulationTime < this.messageUntil ? this.message : "",
    };
  }
}
