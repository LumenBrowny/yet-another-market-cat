import type { AudioClip, AudioCue } from "./audio";
export interface ClipPlayer {
  playing: boolean;
  volume: number;
  seekTo(seconds: number): Promise<void>;
  play(): void;
  pause(): void;
  remove(): void;
}
/** Fixed reusable pool. ENDED is replayable, even when native isLoaded is false. */
export class ReusableAudioPool {
  private generation = 0;
  private pending = false;
  private disposed = false;
  constructor(private players: Record<AudioClip, ClipPlayer>) {}
  async play(cue: AudioCue): Promise<void> {
    if (this.pending || this.disposed) return;
    const player = this.players[cue.clip];
    if (cue.clip === "bonk") this.stop();
    else if (
      Object.values(this.players).filter((p) => p.playing).length >= 2 ||
      player.playing
    )
      return;
    const generation = this.generation;
    this.pending = true;
    try {
      player.volume = cue.volume;
      await player.seekTo(0);
      if (!this.disposed && generation === this.generation) player.play();
    } catch {
      /* A failed optional sound must not stop the scene. */
    } finally {
      this.pending = false;
    }
  }
  stop() {
    this.generation++;
    for (const p of Object.values(this.players)) p.pause();
  }
  dispose() {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    for (const p of Object.values(this.players)) p.remove();
  }
}
