import { DEFAULT_PLAYER_CONFIG, type PlayerConfig } from "@aside/engine/player";

import { readSpeechLevels } from "./audio-levels";
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
  private context?: AudioContext;
  private analyser?: AnalyserNode;
  private sources = new WeakMap<
    HTMLAudioElement,
    MediaElementAudioSourceNode
  >();
  private routed?: MediaElementAudioSourceNode;
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
    const element = this.element;
    if (!element) return Promise.reject(Error("节目音频未就绪"));
    const playing = element.play();
    this.route(element);
    return playing;
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
  /** Fills `levels` with the podcast's live speech bands; false while nothing plays through the analyser. */
  levels(levels: Float32Array) {
    const { element, analyser, context } = this;
    if (
      !element ||
      element.paused ||
      !analyser ||
      context?.state !== "running" ||
      this.sources.get(element) !== this.routed
    )
      return false;
    readSpeechLevels(analyser, levels);
    return true;
  }
  /**
   * Sends the element through an analyser. Web Audio owns the output once
   * connected, so only connect when the context is running and never silence it.
   */
  private route(element: HTMLAudioElement) {
    if (typeof AudioContext === "undefined") return;
    let context: AudioContext;
    try {
      context = this.context ??= new AudioContext();
    } catch {
      return;
    }
    void context
      .resume()
      .then(() => {
        if (context.state !== "running" || this.element !== element) return;
        let source = this.sources.get(element);
        if (source && source === this.routed) return;
        if (!source) {
          source = context.createMediaElementSource(element);
          this.sources.set(element, source);
        }
        if (!this.analyser) {
          this.analyser = context.createAnalyser();
          this.analyser.fftSize = 2048;
          this.analyser.smoothingTimeConstant = 0.55;
          this.analyser.connect(context.destination);
        }
        this.routed?.disconnect();
        source.connect(this.analyser);
        this.routed = source;
      })
      .catch(() => {});
  }
}
