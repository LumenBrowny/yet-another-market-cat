import type { CatState } from "./types";
import data from "./selected-audio.json";
export type SoundGroup = "farts" | "meows";
export interface SelectedGroup {
  min: number;
  max: number;
  voices: number;
  clips: string[];
}
export interface SelectedTier {
  farts: SelectedGroup;
  meows: SelectedGroup;
  loop: string | null;
}
export const SELECTED_PROFILES: Record<CatState, SelectedTier> = data.tiers;
export const SELECTED_DURATIONS: Record<string, number> = Object.fromEntries(
  Object.entries(data.assets).map(([id, a]) => [id, a.duration]),
);
export interface SelectedPlayer {
  playing: boolean;
  volume: number;
  loop: boolean;
  replace(clip: string): void;
  play(): void;
  pause(): void;
  remove(): void;
}
export interface AudioClock {
  now(): number;
  later(fn: () => void, seconds: number): unknown;
  cancel(handle: unknown): void;
}
const systemClock: AudioClock = {
  now: () => performance.now() / 1000,
  later: (f, s) => setTimeout(f, s * 1000),
  cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};
type Slot = { player: SelectedPlayer; until: number };
/** Six reusable players: three farts, one meow, one continuous bed, one BONK. */
export class SelectedAudioController {
  private slots: Record<SoundGroup, Slot[]>;
  private loopPlayer: SelectedPlayer;
  private bonkPlayer: SelectedPlayer;
  private timers: unknown[] = [];
  private generation = 0;
  private disposed = false;
  private tier: CatState | undefined;
  private enabled = false;
  private lastBonk = -Infinity;
  constructor(
    factory: () => SelectedPlayer,
    private clock = systemClock,
    private random = Math.random,
  ) {
    const slot = (): Slot => ({ player: factory(), until: 0 });
    this.slots = { farts: [slot(), slot(), slot()], meows: [slot()] };
    this.loopPlayer = factory();
    this.bonkPlayer = factory();
  }
  configure(tier: CatState, enabled: boolean) {
    if (this.disposed || (this.tier === tier && this.enabled === enabled))
      return;
    this.stop();
    this.tier = tier;
    this.enabled = enabled;
    if (!enabled) return;
    const p = SELECTED_PROFILES[tier];
    if (p.loop)
      this.startPlayer(
        this.loopPlayer,
        p.loop,
        true,
        p.loop === "cat-purring" ? 0.3 : 0.18,
      );
    for (const group of ["farts", "meows"] as const)
      if (p[group].clips.length)
        this.schedule(group, p[group], this.generation);
  }
  private schedule(group: SoundGroup, p: SelectedGroup, generation: number) {
    const delay = p.min + this.random() * (p.max - p.min);
    const handle = this.clock.later(() => {
      this.timers = this.timers.filter((h) => h !== handle);
      if (!this.enabled || this.disposed || generation !== this.generation)
        return;
      this.event(group, p);
      this.schedule(group, p, generation);
    }, delay);
    this.timers.push(handle);
  }
  private startPlayer(
    p: SelectedPlayer,
    id: string,
    loop: boolean,
    volume: number,
  ) {
    try {
      p.pause();
      p.loop = loop;
      // Peak headroom even for three full-scale farts + meow + loop + BONK.
      p.volume = volume * 0.45;
      p.replace(id);
      p.play();
      return true;
    } catch {
      return false;
    }
  }
  private event(group: SoundGroup, p: SelectedGroup) {
    const now = this.clock.now();
    const slot = this.slots[group]
      .slice(0, p.voices)
      .find((s) => s.until <= now && !s.player.playing);
    if (!slot) return;
    const id =
      p.clips[
        Math.min(p.clips.length - 1, Math.floor(this.random() * p.clips.length))
      ];
    if (
      this.startPlayer(slot.player, id, false, group === "farts" ? 0.3 : 0.45)
    )
      slot.until = now + SELECTED_DURATIONS[id] + 0.05;
  }
  bonk() {
    if (
      !this.enabled ||
      this.disposed ||
      this.clock.now() - this.lastBonk < 0.7
    )
      return;
    this.lastBonk = this.clock.now();
    this.startPlayer(this.bonkPlayer, "bonk-1", false, 0.5);
  }
  stop() {
    this.generation++;
    this.enabled = false;
    for (const t of this.timers) this.clock.cancel(t);
    this.timers = [];
    for (const s of [...this.slots.farts, ...this.slots.meows]) {
      s.until = 0;
      s.player.pause();
    }
    this.loopPlayer.pause();
    this.bonkPlayer.pause();
  }
  dispose() {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    for (const p of [...this.slots.farts, ...this.slots.meows]
      .map((s) => s.player)
      .concat(this.loopPlayer, this.bonkPlayer))
      p.remove();
  }
}
