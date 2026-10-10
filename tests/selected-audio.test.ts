import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  SelectedAudioController,
  SELECTED_PROFILES,
  SELECTED_DURATIONS,
  type AudioClock,
  type SelectedPlayer,
} from "../packages/cat-shit-engine/src/selectedAudio";
import data from "../packages/cat-shit-engine/src/selected-audio.json";
import { MINING_TIERS } from "../packages/shared/src/index";
class Clock implements AudioClock {
  time = 0;
  tasks = new Map<number, { at: number; fn: () => void }>();
  id = 0;
  now() {
    return this.time;
  }
  later(fn: () => void, s: number) {
    const id = ++this.id;
    this.tasks.set(id, { at: this.time + s, fn });
    return id;
  }
  cancel(h: unknown) {
    this.tasks.delete(h as number);
  }
  advance(s: number) {
    const end = this.time + s;
    for (;;) {
      const next = [...this.tasks].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      this.time = next[1].at;
      this.tasks.delete(next[0]);
      next[1].fn();
    }
    this.time = end;
  }
}
function setup(random = () => 0.5) {
  const clock = new Clock(),
    events: { id: string; time: number; slot: number; loop: boolean }[] = [],
    players: SelectedPlayer[] = [];
  let removed = 0;
  const engine = new SelectedAudioController(
    () => {
      let id = "",
        until = 0;
      const slot = players.length;
      const p: SelectedPlayer = {
        get playing() {
          return clock.time < until;
        },
        volume: 0,
        loop: false,
        replace(s) {
          id = s;
        },
        play() {
          until = p.loop ? Infinity : clock.time + SELECTED_DURATIONS[id];
          events.push({ id, time: clock.time, slot, loop: p.loop });
        },
        pause() {
          until = 0;
        },
        remove() {
          removed++;
        },
      };
      players.push(p);
      return p;
    },
    clock,
    random,
  );
  return { clock, events, players, engine, removed: () => removed };
}
test("selected profiles exactly preserve all user intervals, limits and clip sets", () => {
  const f = [
      [0, 0, 0],
      [1, 1, 1],
      [0.67, 0.67, 1],
      [0.5, 0.5, 1],
      [0.33, 0.33, 1],
      [1, 3, 2],
      [2, 3, 1],
      [1.5, 3, 2],
      [1, 2, 2],
      [0.5, 1, 3],
    ],
    m = [
      [0, 0, 1],
      [7, 10, 1],
      [6, 9, 1],
      [5, 8, 1],
      [4, 7, 1],
      [3, 5, 1],
      [2, 3, 1],
      [5, 7, 1],
      [3, 5, 1],
      [1, 3, 1],
    ];
  MINING_TIERS.forEach((t, i) => {
    const p = SELECTED_PROFILES[t.id];
    assert.deepEqual([p.farts.min, p.farts.max, p.farts.voices], f[i]);
    assert.deepEqual([p.meows.min, p.meows.max, p.meows.voices], m[i]);
    assert.equal(p.farts.clips.length, i === 0 ? 0 : i <= 4 ? 5 : 8);
    assert.equal(p.meows.clips.length, i === 0 ? 0 : i === 6 ? 1 : 3);
    assert.equal(
      p.loop,
      i === 0 ? "cat-purring" : i >= 6 ? "farting-loop" : null,
    );
  });
});
test("all 23 bundled files match conversion manifest and contain positive PCM duration", () => {
  assert.equal(Object.keys(data.assets).length, 23);
  for (const a of Object.values(data.assets)) {
    const bytes = readFileSync(`app/assets/yamc/audio-selected/${a.file}`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), a.sha256);
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert.ok(a.duration > 0);
  }
});
test("x0 starts one continuous purr and no timers or periodic events", () => {
  const s = setup();
  s.engine.configure("DEAD_INSIDE", true);
  s.clock.advance(120);
  assert.deepEqual(
    s.events.map((e) => [e.id, e.loop]),
    [["cat-purring", true]],
  );
  assert.equal(s.clock.tasks.size, 0);
  s.engine.stop();
  assert.ok(s.players.every((p) => !p.playing));
});
test("loop is an extra layer, fixed six players, bounded overlap with independent meows", () => {
  const s = setup(() => 0.999);
  s.engine.configure("TRANSCENDENT", true);
  s.clock.advance(60);
  assert.equal(s.players.length, 6);
  assert.equal(s.events.filter((e) => e.loop).length, 1);
  assert.ok(s.events.some((e) => e.slot === 2));
  assert.ok(s.events.some((e) => e.slot === 3));
  for (const e of s.events.filter((e) => e.slot < 4)) {
    const previous = s.events
      .filter((x) => x.slot === e.slot && x.time < e.time)
      .at(-1);
    if (previous)
      assert.ok(e.time - previous.time >= SELECTED_DURATIONS[previous.id]);
  }
});
test("24-second AIRBORNE meow is not cut or overlapped by 2–3 second events", () => {
  const s = setup();
  s.engine.configure("AIRBORNE", true);
  s.clock.advance(60);
  const es = s.events.filter((e) => e.id === "meowow-0");
  assert.equal(es.length, 3);
  for (let i = 1; i < es.length; i++)
    assert.ok(es[i].time - es[i - 1].time >= SELECTED_DURATIONS["meowow-0"]);
});
test("tier switch stops loop and old timers; mute cancels queued callbacks; resume has no backlog", () => {
  const s = setup();
  s.engine.configure("PANIC", true);
  const stale = [...s.clock.tasks.values()].map((t) => t.fn);
  s.clock.advance(1);
  s.engine.configure("CALM", true);
  assert.equal(s.players[4].playing, false);
  s.engine.stop();
  const count = s.events.length;
  stale.forEach((f) => f());
  s.clock.advance(100);
  assert.equal(s.events.length, count);
  assert.equal(s.clock.tasks.size, 0);
  s.engine.configure("CALM", true);
  s.clock.advance(0.9);
  assert.equal(s.events.length, count);
  s.clock.advance(0.1);
  assert.equal(s.events.length, count + 1);
});
test("BONK repeats after cooldown without stopping loops or other groups; dispose is final", () => {
  const s = setup();
  s.engine.configure("PANIC", true);
  s.engine.bonk();
  s.engine.bonk();
  assert.equal(s.events.filter((e) => e.id === "bonk-1").length, 1);
  assert.equal(s.players[4].playing, true);
  s.clock.advance(0.8);
  s.engine.bonk();
  assert.equal(s.events.filter((e) => e.id === "bonk-1").length, 2);
  s.engine.dispose();
  s.engine.dispose();
  assert.equal(s.removed(), 6);
  const count = s.events.length;
  s.engine.configure("CALM", true);
  s.clock.advance(60);
  assert.equal(s.events.length, count);
});
test("repeated render configuration never restarts continuous sound or schedules", () => {
  const s = setup();
  for (let i = 0; i < 1000; i++) s.engine.configure("TRANSCENDENT", true);
  assert.equal(s.events.length, 1);
  assert.equal(s.clock.tasks.size, 2);
});
