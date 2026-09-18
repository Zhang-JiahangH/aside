import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import type {
  VoiceCallbacks,
  VoiceFactory,
  VoicePort,
} from "@aside/player-runtime/ports";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

/** Exercise the shipped native controller; replace only unavailable OS/RTC boundaries. */
async function fixture(t: TestContext, stalledConnection = false) {
  class Recorder {
    uri: string | null = null;
    isRecording = false;
    currentTime = 0;
    async prepareToRecordAsync() {
      this.uri = "file:///question.m4a";
    }
    record() {
      this.isRecording = true;
      this.currentTime = 2;
    }
    async stop() {
      this.isRecording = false;
    }
  }
  class File {
    exists = true;
    size = 16000;
    delete() {
      this.exists = false;
    }
  }
  const peers: Peer[] = [];
  class Peer {
    constructor() {
      peers.push(this);
    }
    sent: { type: string; content?: string }[] = [];
    channel = {
      readyState: "open",
      onmessage: (_event: { data: string }) => {},
      send: (data: string) => {
        this.sent.push(JSON.parse(data));
        if (JSON.parse(data).type === "session.close")
          this.channel.onmessage({ data: '{"type":"session.closed"}' });
      },
      close() {},
    };
    outgoing: unknown[] = [];
    connectionState = "connected";
    onconnectionstatechange = () => {};
    closed = false;
    addTransceiver() {}
    addTrack(track: unknown) {
      this.outgoing.push(track);
    }
    createDataChannel() {
      return this.channel;
    }
    async createOffer() {
      return { sdp: "fixture-offer" };
    }
    async setLocalDescription() {}
    async setRemoteDescription() {
      this.channel.onmessage({ data: '{"type":"session.started"}' });
    }
    async getStats() {
      return new Map();
    }
    close() {
      this.closed = true;
      this.channel.readyState = "closed";
    }
  }
  const key = `asideVoiceTest_${crypto.randomUUID()}`;
  const globals = globalThis as unknown as Record<string, unknown>;
  globals[key] = { Recorder, File, Peer };
  const ref = `globalThis[${JSON.stringify(key)}]`;
  const modules: Record<string, string> = {
    "expo-audio": `export const AudioModule={AudioRecorder:${ref}.Recorder}; export const RecordingPresets={HIGH_QUALITY:{ios:{},android:{}}};`,
    "expo-file-system": `export const File=${ref}.File;`,
    "react-native":
      'export const Platform={OS:"ios"}; export class NativeEventEmitter {addListener(){return {remove(){}}}}; export const NativeModules={AsideAudioSession:{createSilentTrack: async () => ({id:"silence",kind:"audio",enabled:true,remote:false,readyState:"live"})}};',
    "react-native-webrtc": `export const RTCPeerConnection=${ref}.Peer; export class MediaStreamTrack { constructor(info) {Object.assign(this,info)} stop(){} release(){} }`,
  };
  const bundle = await build({
    entryPoints: ["mobile/src/voice.ts"],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "native-test-boundaries",
        setup(builder) {
          builder.onResolve(
            {
              filter:
                /^(expo-audio|expo-file-system|react-native|react-native-webrtc)$/,
            },
            ({ path }) => ({ path, namespace: "native-test" }),
          );
          builder.onLoad(
            { filter: /.*/, namespace: "native-test" },
            ({ path }) => ({ contents: modules[path], loader: "js" }),
          );
        },
      },
    ],
  });
  const { NativeVoice } = (await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  )) as { NativeVoice: new (...args: unknown[]) => VoicePort };
  delete globals[key];
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const statuses: string[] = [],
    recognized: string[] = [],
    questions: string[] = [],
    errors: string[] = [],
    outputs: boolean[] = [],
    closes: Parameters<VoiceCallbacks["onClose"]>[] = [],
    transcripts: string[] = [];
  const cb: VoiceCallbacks = {
    onReady() {},
    onOutput(value) {
      outputs.push(value);
    },
    onTranscript(_role, text) {
      transcripts.push(text);
    },
    onDelegation() {},
    onSpeech() {},
    onClose(...event) {
      closes.push(event);
    },
    onStatus: (status) => {
      statuses.push(status);
    },
    onFirstQuestion: (text) => {
      questions.push(text);
    },
    onQuestionRecognized: (text) => {
      recognized.push(text);
    },
    onError: (error) => {
      errors.push(error);
    },
  };
  const transcription = deferred<string>();
  const connection =
    deferred<Awaited<ReturnType<Parameters<VoiceFactory>[3]["create"]>>>();
  const voice = new NativeVoice(
    cb,
    {
      transcribe: () => transcription.promise,
      create: () =>
        stalledConnection
          ? connection.promise
          : Promise.resolve({
              session: { id: "fixture-session" },
              transport: { sdp: "fixture-answer" },
            }),
    },
    {
      record: async () => {},
      answer: async () => {},
      finishQuestion: async () => {},
    },
    { preRollMs: 750, graceMs: 5000, idleCloseMs: 2000 },
  );
  t.after(async () => {
    await voice.close();
  });
  await voice.enable();
  assert.equal(voice.beginManual(), true);
  await flush();
  voice.endManual();
  await flush();
  return {
    voice,
    statuses,
    recognized,
    questions,
    errors,
    transcription,
    connection,
    peers,
    outputs,
    closes,
    transcripts,
  };
}

test("native manual waiting releases its idle Live session without resuming the podcast", async (t) => {
  const s = await fixture(t);
  s.transcription.resolve("Question");
  await flush();
  s.voice.activity();
  t.mock.timers.tick(1999);
  await flush();
  assert.equal(s.voice.isEnabled, true);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(s.voice.isEnabled, false);
  assert.equal(s.statuses.at(-1), "off");
  assert.deepEqual(s.closes, [[true, 0, "fixture-session", true]]);
  assert.deepEqual(
    s.outputs,
    [],
    "closing idle Live must not request playback",
  );
});

test("native idle expiry waits for transcription, backend work and renewed activity", async (t) => {
  const s = await fixture(t);
  s.voice.activity();
  t.mock.timers.tick(3000);
  await flush();
  assert.equal(s.voice.isEnabled, true, "ASR is still pending");
  s.transcription.resolve("Question");
  await flush();
  s.voice.setWorking(true);
  t.mock.timers.tick(3000);
  await flush();
  assert.equal(s.voice.isEnabled, true, "backend work is still pending");
  s.voice.setWorking(false);
  t.mock.timers.tick(1500);
  s.peers[0].channel.onmessage({
    data: JSON.stringify({
      type: "session.output_transcript.delta",
      delta: "Answer",
    }),
  });
  t.mock.timers.tick(1500);
  await flush();
  assert.equal(
    s.voice.isEnabled,
    true,
    "recent answer activity resets idle time",
  );
  t.mock.timers.tick(500);
  await flush();
  assert.equal(s.voice.isEnabled, false);
});

test("server session expiry releases native resources and ignores late answer captions", async (t) => {
  const s = await fixture(t);
  s.transcription.resolve("Question");
  await flush();
  s.peers[0].channel.onmessage({ data: '{"type":"session.closed"}' });
  await flush();
  assert.equal(
    s.voice.isEnabled,
    false,
    "next hold must create a fresh voice instance",
  );
  assert.equal(s.voice.isWarm, false);
  assert.equal(s.peers[0].closed, true);
  assert.equal(s.statuses.at(-1), "off");
  assert.deepEqual(s.closes, [[true, 0, "fixture-session", false]]);
  s.peers[0].channel.onmessage({
    data: '{"type":"session.output_transcript.delta","delta":"stale"}',
  });
  assert.deepEqual(s.transcripts, []);
  assert.equal(s.voice.beginManual(), false);
});

test("active native answer audio and a new recording suppress idle closure", async (t) => {
  const s = await fixture(t);
  s.transcription.resolve("Question");
  await flush();
  let sample = 0;
  s.peers[0].getStats = async () =>
    new Map([
      [
        "audio",
        {
          type: "inbound-rtp",
          kind: "audio",
          totalAudioEnergy: ++sample * 0.02,
          totalSamplesDuration: sample * 0.1,
        },
      ],
    ]);
  for (let i = 0; i < 30; i++) {
    t.mock.timers.tick(100);
    await flush();
  }
  assert.deepEqual(s.outputs, [true]);
  assert.equal(s.voice.isEnabled, true, "ongoing audio must not expire");
  s.voice.interrupt();
  assert.equal(s.voice.beginManual(), true);
  await flush();
  t.mock.timers.tick(3000);
  await flush();
  assert.equal(s.voice.isEnabled, true, "a held recording must not expire");
});

test("a failed warm native peer is released so the next hold can reconnect", async (t) => {
  const s = await fixture(t);
  s.transcription.resolve("Question");
  await flush();
  s.peers[0].connectionState = "failed";
  s.peers[0].onconnectionstatechange();
  await flush();
  assert.match(s.errors[0], /Voice disconnected/);
  assert.equal(s.voice.isEnabled, false);
  assert.equal(s.peers[0].closed, true);
});

test("native voice keeps transcription progress visible when Live connects first", async (t) => {
  const s = await fixture(t);
  assert.equal(s.statuses.at(-1), "transcribing");
  assert.deepEqual(s.questions, []);
  s.transcription.resolve("  What did the speaker mean?  ");
  await flush();
  assert.deepEqual(s.questions, ["What did the speaker mean?"]);
  assert.deepEqual(s.recognized, s.questions);
  assert.equal(s.statuses.at(-1), "on");
});

test("native voice reports an empty transcription instead of submitting an invisible question", async (t) => {
  const s = await fixture(t);
  s.transcription.resolve("  \n ");
  await flush();
  assert.deepEqual(s.questions, []);
  assert.deepEqual(s.recognized, []);
  assert.match(s.errors[0] ?? "", /没有识别|speech/i);
});

test("native voice connection timeout includes the pending HTTP negotiation", async (t) => {
  const s = await fixture(t, true);
  s.transcription.resolve("What did the speaker mean?");
  await flush();
  assert.equal(s.statuses.at(-1), "connecting");
  assert.deepEqual(s.recognized, ["What did the speaker mean?"]);
  assert.deepEqual(
    s.questions,
    [],
    "the paid question must still wait for Live",
  );
  t.mock.timers.tick(30001);
  await flush();
  assert.match(s.errors[0] ?? "", /timed out/i);
  assert.deepEqual(s.questions, []);
});

test("a cancelled native capture cannot publish a late transcription", async (t) => {
  const s = await fixture(t);
  s.voice.cancelCapture();
  await flush();
  const statuses = [...s.statuses];
  s.transcription.resolve("A cancelled question");
  await flush();
  assert.deepEqual(s.statuses, statuses);
  assert.deepEqual(s.questions, []);
  assert.deepEqual(s.recognized, []);
  assert.deepEqual(s.errors, []);
});

test("a session arriving after timeout is closed without submitting the old question", async (t) => {
  const s = await fixture(t, true);
  s.transcription.resolve("A question that timed out");
  await flush();
  t.mock.timers.tick(30001);
  await flush();
  const statuses = [...s.statuses];
  s.connection.resolve({
    session: { id: "late-session" },
    transport: { sdp: "late-answer" },
  } as Awaited<ReturnType<Parameters<VoiceFactory>[3]["create"]>>);
  await flush();
  assert.deepEqual(s.questions, []);
  assert.deepEqual(s.statuses, statuses);
  assert.equal(s.errors.length, 1);
});

// A held follow-up can begin while the cold Live HTTP request is still in flight.
test("rapid native re-recording reuses the in-flight Live connection", async (t) => {
  const s = await fixture(t, true);
  assert.equal(s.peers.length, 1);
  assert.equal(s.voice.beginManual?.(), true);
  await flush();
  s.voice.endManual?.();
  await flush();
  assert.equal(s.peers.length, 1);
  s.connection.resolve({
    session: { id: "shared-session" },
    transport: { sdp: "answer" },
  });
  s.transcription.resolve("Newest question");
  await flush();
  assert.deepEqual(s.questions, ["Newest question"]);
});

test("native Live supplies a silent input track to advance the model audio timeline", async (t) => {
  const s = await fixture(t);
  assert.equal(s.peers[0].outgoing.length, 1);
  assert.equal((s.peers[0].outgoing[0] as { id: string }).id, "silence");
});

test("native Live receives the actual recognized question and language before answering", async (t) => {
  const s = await fixture(t);
  s.transcription.resolve("What is this interview about?");
  await flush();
  const thinking = s.peers[0].sent.find(
    (e) => e.type === "session.thinking.append",
  );
  assert.match(
    thinking?.content ?? "",
    /Latest actual user utterance.*What is this interview about/,
  );
  assert.ok(
    s.peers[0].sent.some(
      (e) =>
        e.type === "session.instructions.append" &&
        e.content?.includes("language"),
    ),
  );
});

test("Opus comfort noise does not start or prolong native answer playback", async (t) => {
  const s = await fixture(t);
  s.transcription.resolve("Question");
  await flush();
  let energy = 1e-8,
    duration = 1;
  s.peers[0].getStats = async () =>
    new Map([
      [
        "audio",
        {
          type: "inbound-rtp",
          kind: "audio",
          totalAudioEnergy: energy,
          totalSamplesDuration: duration,
        },
      ],
    ]);
  t.mock.timers.tick(100);
  await flush();
  assert.deepEqual(s.outputs, []);
  energy = 0.02;
  duration = 1.1;
  t.mock.timers.tick(100);
  await flush();
  assert.deepEqual(s.outputs, [true]);
  energy += 1e-9;
  duration = 2.5;
  t.mock.timers.tick(1400);
  await flush();
  assert.deepEqual(s.outputs, [true, false]);
});
