import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import {
  SelectedAudioController,
  type SelectedPlayer,
} from "@yac/cat-shit-engine/src/selectedAudio";
import type { CatState } from "@yac/shared";
import { SELECTED_AUDIO } from "./yamcSelectedAssets";
import { appConfig } from "./config";
/** Fixed pool: no per-frame/player allocation, no delayed playback after mute/unmount. */
export class YamcAudioPlayer {
  private pool: SelectedAudioController | null = null;
  private disposed = false;
  private desired: { tier: CatState; enabled: boolean } = {
    tier: "DEAD_INSIDE",
    enabled: false,
  };
  constructor(private onMeow: () => void = () => {}) {
    void setAudioModeAsync({
      playsInSilentMode: false,
      shouldPlayInBackground: false,
      allowsRecording: false,
      interruptionMode: "mixWithOthers",
    })
      .then(() => {
        if (this.disposed) return;
        this.pool = new SelectedAudioController(() => {
          const p = createAudioPlayer(null, { updateInterval: 100 });
          let clip = "",
            wasPlaying = false,
            armed = false;
          p.addListener("playbackStatusUpdate", (status) => {
            if (
              armed &&
              status.playing &&
              this.desired.enabled &&
              !this.disposed
            ) {
              armed = false;
              if (/^meow(?:-|ow-)/.test(clip)) this.onMeow();
            }
            if (appConfig.demoControls)
              if (status.playing !== wasPlaying || status.didJustFinish) {
                console.info(
                  "[YAC selected audio]",
                  clip,
                  status.playing
                    ? "playing"
                    : status.didJustFinish
                      ? "ended"
                      : "paused",
                );
                wasPlaying = status.playing;
              }
          });
          return {
            get playing() {
              return p.playing;
            },
            get volume() {
              return p.volume;
            },
            set volume(v) {
              p.volume = v;
            },
            get loop() {
              return p.loop;
            },
            set loop(v) {
              p.loop = v;
            },
            replace: (id) => {
              clip = id;
              armed = false;
              p.replace(SELECTED_AUDIO[id]);
            },
            play: () => {
              armed = true;
              p.play();
            },
            pause: () => {
              armed = false;
              p.pause();
            },
            remove: () => p.remove(),
          } satisfies SelectedPlayer;
        });
        this.pool.configure(this.desired.tier, this.desired.enabled);
      })
      .catch(() => {});
  }
  configure(tier: CatState, enabled: boolean) {
    if (this.desired.tier === tier && this.desired.enabled === enabled) return;
    this.desired = { tier, enabled };
    this.pool?.configure(tier, enabled);
  }
  bonk() {
    this.pool?.bonk();
  }
  stop() {
    this.desired.enabled = false;
    this.pool?.stop();
  }
  dispose() {
    this.disposed = true;
    this.pool?.dispose();
    this.pool = null;
  }
}
