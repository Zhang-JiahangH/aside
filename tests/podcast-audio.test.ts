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

const fakeElement = () => {
  const element = {
    currentTime: 0,
    paused: true,
    volume: 1,
    async play() {
      element.paused = false;
    },
    pause() {
      element.paused = true;
    },
  };
  return element as unknown as HTMLAudioElement;
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("attention ducks and settles through element volume before Web Audio is routed", async () => {
  const audio = new BrowserPodcastAudio();
  audio.configure(createPlayerConfig({ volume: 0.5 }));
  const element = fakeElement();
  audio.attach(element);
  await audio.play();
  audio.duck(0.6, 30);
  await wait(80);
  assert.ok(Math.abs(element.volume - 0.3) < 1e-9, `volume ${element.volume}`);
  // Reconfiguring the user's volume keeps the attention multiplier.
  audio.configure(createPlayerConfig({ volume: 0.8 }));
  assert.ok(Math.abs(element.volume - 0.48) < 1e-9, `volume ${element.volume}`);
  audio.duck(1, 0);
  assert.equal(element.volume, 0.8);
  const settled = audio.settle(40);
  audio.duck(0.6, 0);
  assert.equal(element.paused, false);
  await settled;
  assert.equal(element.paused, true);
  assert.equal(element.volume, 0.8);
});

test("play, pause or a new element supersede a pending settle", async () => {
  const audio = new BrowserPodcastAudio();
  const element = fakeElement();
  audio.attach(element);
  await audio.play();
  const settled = audio.settle(40);
  await wait(10);
  await audio.play();
  await settled;
  assert.equal(element.paused, false);
  assert.equal(element.volume, 1);
  const again = audio.settle(40);
  const next = fakeElement();
  audio.attach(next);
  await again;
  assert.equal(element.paused, false);
  assert.equal(next.paused, true);
  audio.pause();
  await audio.settle(40);
  assert.equal(next.paused, true);
});

test("once routed through Web Audio, attention moves to a gain node ahead of the analyser", async () => {
  class Param {
    value = 1;
    events: string[] = [];
    cancelScheduledValues(at: number) {
      this.events.push(`cancel@${at}`);
    }
    setValueAtTime(value: number, at: number) {
      this.value = value;
      this.events.push(`set:${value}@${at}`);
    }
    linearRampToValueAtTime(value: number, at: number) {
      this.value = value;
      this.events.push(`ramp:${value}@${at}`);
    }
  }
  class Node {
    connections: Node[] = [];
    connect(node: Node) {
      this.connections.push(node);
      return node;
    }
    disconnect() {
      this.connections = [];
    }
  }
  class Gain extends Node {
    gain = new Param();
  }
  const nodes: { source?: Node; gain?: Gain; analyser?: Node } = {};
  // Routing waits for the context to resume; the test decides when.
  let openRoute!: () => void;
  const routeGate = new Promise<void>((resolve) => (openRoute = resolve));
  class Context {
    state = "running";
    currentTime = 10;
    destination = new Node();
    resume() {
      return routeGate;
    }
    createGain() {
      return (nodes.gain = new Gain());
    }
    createAnalyser() {
      return (nodes.analyser = Object.assign(new Node(), {
        fftSize: 0,
        smoothingTimeConstant: 0,
      }));
    }
    createMediaElementSource() {
      return (nodes.source = new Node());
    }
  }
  (globalThis as any).AudioContext = Context;
  try {
    const audio = new BrowserPodcastAudio();
    audio.configure(createPlayerConfig({ volume: 0.5 }));
    const element = fakeElement();
    audio.attach(element);
    await audio.play();
    audio.duck(0.6, 0);
    assert.ok(Math.abs(element.volume - 0.3) < 1e-9);
    openRoute();
    await new Promise((resolve) => setImmediate(resolve));
    // Routed: source → gain → analyser → destination, and the element volume is the user's again.
    assert.equal(nodes.source!.connections[0], nodes.gain);
    assert.equal(nodes.gain!.connections[0], nodes.analyser);
    assert.equal(nodes.analyser!.connections[0] instanceof Node, true);
    assert.equal(element.volume, 0.5);
    assert.ok(nodes.gain!.gain.events.includes("set:0.6@10"));
    audio.duck(0.8, 300);
    assert.equal(nodes.gain!.gain.events.at(-1), "ramp:0.8@10.3");
    audio.configure(createPlayerConfig({ volume: 0.7 }));
    assert.equal(element.volume, 0.7);
    await audio.settle(20);
    assert.equal(element.paused, true);
    assert.ok(nodes.gain!.gain.events.includes("ramp:0@10.02"));
    assert.equal(nodes.gain!.gain.value, 1);
    assert.equal(element.volume, 0.7);
  } finally {
    delete (globalThis as any).AudioContext;
  }
});
