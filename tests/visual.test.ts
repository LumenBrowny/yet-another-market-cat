import { test } from "node:test";
import assert from "node:assert/strict";
import { particleLayers } from "@yac/cat-shit-engine/src/particleLayers";
import { floorShadow } from "@yac/cat-shit-engine/src/shadow";
import type { PoopParticle } from "@yac/cat-shit-engine/src/types";

test("particle depth ordering preserves emission ties, follows depth crossings and keeps input immutable", () => {
  const make = (
    id: number,
    z: number,
    emittedInFront = false,
    stream = false,
  ): PoopParticle => ({
    id,
    position: { x: 0, y: 0, z },
    velocity: { x: 0, y: 0, z: 0 },
    age: 1,
    lifetime: 2,
    size: 0.01,
    rotation: 0,
    stream,
    emittedInFront,
  });
  const particles = [
    make(1, 0.8),
    make(2, 0.2, true),
    make(3, 0.5, true),
    make(4, 0.5),
    make(5, 0.5, true, true),
    make(6, 0.9),
  ];
  const before = JSON.stringify(particles);
  const a = particleLayers(particles, 0.5);
  assert.deepEqual(
    a.behind.map((p) => p.id),
    [2, 4],
  );
  assert.deepEqual(
    a.front.map((p) => p.id),
    [3, 5, 1, 6],
  );
  assert.equal(JSON.stringify(particles), before);
  // Cat crosses their depth: old particles must change layers even if emitted backward.
  assert.deepEqual(
    particleLayers(particles, 0.75).front.map((p) => p.id),
    [6],
  );
  // Sub-pixel depth ties keep the birth side; later facing/rotation is not an input.
  assert.deepEqual(
    particleLayers(particles, 0.5000001).front.map((p) => p.id),
    [3, 5, 1, 6],
  );
});
test("fresh emission keeps its birth side despite cat depth movement", () => {
  const p: PoopParticle = {
    id: 1,
    position: { x: 0, y: 0, z: 0.7 },
    velocity: { x: 0, y: 0, z: 0 },
    age: 0.1,
    lifetime: 2,
    size: 0.01,
    rotation: 0,
    stream: false,
    emittedInFront: false,
  };
  assert.deepEqual(particleLayers([p], 0.4).behind, [p]);
  p.emittedInFront = true;
  assert.deepEqual(particleLayers([p], 0.9).front, [p]);
  p.age = 0.5;
  assert.deepEqual(particleLayers([p], 0.75).front, [p]);
  assert.deepEqual(particleLayers([p], 0.9).behind, [p]);
});

test("shadow touches the rear seam and straddles the front viewport edge", () => {
  const body = createBody();
  body.position.z = 0;
  const rear = floorShadow(body, YAMC_SPRITES.left);
  body.position.z = 1;
  const front = floorShadow(body, YAMC_SPRITES.left);
  assert.equal(rear.y - rear.ry, 235);
  assert.equal(front.y, YAMC_VIEW.height);
  assert.ok(front.y + front.ry > YAMC_VIEW.height);
  body.position.y -= 1;
  const high = floorShadow(body, YAMC_SPRITES.left);
  assert.equal(high.y, front.y);
  assert.ok(high.rx < front.rx);
  assert.ok(high.opacity < front.opacity);
  for (const z of [0, 0.5, 1])
    for (const x of [-2, 2]) {
      body.position = { x, y: 0, z };
      const shadow = floorShadow(body, YAMC_SPRITES.left);
      assert.ok(shadow.y - shadow.ry >= 235);
      assert.ok(shadow.x - shadow.rx >= 65 * (1 - z) - 1e-8);
      assert.ok(shadow.x + shadow.rx <= 340 - 65 * (1 - z) + 1e-8);
    }
});
import {
  renderSpriteMetadata,
  YAMC_PURR_SPRITES,
} from "@yac/cat-shit-engine/src/yamc";
import purrAnchors from "../packages/cat-shit-engine/src/yamc-purr-anchors.json";

test("purr uses its own anchors on x0 only; BONK retains impact metadata", () => {
  for (const side of ["left", "right"] as const) {
    const sprite = renderSpriteMetadata("front", "DEAD_INSIDE", side);
    assert.equal(sprite, YAMC_PURR_SPRITES[side]);
    for (const key of [
      "centerAnchor",
      "rearAnchor",
      "shadowAnchor",
      "mouthAnchor",
    ] as const)
      assert.deepEqual(sprite[key], purrAnchors[`${side}-purr`][key]);
    assert.equal(
      renderSpriteMetadata("front", "CALM", side),
      YAMC_SPRITES.front,
    );
    assert.equal(
      renderSpriteMetadata("bonk-impact", "DEAD_INSIDE", side),
      YAMC_SPRITES["bonk-impact"],
    );
  }
});
import {
  CatEngine,
  createBody,
  project,
  YAMC_SPRITES,
  YAMC_DIRECTIONS,
  YamcSelector,
  anchorWorld,
  spriteScale,
  YAMC_VIEW,
} from "@yac/cat-shit-engine";
import {
  YamcAudioLadder,
  AUDIO_PROFILES,
} from "@yac/cat-shit-engine/src/audio";

test("eight directions settle, tolerate boundary noise, and hold at rest", () => {
  YAMC_DIRECTIONS.forEach((direction, i) => {
    const selector = new YamcSelector();
    const a = (i * Math.PI) / 4;
    let result;
    for (let t = 0; t < 120; t++)
      result = selector.update(
        { x: Math.sin(a), y: 0, z: Math.cos(a) },
        "ACTIVE",
        false,
        1 / 60,
      );
    assert.equal(result!.direction, direction);
    for (let t = 0; t < 120; t++)
      result = selector.update(
        { x: 0.001 * Math.sin(t), y: 0, z: 0 },
        "ACTIVE",
        false,
        1 / 60,
      );
    assert.equal(result!.direction, direction);
  });
  const selector = new YamcSelector();
  for (let t = 0; t < 600; t++) {
    const a = Math.PI / 8 + Math.sin(t) * 0.05;
    assert.equal(
      selector.update(
        { x: Math.sin(a), y: 0, z: Math.cos(a) },
        "CALM",
        false,
        1 / 60,
      ).direction,
      "front",
    );
  }
});

test("all 12 rear anchors match the actual rotated, scaled, squashed renderer and stay off-center", () => {
  assert.equal(Object.keys(YAMC_SPRITES).length, 12);
  for (const sprite of Object.values(YAMC_SPRITES)) {
    const body = createBody();
    body.rotation = 0.73;
    body.squashX = 1.3;
    body.squashY = 0.7;
    for (const z of [0, 0.5, 1]) {
      body.position.z = z;
      const rear = project(anchorWorld(body, sprite, sprite.rearAnchor));
      const center = project(body.position);
      const x =
        (sprite.rearAnchor.x - sprite.centerAnchor.x) *
        128 *
        spriteScale(body, sprite) *
        body.squashX;
      const y =
        (sprite.rearAnchor.y - sprite.centerAnchor.y) *
        128 *
        spriteScale(body, sprite) *
        body.squashY;
      const angle = body.rotation + sprite.rotationBias;
      assert(
        Math.abs(
          (rear.x - center.x) * YAMC_VIEW.width -
            (x * Math.cos(angle) - y * Math.sin(angle)),
        ) < 1e-10,
      );
      assert(
        Math.abs(
          (rear.y - center.y) * YAMC_VIEW.height -
            (x * Math.sin(angle) + y * Math.cos(angle)),
        ) < 1e-10,
      );
      // Anatomical anchors may be close together, especially at far depth.
      // Reject coincidence; a fixed five-screen-pixel minimum is not a geometry invariant.
      assert(
        Math.hypot(
          (rear.x - center.x) * YAMC_VIEW.width,
          (rear.y - center.y) * YAMC_VIEW.height,
        ) > 1e-6,
      );
    }
  }
});

test("actual POOP starts at sprite rear; reaction opposes emission; plume lifetime is short", () => {
  const engine = new CatEngine({ seed: 9 });
  engine.setState("TRANSCENDENT");
  let found = false;
  for (let i = 0; i < 120; i++) {
    const before = engine.snapshot();
    engine.tick(1 / 60);
    const event = engine.drainEvents().find((e) => e.type === "POOP");
    if (event?.type !== "POOP") continue;
    const expected = anchorWorld(
      before.body,
      YAMC_SPRITES[before.presentation.spriteId],
      YAMC_SPRITES[before.presentation.spriteId].rearAnchor,
    );
    assert(
      Math.hypot(expected.x - event.position.x, expected.y - event.position.y) <
        1e-6,
    );
    const after = engine.snapshot();
    const delta = {
      x: after.body.velocity.x - before.body.velocity.x,
      y: after.body.velocity.y - before.body.velocity.y,
    };
    assert(delta.x * event.direction.x + delta.y * event.direction.y < 0);
    for (const p of after.particles.filter((p) => p.stream))
      assert(p.lifetime <= 0.3);
    found = true;
    break;
  }
  assert(found);
});

test("presentation layers escalate and BONK takes priority without changing real tier", () => {
  const selector = new YamcSelector();
  assert.equal(
    selector.update({ x: 0, y: 0, z: 0 }, "CALM", false, 1).motion,
    "calm",
  );
  assert.equal(
    selector.update({ x: 0, y: 0, z: 0 }, "CONCERNED", false, 1).motion,
    "boosted",
  );
  assert.equal(
    selector.update({ x: 0, y: -2, z: 0 }, "AIRBORNE", false, 1).spriteId,
    "upward-thrust",
  );
  assert.equal(
    selector.update({ x: 0, y: 2, z: 0 }, "AIRBORNE", false, 1).spriteId,
    "falling",
  );
  const bonk = selector.update({ x: 0, y: 0, z: 0 }, "TRANSCENDENT", true, 1);
  assert.equal(bonk.spriteId, "bonk-impact");
  assert.equal(bonk.motion, "transcendent");
  assert.equal(
    selector.update({ x: 0, y: 0, z: 0 }, "TRANSCENDENT", false, 1).spriteId,
    "transcendent-panic",
  );
});

test("audio ladder escalates density, throttles vocals/bonks and never accumulates muted backlog", () => {
  const counts: number[] = [];
  for (const group of [
    "calm",
    "working",
    "boosted",
    "airborne",
    "transcendent",
  ] as const) {
    const ladder = new YamcAudioLadder(() => 0.5);
    let count = 0;
    for (let t = 0; t < 60; t += 0.1) if (ladder.tick(t, group, true)) count++;
    counts.push(count);
    assert(AUDIO_PROFILES[group].volume <= 0.5);
  }
  for (let i = 1; i < counts.length; i++) assert(counts[i] > counts[i - 1]);
  const ladder = new YamcAudioLadder(() => 0);
  assert.equal(ladder.tick(0, "transcendent", true, true)?.clip, "bonk");
  assert.equal(ladder.tick(0.1, "transcendent", true, true), null);
  for (let t = 1; t < 100; t++)
    assert.equal(ladder.tick(t, "transcendent", false, true), null);
  assert.equal(ladder.tick(99.1, "transcendent", true), null);
  const vocals: number[] = [];
  for (let t = 100; t < 150; t += 0.1)
    if (ladder.tick(t, "transcendent", true)?.clip === "scream") vocals.push(t);
  for (let i = 1; i < vocals.length; i++)
    assert(vocals[i] - vocals[i - 1] >= 5);
});

test("finished native clips replay; mute/dispose cancel pending seek without late sound", async () => {
  const { ReusableAudioPool } =
    await import("@yac/cat-shit-engine/src/audioPlayback");
  const make = () => ({
    playing: false,
    isLoaded: true,
    volume: 0,
    plays: 0,
    removes: 0,
    async seekTo() {},
    play() {
      this.plays++;
      this.isLoaded = false;
    },
    pause() {
      this.playing = false;
    },
    remove() {
      this.removes++;
    },
  });
  const players = {
    puff: make(),
    rasp: make(),
    meow: make(),
    scream: make(),
    bonk: make(),
  };
  const pool = new ReusableAudioPool(players);
  await pool.play({ clip: "puff", volume: 0.2 });
  assert.equal(players.puff.isLoaded, false); // Expo Android STATE_ENDED getter.
  await pool.play({ clip: "puff", volume: 0.2 });
  assert.equal(players.puff.plays, 2);
  let release!: () => void;
  players.meow.seekTo = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const pending = pool.play({ clip: "meow", volume: 0.3 });
  pool.stop();
  release();
  await pending;
  assert.equal(players.meow.plays, 0);
  const pendingDispose = pool.play({ clip: "meow", volume: 0.3 });
  pool.dispose();
  release();
  await pendingDispose;
  assert.equal(players.meow.plays, 0);
  assert(Object.values(players).every((p) => p.removes === 1));
  pool.dispose();
  assert(Object.values(players).every((p) => p.removes === 1));
});
