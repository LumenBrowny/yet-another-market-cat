import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CatEngine,
  PROFILES,
  LIMITS,
  collide,
  createBody,
  perspectiveScale,
  directionFor,
  type CatState,
  type CatEngineEvent,
} from "@yac/cat-shit-engine";
import { MINING_TIERS } from "@yac/shared";
function run(state: CatState, ticks: number, seed = 42) {
  const e = new CatEngine({ seed });
  e.setState(state);
  for (let i = 0; i < ticks; i++) {
    e.tick(1 / 60);
    e.drainEvents();
  }
  return e;
}
function finite(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (value && typeof value === "object")
    return Object.values(value).every(finite);
  return true;
}
test("Every canonical state has a finite progressive physics profile", () => {
  for (const tier of MINING_TIERS) {
    const p = PROFILES[tier.id];
    assert.ok(p);
    assert.ok(Object.values(p).every((v) => Number.isFinite(v) && v >= 0));
    assert.ok(p.maxSpeed > 0 && p.restitution < 1);
  }
  assert.equal(PROFILES.CALM.poopRate, 1);
  assert.equal(PROFILES.DEAD_INSIDE.thrustMax, 0);
  assert.ok(PROFILES.CALM.thrustMax < PROFILES.DISTRESSED.thrustMax);
  assert.ok(PROFILES.DISTRESSED.thrustMax < PROFILES.PANIC.thrustMax);
  assert.ok(PROFILES.PANIC.thrustMax < PROFILES.TRANSCENDENT.thrustMax);
});
test("Seed and fixed ticks reproduce state; different seeds diverge", () => {
  assert.deepEqual(
    run("PANIC", 3600).snapshot(),
    run("PANIC", 3600).snapshot(),
  );
  assert.notDeepEqual(
    run("PANIC", 3600, 7).snapshot(),
    run("PANIC", 3600, 8).snapshot(),
  );
  const a = new CatEngine(),
    b = new CatEngine();
  a.setState("AIRBORNE");
  b.setState("AIRBORNE");
  for (let i = 0; i < 120; i++) a.tick(1 / 60);
  for (let i = 0; i < 60; i++) b.tick(1 / 30);
  assert.deepEqual(a.snapshot(), b.snapshot());
});
test("DEAD_INSIDE has no emissions, CALM cadence and opposite recoil use one event", () => {
  const e = run("DEAD_INSIDE", 600);
  assert.equal(e.snapshot().particles.length, 0);
  e.setState("CALM");
  e.drainEvents();
  let count = 0;
  for (let i = 0; i < 600; i++) {
    e.tick(1 / 60);
    for (const ev of e.drainEvents())
      if (ev.type === "POOP") {
        count++;
        const v = e.snapshot().body.velocity;
        assert.ok(
          v.x * ev.direction.x + v.y * ev.direction.y + v.z * ev.direction.z <
            0,
        );
      }
  }
  assert.equal(count, 10);
  e.setState("DEAD_INSIDE");
  assert.equal(e.snapshot().particles.length, 0);
  assert.equal(Math.hypot(...Object.values(e.snapshot().body.velocity)), 0);
});
test("All six planes clamp penetration, reflect normal velocity and dissipate energy", () => {
  for (const [axis, p, v, plane] of [
    ["x", -1.1, -2, "left"],
    ["x", 1.1, 2, "right"],
    ["y", -1.1, -2, "top"],
    ["y", 1.1, 2, "bottom"],
    ["z", -0.1, -2, "rear"],
    ["z", 1.1, 2, "front"],
  ] as const) {
    const b = createBody();
    b.position[axis] = p;
    b.velocity[axis] = v;
    const hits = collide(b, 0.6);
    assert.equal(hits[0].plane, plane);
    assert.equal(b.velocity[axis], -v * 0.6);
    assert.ok(Math.abs(b.velocity[axis]) < Math.abs(v));
    assert.ok(
      b.position[axis] >= (axis === "z" ? 0 : -1) && b.position[axis] <= 1,
    );
  }
});
test("Strong front impact emits BONK, rebounds, squashes, recovers and deterministically splats", () => {
  const e = new CatEngine({ seed: 1 });
  e.setState("TRANSCENDENT");
  const b = createBody();
  b.position.z = 0.99;
  b.velocity.z = 6;
  e.setBody(b);
  e.tick(1 / 60);
  assert.ok(e.drainEvents().some((v) => v.type === "FRONT_IMPACT"));
  assert.ok(e.snapshot().body.velocity.z < 0);
  assert.ok(e.snapshot().body.squashX > 1.2);
  assert.ok(e.snapshot().body.squashY < 0.85);
  // Quiet profile preserves impact recovery without extra front collisions.
  e.setState("CALM");
  for (let i = 0; i < 30; i++) e.tick(1 / 60);
  assert.equal(e.snapshot().body.squashX, 1);
  assert.equal(e.snapshot().body.squashY, 1);
  const make = () => {
    const x = new CatEngine({ seed: 1 });
    x.setState("TRANSCENDENT");
    for (let i = 0; i < 8; i++) {
      x.setBody(b);
      x.tick(1 / 60);
    }
    return x.snapshot().splats;
  };
  assert.ok(make().length > 0);
  assert.deepEqual(make(), make());
});
test("AIRBORNE travels substantially farther than CALM through all axes", () => {
  function distance(state: CatState) {
    const e = new CatEngine({ seed: 42 });
    e.setState(state);
    let total = 0;
    const ranges = { min: 1, max: 0 };
    for (let i = 0; i < 3600; i++) {
      e.tick(1 / 60);
      const s = e.snapshot();
      total += Math.hypot(...Object.values(s.body.velocity)) / 60;
      ranges.min = Math.min(ranges.min, s.body.position.z);
      ranges.max = Math.max(ranges.max, s.body.position.z);
    }
    return { total, depth: ranges.max - ranges.min };
  }
  const calm = distance("CALM"),
    flight = distance("AIRBORNE");
  assert.ok(flight.total > calm.total * 10);
  assert.ok(flight.depth > 0.6);
  console.info("movement", JSON.stringify({ calm, flight }));
});
test("Ten minutes per tier remain finite, bounded and capped; both rare events occur", () => {
  const kinds = new Set<string>();
  let maxParticles = 0,
    maxSplats = 0;
  for (const tier of MINING_TIERS) {
    const e = new CatEngine({ seed: 42 });
    e.setState(tier.id);
    for (let i = 0; i < 36000; i++) {
      e.tick(1 / 60);
      for (const ev of e.drainEvents()) kinds.add(ev.type);
      if (i % 60 === 0) {
        const s = e.snapshot();
        assert.ok(finite(s));
        const b = s.body;
        assert.ok(
          Math.abs(b.position.x) <= 1 &&
            Math.abs(b.position.y) <= 1 &&
            b.position.z >= 0 &&
            b.position.z <= 1,
        );
        assert.ok(
          Math.hypot(...Object.values(b.velocity)) <=
            PROFILES[tier.id].maxSpeed + 1e-9,
        );
        assert.ok(
          Math.abs(b.angularVelocity) <= PROFILES[tier.id].maxAngularSpeed,
        );
        assert.ok(s.particles.length <= LIMITS.particles);
        assert.ok(s.splats.length <= LIMITS.splats);
        maxParticles = Math.max(maxParticles, s.particles.length);
        maxSplats = Math.max(maxSplats, s.splats.length);
      }
    }
  }
  assert.ok(kinds.has("SHIT_PRESSURE_CRITICAL") && kinds.has("CAT_ORBIT"));
  assert.ok(kinds.has("SPLAT"));
  assert.ok(!kinds.has("SAFETY_RESET"));
  console.info(
    "stress",
    JSON.stringify({
      ticks: 360000,
      maxParticles,
      maxSplats,
      events: [...kinds],
    }),
  );
});
test("Invalid states reset safely; frame gaps and pause never replay offline time", () => {
  const e = new CatEngine();
  e.setState("TRANSCENDENT");
  const b = createBody();
  b.velocity.x = NaN;
  e.setBody(b);
  assert.ok(finite(e.snapshot()));
  assert.ok(e.drainEvents().some((v) => v.type === "SAFETY_RESET"));
  b.velocity.x = Infinity;
  e.setBody(b);
  b.velocity.x = 0;
  b.position.x = 1e9;
  e.setBody(b);
  assert.ok(finite(e.snapshot()));
  e.tick(NaN);
  e.tick(Infinity);
  assert.ok(finite(e.snapshot()));
  const before = e.snapshot().simulationTime;
  e.tick(3600);
  assert.ok(e.snapshot().simulationTime - before <= 0.101);
  e.pause();
  assert.equal(e.drainEvents().length, 0);
  assert.throws(() => new CatEngine({ fixedStep: 0 }));
  assert.throws(
    () => new CatEngine({ fixedStep: 1e-9, maxFrameDelta: Infinity }),
  );
});
test("Perspective, direction, event draining and temporary specials are presentation-ready", () => {
  assert.equal(perspectiveScale(0), 0.45);
  assert.equal(perspectiveScale(1), 1.8);
  assert.ok(perspectiveScale(0.5) > perspectiveScale(0));
  assert.ok(Number.isFinite(perspectiveScale(NaN)));
  assert.equal(directionFor({ x: 1, y: 0, z: 0 }, 0), "E");
  assert.equal(directionFor({ x: 0, y: -1, z: 0 }, 0), "N");
  const e = new CatEngine();
  e.setState("TRANSCENDENT");
  e.triggerSpecial("CAT_ORBIT");
  assert.equal(e.snapshot().specialState?.kind, "CAT_ORBIT");
  const batch: CatEngineEvent[] = e.drainEvents();
  assert.ok(batch.some((v) => v.type === "CAT_ORBIT"));
  assert.equal(e.drainEvents().length, 0);
  for (let i = 0; i < 180; i++) e.tick(1 / 60);
  assert.equal(e.snapshot().specialState, undefined);
});
