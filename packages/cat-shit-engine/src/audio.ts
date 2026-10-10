import type { MotionGroup } from "./yamc";
export type AudioClip = "puff" | "rasp" | "meow" | "scream" | "bonk";
export type AudioCue = { clip: AudioClip; volume: number };
export interface AudioProfile {
  clips: readonly AudioClip[];
  interval: number;
  jitter: number;
  vocalChance: number;
  vocal: "meow" | "scream";
  vocalCooldown: number;
  volume: number;
}
export const AUDIO_PROFILES: Record<MotionGroup, AudioProfile> = {
  calm: {
    clips: ["puff"],
    interval: 7,
    jitter: 3,
    vocalChance: 0.02,
    vocal: "meow",
    vocalCooldown: 20,
    volume: 0.22,
  },
  working: {
    clips: ["puff", "rasp"],
    interval: 3.5,
    jitter: 2,
    vocalChance: 0.12,
    vocal: "meow",
    vocalCooldown: 12,
    volume: 0.28,
  },
  boosted: {
    clips: ["puff", "rasp"],
    interval: 1.8,
    jitter: 1,
    vocalChance: 0.2,
    vocal: "meow",
    vocalCooldown: 9,
    volume: 0.34,
  },
  airborne: {
    clips: ["rasp", "puff"],
    interval: 1.1,
    jitter: 0.6,
    vocalChance: 0.3,
    vocal: "scream",
    vocalCooldown: 7,
    volume: 0.4,
  },
  transcendent: {
    clips: ["rasp"],
    interval: 0.7,
    jitter: 0.4,
    vocalChance: 0.45,
    vocal: "scream",
    vocalCooldown: 5,
    volume: 0.45,
  },
};
/** No native/audio dependency: timing is simulation time; mute never queues a backlog. */
export class YamcAudioLadder {
  private next = 0;
  private lastVocal = -100;
  private lastBonk = -100;
  private group: MotionGroup | undefined;
  constructor(private random: () => number = Math.random) {}
  tick(
    time: number,
    group: MotionGroup,
    enabled: boolean,
    bonk = false,
  ): AudioCue | null {
    const p = AUDIO_PROFILES[group];
    if (group !== this.group || !enabled) {
      this.group = group;
      this.next = time + 0.6;
    }
    if (!enabled) return null;
    if (bonk && time - this.lastBonk >= 0.7) {
      this.lastBonk = time;
      this.next = time + 0.7;
      return { clip: "bonk", volume: 0.48 };
    }
    if (time < this.next) return null;
    this.next = time + p.interval + this.random() * p.jitter;
    const vocal =
      time - this.lastVocal >= p.vocalCooldown && this.random() < p.vocalChance;
    if (vocal) this.lastVocal = time;
    return {
      clip: vocal
        ? p.vocal
        : p.clips[
            Math.min(
              p.clips.length - 1,
              Math.floor(this.random() * p.clips.length),
            )
          ],
      volume: p.volume,
    };
  }
}
