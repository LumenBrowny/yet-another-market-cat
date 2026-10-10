import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MeowMouth,
  artworkKey,
  QUIET_TIERS,
} from "../packages/cat-shit-engine/src/mouth";
test("meow mouth lasts exactly half a second, follows current direction and resets", () => {
  const m = new MeowMouth();
  assert.equal(m.open(1), false);
  m.start(10);
  assert.equal(m.open(10.499), true);
  assert.equal(m.open(10.5), false);
  m.start(20);
  assert.equal(artworkKey("left", "CALM", m.open(20.1)), "left-open");
  assert.equal(artworkKey("right", "CALM", m.open(20.2)), "right-open");
  m.reset();
  assert.equal(m.open(20.3), false);
});
test("x1 through x5 closed except meow; x8+ open regardless of sound", () => {
  for (const t of QUIET_TIERS) {
    assert.equal(artworkKey("front", t, false), "front-closed");
    assert.equal(artworkKey("front", t, true), "front-open");
  }
  for (const t of ["AIRBORNE", "PANIC", "OVERDRIVE", "TRANSCENDENT"] as const) {
    assert.equal(artworkKey("left", t, false), "left-open");
    assert.equal(artworkKey("front-right", t, true), "front-right-open");
  }
});
test("purr is x0 only; unchanged special poses and back preserved; BONK wins", () => {
  assert.equal(artworkKey("front", "DEAD_INSIDE", true), "right-purr");
  assert.equal(artworkKey("right", "DEAD_INSIDE", false, "left"), "left-purr");
  assert.equal(artworkKey("bonk-impact", "DEAD_INSIDE", true), "bonk-impact");
  for (const p of [
    "back",
    "falling",
    "upward-thrust",
    "transcendent-panic",
  ] as const)
    assert.equal(artworkKey(p, "PANIC", true), p);
});
