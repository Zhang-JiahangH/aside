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
    close() {}
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
    questions: string[] = [],
    errors: string[] = [],
    outputs: boolean[] = [];
  const cb: VoiceCallbacks = {
    onReady() {},
    onOutput(value) {
      outputs.push(value);
    },
    onTranscript() {},
    onDelegation() {},
    onSpeech() {},
    onClose() {},
    onStatus: (status) => {
      statuses.push(status);
    },
    onFirstQuestion: (text) => {
      questions.push(text);
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
    questions,
    errors,
    transcription,
    connection,
    peers,
    outputs,
  };
}

test("native voice keeps transcription progress visible when Live connects first", async (t) => {
  const s = await fixture(t);
  assert.equal(s.statuses.at(-1), "transcribing");
  assert.deepEqual(s.questions, []);
  s.transcription.resolve("  What did the speaker mean?  ");
  await flush();
  assert.deepEqual(s.questions, ["What did the speaker mean?"]);
  assert.equal(s.statuses.at(-1), "on");
});

test("native voice reports an empty transcription instead of submitting an invisible question", async (t) => {
  const s = await fixture(t);
  s.transcription.resolve("  \n ");
  await flush();
  assert.deepEqual(s.questions, []);
  assert.match(s.errors[0] ?? "", /没有识别|speech/i);
});

test("native voice connection timeout includes the pending HTTP negotiation", async (t) => {
  const s = await fixture(t, true);
  s.transcription.resolve("What did the speaker mean?");
  await flush();
  assert.equal(s.statuses.at(-1), "connecting");
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
