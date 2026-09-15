import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioSessionCoordinator } from "../mobile/src/audio-session.js";

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
