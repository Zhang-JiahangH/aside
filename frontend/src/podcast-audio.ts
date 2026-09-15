import { DEFAULT_PLAYER_CONFIG, type PlayerConfig } from "@aside/engine/player";

export interface PodcastAudio {
  positionMs: number;
  play(): Promise<void>;
  pause(): void;
  configure(config: PlayerConfig): void;
}
/** The DOM reference stays here; UI code only binds it. */
export class BrowserPodcastAudio implements PodcastAudio {
  private element: HTMLAudioElement | null = null;
  private config: PlayerConfig = DEFAULT_PLAYER_CONFIG;
  attach = (element: HTMLAudioElement | null) => {
    this.element = element;
    this.configure(this.config);
  };
  get positionMs() {
    return (this.element?.currentTime ?? 0) * 1000;
  }
  set positionMs(value: number) {
    if (this.element) this.element.currentTime = value / 1000;
  }
  play() {
    return this.element?.play() ?? Promise.reject(Error("节目音频未就绪"));
  }
  pause() {
    this.element?.pause();
  }
  configure(config: PlayerConfig) {
    this.config = config;
    if (!this.element) return;
    this.element.defaultPlaybackRate = config.playbackRate;
    this.element.playbackRate = config.playbackRate;
    this.element.preservesPitch = config.preservesPitch;
    this.element.volume = config.volume;
    this.element.muted = config.muted;
  }
}
