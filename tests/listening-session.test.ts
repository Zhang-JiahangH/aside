import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ListeningSession,
  type ListeningMode,
  type VoicePort,
} from "../frontend/src/listening-session.js";
import type { RuntimeClock } from "../frontend/src/runtime-clock.js";
import type { VoiceCallbacks } from "../frontend/src/on-demand-voice.js";
import type { PlayerBackend } from "../frontend/src/player-api.js";
import type {
  QuestionRequest,
  QuestionResult,
  QuestionPhase,
} from "@aside/engine/contracts";
import type { Episode } from "@aside/engine/core";
class Clock implements RuntimeClock {
  private time = 0;
  private timers = new Map<number, { at: number; callback: () => void }>();
  private next = 0;
  now() {
    return this.time;
  }
  after(delay: number, callback: () => void) {
    const id = this.next++;
    this.timers.set(id, { at: this.time + delay, callback });
    return () => {
      this.timers.delete(id);
    };
  }
  advance(ms: number) {
    const end = this.time + ms;
    while (true) {
      const next = [...this.timers]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.time = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.time = end;
  }
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const episode: Episode = {
  id: "test",
  title: "播客",
  durationMs: 90000,
  createdAt: "now",
  status: "ready",
  stage: "ready",
  progress: 1,
  analysis: {
    version: "1",
    source: "demo",
    summary: "",
    hostStyle: "",
    speakers: [],
    voice: "feminine",
    voiceReason: "test",
    passages: [
      {
        id: "heard",
        startMs: 1000,
        endMs: 2000,
        text: "已听原文",
        speaker: "host",
      },
      {
        id: "future",
        startMs: 40000,
        endMs: 50000,
        text: "未听原文",
        speaker: "host",
      },
    ],
    anchors: [
      {
        id: "anchor",
        startMs: 20000,
        endMs: 40000,
        text: "自然断点",
        confidence: 1,
      },
    ],
  },
};
function setup(mode: ListeningMode = "off", permission?: Promise<void>) {
  const clock = new Clock();
  const audio = {
    positionMs: 31000,
    playing: false,
    plays: 0,
    async play() {
      this.playing = true;
      this.plays++;
    },
    pause() {
      this.playing = false;
    },
    setRate() {},
  };
  const requests: {
    data: QuestionRequest;
    signal: AbortSignal;
    progress: (phase: QuestionPhase) => void;
    resolve: (result: QuestionResult) => void;
  }[] = [];
  const commands: string[] = [];
  let callbacks!: VoiceCallbacks;
  let enabled = false,
    captures = 0,
    warm = false,
    cold = true;
  let voiceCount = 0;
  const backend: PlayerBackend = {
    question(_id, data, signal, progress) {
      return new Promise((resolve) =>
        requests.push({ data, signal, progress, resolve }),
      );
    },
    async live() {
      throw Error("Unexpected live negotiation");
    },
    async transcribe() {
      throw Error("Unexpected transcription");
    },
    async usage() {},
  };
  const voice: VoicePort = {
    get isEnabled() {
      return enabled;
    },
    get isWarm() {
      return warm;
    },
    get isCold() {
      return cold;
    },
    async enable() {
      enabled = true;
      callbacks.onStatus("arming");
      if (permission) await permission;
      if (enabled) callbacks.onStatus("armed");
    },
    beginManual() {
      captures++;
      callbacks.onSpeech(true);
      return true;
    },
    endManual() {
      callbacks.onSpeech(false);
    },
    async close() {
      enabled = false;
      callbacks.onStatus("off");
    },
    cancelCapture() {
      commands.push("cancelCapture");
    },
    mute(value) {
      commands.push(`mute:${value}`);
    },
    interrupt() {
      commands.push("interrupt");
    },
    playbackResumed() {
      commands.push("resumed");
    },
    append(type, content) {
      commands.push(`${type}:${content}`);
    },
    activity() {},
    setWorking(value) {
      commands.push(`working:${value}`);
    },
  };
  const session = new ListeningSession(audio, backend, {
    mode,
    clock,
    voiceFactory(_mic, _config, cb) {
      voiceCount++;
      callbacks = cb;
      return voice;
    },
  });
  session.configure({
    liveConfigured: true,
    microphone: { threshold: 0.025, minSpeechMs: 120, silenceMs: 650 },
    voiceLifecycle: {
      preRollMs: 750,
      graceMs: 5000,
      idleCloseMs: 60000,
      autoResumeMs: 3000,
    },
  });
  session.load(episode, { positionMs: 31000, history: [] });
  audio.positionMs = 31000;
  return {
    clock,
    audio,
    session,
    requests,
    commands,
    get callbacks() {
      return callbacks;
    },
    get captures() {
      return captures;
    },
    get enabled() {
      return enabled;
    },
    get voiceCount() {
      return voiceCount;
    },
    warm() {
      warm = true;
      cold = false;
    },
    answer(index: number, text = "简短回答") {
      requests[index].resolve({
        revision: requests[index].data.revision,
        action: "answer",
        answer: text,
        sources: [],
        tools: [],
      });
    },
  };
}

test("loading a checkpoint publishes only its complete state to persistence subscribers", () => {
  const s = setup();
  s.session.start();
  const observed: ReturnType<typeof s.session.checkpoint>[] = [];
  s.session.subscribe(() => observed.push(s.session.checkpoint()));
  const history = [
    { role: "user" as const, text: "Restored question" },
    { role: "assistant" as const, text: "Restored answer" },
  ];
  s.session.load({ ...episode, id: "another" }, { positionMs: 5000, history });
  assert.equal(observed.length, 1);
  assert.equal(observed[0].positionMs, 5000);
  assert.deepEqual(observed[0].history, history);
});

test("complete text action cancels older work and resumes at the fixed semantic anchor", async () => {
  const s = setup();
  s.session.start();
  s.session.submitQuestion("第一个问题");
  assert.equal(s.audio.playing, false);
  assert.equal(s.session.getSnapshot().state.interruption?.resumeMs, 20000);
  s.session.submitQuestion("新问题");
  assert.equal(s.requests[0].signal.aborted, true);
  s.answer(0, "过期答案");
  await flush();
  assert.equal(
    s.session.getSnapshot().history.some((turn) => turn.text === "过期答案"),
    false,
  );
  s.answer(1);
  await flush();
  assert.equal(s.session.getSnapshot().resumeSeconds, 3);
  s.clock.advance(2999);
  assert.equal(s.audio.playing, false);
  s.clock.advance(1);
  await flush();
  assert.equal(s.audio.playing, true);
  assert.equal(s.audio.positionMs, 20000);
  assert.equal(s.voiceCount, 0);
  s.session.dispose();
});
test("hold persists across follow-ups, while seek clears the interruption and pending work", async () => {
  const s = setup();
  s.session.start();
  s.session.submitQuestion("为什么");
  s.answer(0);
  await flush();
  s.session.holdResume();
  s.session.submitQuestion("多解释一点");
  s.answer(1);
  await flush();
  s.clock.advance(61000);
  await flush();
  assert.equal(s.audio.playing, false);
  assert.equal(s.session.getSnapshot().resumeHeld, true);
  assert.equal(s.session.getSnapshot().returnContext, "已听原文");
  s.session.submitQuestion("旧位置的问题");
  s.session.seek(65000);
  assert.equal(s.requests[2].signal.aborted, true);
  s.answer(2, "错误位置的回答");
  await flush();
  assert.equal(s.session.getSnapshot().state.interruption, undefined);
  assert.equal(s.session.getSnapshot().resumeHeld, false);
  assert.equal(s.audio.positionMs, 65000);
  assert.equal(
    s.session
      .getSnapshot()
      .history.some((turn) => turn.text === "错误位置的回答"),
    false,
  );
  s.session.dispose();
});
test("manual permission resolving after release or mode change cannot begin capture", async () => {
  for (const action of ["release", "switch"] as const) {
    let grant!: () => void;
    const s = setup(
      "manual",
      new Promise<void>((resolve) => {
        grant = resolve;
      }),
    );
    const pending = s.session.beginManual();
    if (action === "release") s.session.endManual();
    else s.session.setListeningMode("off");
    grant();
    await pending;
    await flush();
    assert.equal(s.captures, 0);
    assert.equal(s.enabled, false);
    assert.equal(s.session.getSnapshot().manualHeld, false);
    s.session.dispose();
  }
});
test("voice progress is excluded from latency and countdown starts after the answer audio", async () => {
  const s = setup("auto");
  s.session.start();
  await flush();
  s.callbacks.onSpeech(true);
  s.callbacks.onSpeech(false);
  s.callbacks.onFirstQuestion("为什么");
  s.requests[0].progress("working");
  s.clock.advance(1500);
  s.callbacks.onOutput(true);
  s.callbacks.onOutput(false);
  assert.equal(s.session.getSnapshot().latencies.length, 0);
  assert.equal(s.session.getSnapshot().resumeSeconds, null);
  s.answer(0);
  await flush();
  s.clock.advance(1000);
  assert.equal(s.session.getSnapshot().resumeSeconds, null);
  s.callbacks.onOutput(true);
  assert.deepEqual(s.session.getSnapshot().latencies, [
    { connection: "cold", milliseconds: 2500 },
  ]);
  s.clock.advance(1000);
  s.callbacks.onOutput(false);
  assert.equal(s.session.getSnapshot().resumeSeconds, 3);
  s.session.dispose();
});
test("warm transcript and delegation cancel countdown, then resume survives cloud failure", async () => {
  const s = setup("auto");
  s.session.start();
  await flush();
  s.callbacks.onSpeech(true);
  s.callbacks.onSpeech(false);
  s.callbacks.onFirstQuestion("为什么");
  s.answer(0);
  await flush();
  s.callbacks.onOutput(true);
  s.callbacks.onOutput(false);
  s.warm();
  s.callbacks.onSpeech(true);
  s.callbacks.onTranscript("user", "再解释");
  s.callbacks.onDelegation("follow-up");
  s.callbacks.onSpeech(false);
  s.clock.advance(450);
  assert.equal(s.requests.length, 2);
  assert.equal(s.session.getSnapshot().resumeSeconds, null);
  s.answer(1);
  await flush();
  s.callbacks.onOutput(true);
  s.callbacks.onOutput(false);
  s.callbacks.onSpeech(true);
  s.callbacks.onTranscript("user", "继续");
  s.callbacks.onSpeech(false);
  s.clock.advance(450);
  assert.equal(s.session.getSnapshot().state.mode, "resuming");
  s.callbacks.onError("connection failed");
  s.callbacks.onClose(false, 1, "s", false);
  s.callbacks.onTranscript("assistant", "过期字幕");
  s.callbacks.onDelegation("stale");
  s.clock.advance(1499);
  assert.equal(s.audio.playing, false);
  s.clock.advance(1);
  await flush();
  assert.equal(s.audio.playing, true);
  assert.equal(s.requests.length, 2);
  assert.equal(
    s.session
      .getSnapshot()
      .history.some((turn) => turn.text.includes("过期字幕")),
    false,
  );
  s.session.dispose();
});
test("a late failure from an old play promise cannot stop a newer manual recording", async () => {
  const s = setup("manual");
  let reject!: (error: Error) => void;
  s.audio.play = () =>
    new Promise<void>((_resolve, fail) => {
      reject = fail;
    });
  s.session.start();
  const recording = s.session.beginManual();
  reject(new Error("play interrupted"));
  await recording;
  await flush();
  assert.equal(s.captures, 1);
  assert.equal(s.session.getSnapshot().manualHeld, true);
  assert.equal(s.session.getSnapshot().error, "");
  s.session.dispose();
});

test("background keeps native podcast playback but cancels an unfinished question", async () => {
  const s = setup("manual");
  s.session.start();
  await flush();
  s.session.background();
  assert.equal(s.audio.playing, true);
  s.session.submitQuestion("An unfinished question");
  assert.equal(s.requests.length, 1);
  s.session.background();
  assert.equal(s.audio.playing, false);
  assert.equal(s.requests[0].signal.aborted, true);
  assert.deepEqual(s.session.checkpoint().history, []);
  assert.equal(s.session.checkpoint().resumeMs, 20000);
  s.clock.advance(60000);
  await flush();
  assert.equal(s.audio.playing, false);
  s.session.dispose();
});

test("a native asynchronous seek finishes before resumption starts the player", async () => {
  const s = setup();
  let finish!: () => void;
  Object.assign(s.audio, {
    seek: (positionMs: number) =>
      new Promise<void>((resolve) => {
        finish = () => {
          s.audio.positionMs = positionMs;
          resolve();
        };
      }),
  });
  s.session.seek(45000);
  s.session.start();
  await flush();
  assert.equal(s.audio.playing, false);
  finish();
  await flush();
  assert.equal(s.audio.playing, true);
  assert.equal(s.audio.positionMs, 45000);
  s.session.dispose();
});
