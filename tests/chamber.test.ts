import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { roomForTier, FLOOR_COINS } from "@yac/cat-shit-engine/src/chamber";
import { MINING_TIERS } from "@yac/shared";
import { loopFrame } from "../app/src/chamber/loops";
import scene from "../app/src/chamber/scene-011a.json";

test("modular chamber caches reflect replaceable PNGs and scene configuration", () => {
  const manifest = JSON.parse(
    readFileSync("app/assets/chamber-v2-1/plates/manifest.json", "utf8"),
  );
  assert.equal(Object.keys(manifest.outputs).length, 5);
  for (const [file, expected] of Object.entries({
    ...manifest.inputs,
    ...manifest.outputs,
  })) {
    assert.equal(
      createHash("sha256").update(readFileSync(file)).digest("hex"),
      expected,
      `${file}: run npm run chamber:render:011a`,
    );
  }
});

test("sparse loops hold frames, wrap exactly, and resume from elapsed active time", () => {
  assert.deepEqual(loopFrame(0, [3400, 240]), { index: 0, remaining: 3400 });
  assert.deepEqual(loopFrame(3399, [3400, 240]), { index: 0, remaining: 1 });
  assert.deepEqual(loopFrame(3400, [3400, 240]), { index: 1, remaining: 240 });
  assert.deepEqual(loopFrame(3640, [3400, 240]), { index: 0, remaining: 3400 });
  // Resume midway through blink: paused/background time is excluded by caller.
  assert.deepEqual(loopFrame(3500, [3400, 240]), { index: 1, remaining: 140 });
  assert.deepEqual(loopFrame(3640 * 1000 + 3500, [3400, 240]), {
    index: 1,
    remaining: 140,
  });
  assert.throws(() => loopFrame(0, [0, 1]));
  assert.throws(() => loopFrame(0, []));
});

test("every room loop has registered alpha PNG frames and restrained timings", () => {
  for (const [state, cfg] of Object.entries(scene.states)) {
    for (const kind of ["character", "monitor", "indicator"] as const) {
      const durations = cfg[`${kind}Ms`];
      assert.equal(durations.length, 2);
      assert.ok(durations.every((ms) => ms >= 200));
      let dimensions = "";
      for (let frame = 0; frame < durations.length; frame++) {
        const file =
          kind === "character"
            ? `secondary-character/${state.toLowerCase()}-0${frame + 1}.png`
            : `${kind}/${state.toLowerCase()}-${frame + 1}.png`;
        const bytes = readFileSync(`app/assets/chamber-v2-1/${file}`);
        assert.equal(bytes[25], 6, "transparent RGBA");
        const size = `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
        if (dimensions)
          assert.equal(size, dimensions, "loop frames share the same canvas");
        dimensions = size;
      }
    }
  }
  assert.equal(scene.states.IDLE.chair, "seated");
  assert.equal(scene.states.NOTICE.chair, "seated");
  assert.equal(scene.states.DISASTER.damage, true);
});

test("cached plates match editable layers and output checksums", () => {
  const manifest = JSON.parse(
    readFileSync("app/assets/chamber-v2/plates/manifest.json", "utf8"),
  );
  assert.equal(Object.keys(manifest.outputs).length, 5);
  for (const [file, expected] of Object.entries({
    ...manifest.inputs,
    ...manifest.outputs,
  })) {
    assert.equal(
      createHash("sha256").update(readFileSync(file)).digest("hex"),
      expected,
      `${file}: regenerate with npm run chamber:render`,
    );
  }
});

test("all economic tiers have four ordered visual room groups; x0 is clean and fed", () => {
  const rooms = MINING_TIERS.map((t) => roomForTier(t.id));
  assert.deepEqual(
    rooms.map((r) => r.id),
    [
      "IDLE",
      "IDLE",
      "IDLE",
      "IDLE",
      "NOTICE",
      "NOTICE",
      "PANIC",
      "PANIC",
      "DISASTER",
      "DISASTER",
    ],
  );
  assert.equal(rooms[0].floorCoins, 0);
  assert.ok(rooms[0].bowlCoins > 0);
  assert.equal(rooms[0].pose, "normal");
  for (let i = 1; i < rooms.length; i++) {
    assert.ok(rooms[i].floorCoins >= rooms[i - 1].floorCoins);
    assert.ok(rooms[i].bowlCoins <= rooms[i - 1].bowlCoins);
    assert.ok(rooms[i].floorCoins <= FLOOR_COINS.length);
  }
});

test("floor dressing stays bounded, on the floor and clear of central flight space", () => {
  for (const c of FLOOR_COINS) {
    assert.ok(c.y >= 235 && c.y + c.radius < 290);
    assert.ok(c.x > 25 && c.x < 315);
    assert.ok(c.x < 120 || c.x > 220);
  }
});

test("bundled chamber textures are phone-sized PNGs; character alpha is retained", () => {
  for (const name of ["room", "normal", "notice", "panic", "disaster"]) {
    const bytes = readFileSync(`app/assets/chamber-v2/${name}.png`);
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    assert.ok(bytes.readUInt32BE(16) <= 680);
    assert.ok(bytes.readUInt32BE(20) <= 580);
    if (name !== "room") assert.equal(bytes[25], 6, "RGBA texture");
  }
});
