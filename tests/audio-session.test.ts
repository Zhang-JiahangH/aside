import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AudioSessionCoordinator,
  NativePlaybackEvents,
} from "../mobile/src/audio-session.js";

function fixture() {
  const events: string[] = [];
  const coordinator = new AudioSessionCoordinator({
    configure: async (recording) => {
      events.push(recording ? "record" : "playback");
    },
    activate: async (active) => {
      events.push(active ? "active" : "inactive");
    },
  });
  return { coordinator, events };
}
test("pausing a podcast cannot release a newly acquired microphone", async () => {
  const { coordinator: c, events } = fixture();
  await c.playPodcast();
  events.length = 0;
  const pause = c.pausePodcast();
  await c.record(Symbol("question"));
  await pause;
  assert.deepEqual(events, ["record", "active"]);
});
test("late cleanup of an old answer cannot stop a follow-up recording", async () => {
  const { coordinator: c, events } = fixture();
  const old = Symbol(),
    next = Symbol();
  await c.record(old);
  await c.record(next);
  events.length = 0;
  await c.finishQuestion(old);
  await c.answer(old);
  assert.deepEqual(events, []);
  await c.answer(next);
  assert.deepEqual(events, ["playback", "active"]);
});
test("closing a voice connection after resume preserves podcast audio", async () => {
  const { coordinator: c, events } = fixture();
  const voice = Symbol();
  await c.record(voice);
  await c.playPodcast();
  events.length = 0;
  await c.finishQuestion(voice);
  assert.deepEqual(events, []);
  await c.pausePodcast();
  assert.deepEqual(events, ["playback", "inactive"]);
});
test("a failed session transition does not poison subsequent attempts", async () => {
  let attempts = 0;
  const active: boolean[] = [];
  const c = new AudioSessionCoordinator({
    configure: async () => {
      if (++attempts === 1) throw Error("interrupted");
    },
    activate: async (value) => {
      active.push(value);
    },
  });
  await assert.rejects(c.record(Symbol()), /interrupted/);
  await c.playPodcast();
  assert.deepEqual(active, [true]);
});

test("follow-up capture stops the live audio unit before changing the native session", async () => {
  let liveUnit = false;
  const events: string[] = [];
  const c = new AudioSessionCoordinator({
    async enableAnswer(enabled) {
      liveUnit = enabled;
      events.push(enabled ? "live-start" : "live-stop");
    },
    async configure(recording) {
      if (liveUnit) throw Error("Session activation failed");
      events.push(recording ? "record" : "playback");
    },
    async activate(active) {
      events.push(active ? "active" : "inactive");
    },
  });
  const question = Symbol();
  await c.record(question);
  await c.answer(question);
  assert.equal(liveUnit, true);
  events.length = 0;
  await c.record(question);
  assert.deepEqual(events, ["live-stop", "record", "active"]);
  assert.equal(liveUnit, false);
  await c.answer(question);
  events.length = 0;
  await c.playPodcast();
  assert.deepEqual(events, ["live-stop", "playback", "active"]);
  assert.equal(liveUnit, false);
});

test("cancel during native activation cannot restart the old answer audio unit", async () => {
  let unblock!: () => void;
  let delayActivation = false;
  const wait = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const grants: boolean[] = [];
  const c = new AudioSessionCoordinator({
    configure: async () => {},
    activate: async () => {
      if (delayActivation) await wait;
    },
    enableAnswer: async (enabled) => {
      grants.push(enabled);
    },
  });
  const owner = Symbol();
  await c.record(owner);
  delayActivation = true;
  const answer = c.answer(owner);
  await new Promise((resolve) => setImmediate(resolve));
  const finish = c.finishQuestion(owner);
  unblock();
  await Promise.all([answer, finish]);
  assert.equal(grants.includes(true), false);
});
test("a release queued during native preparation prevents late activation", async () => {
  let unblock!: () => void;
  const wait = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const active: boolean[] = [];
  let first = true;
  const c = new AudioSessionCoordinator({
    configure: async () => {
      if (first) {
        first = false;
        await wait;
      }
    },
    activate: async (value) => {
      active.push(value);
    },
  });
  const voice = Symbol();
  const recording = c.record(voice);
  await Promise.resolve();
  await Promise.resolve();
  const release = c.finishQuestion(voice);
  unblock();
  await Promise.all([recording, release]);
  assert.deepEqual(active, [false]);
});

test("a delayed native pause after seek cannot cancel a newly requested play", () => {
  const events = new NativePlaybackEvents();
  const status = (playing: boolean) => ({
    playing,
    isLoaded: true,
    isBuffering: false,
  });
  events.requestedPlay();
  assert.equal(events.observe(status(true)), null);
  events.requestedPause();
  events.requestedPlay();
  assert.equal(events.observe(status(false)), null);
  assert.equal(events.observe(status(true)), null);
  assert.equal(events.observe(status(false)), "pause");
  assert.equal(events.observe(status(true)), "play");
});
test("a delayed playing event after explicit pause cannot restart playback", () => {
  const events = new NativePlaybackEvents();
  events.requestedPause();
  assert.equal(
    events.observe({ playing: true, isLoaded: true, isBuffering: false }),
    null,
  );
  assert.equal(
    events.observe({ playing: false, isLoaded: true, isBuffering: false }),
    null,
  );
  assert.equal(
    events.observe({ playing: true, isLoaded: true, isBuffering: false }),
    "play",
  );
});
