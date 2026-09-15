import { test } from "node:test";
import assert from "node:assert/strict";
import { BrowserPodcastAudio } from "../frontend/src/podcast-audio.js";
import { createPlayerConfig } from "@aside/engine/player";

test("configuration set before DOM attachment survives detach and a new audio element", () => {
  const audio = new BrowserPodcastAudio();
  audio.configure(
    createPlayerConfig({
      playbackRate: 0.8,
      volume: 0.4,
      muted: true,
      preservesPitch: false,
    }),
  );
  const first = {} as HTMLAudioElement;
  audio.attach(first);
  assert.equal(first.playbackRate, 0.8);
  assert.equal(first.defaultPlaybackRate, 0.8);
  assert.equal(first.volume, 0.4);
  assert.equal(first.muted, true);
  assert.equal(first.preservesPitch, false);
  audio.attach(null);
  audio.configure(createPlayerConfig({ playbackRate: 1.25 }));
  const second = {} as HTMLAudioElement;
  audio.attach(second);
  assert.equal(second.playbackRate, 1.25);
  assert.equal(second.muted, false);
  assert.equal(first.playbackRate, 0.8);
});

test("the adapter forwards playback and position, and reports missing media", async () => {
  const audio = new BrowserPodcastAudio();
  audio.pause();
  audio.positionMs = 1000;
  assert.equal(audio.positionMs, 0);
  await assert.rejects(audio.play(), /未就绪/);
  let playing = false;
  const element = {
    currentTime: 2,
    async play() {
      playing = true;
    },
    pause() {
      playing = false;
    },
  } as unknown as HTMLAudioElement;
  audio.attach(element);
  assert.equal(audio.positionMs, 2000);
  audio.positionMs = 1500;
  assert.equal(element.currentTime, 1.5);
  await audio.play();
  assert.equal(playing, true);
  audio.pause();
  assert.equal(playing, false);
});
