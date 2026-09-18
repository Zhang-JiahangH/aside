import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type WebSocket from "ws";
import { LiveControl } from "../backend/src/live-control.js";
import { attachLiveSideband } from "../backend/src/live-sideband.js";
import { readLiveControl } from "../frontend/src/live-control-stream.js";
import { createPlayerConfig } from "@aside/engine/player";
import type { Analysis } from "@aside/engine/core";
import type { LiveControlEvent } from "@aside/engine/contracts";
const analysis: Analysis = {
  version: "1",
  source: "demo",
  summary: "",
  hostStyle: "",
  speakers: [],
  voice: "masculine",
  voiceReason: "",
  passages: [
    { id: "a", startMs: 0, endMs: 20000, text: "First passage", speaker: "host" },
  ],
  anchors: [],
};
const player = {
  version: 0,
  sequence: 0,
  revision: 0,
  positionMs: 1000,
  wasPlaying: true,
  audibleSource: "podcast" as const,
  config: createPlayerConfig(),
};
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const functionCall = (name: string, args: unknown, call_id = "call") => ({
  type: "response.event",
  delegation_id: "d",
  event: {
    type: "response.output_item.done",
    item: { type: "function_call", call_id, name, arguments: JSON.stringify(args) },
  },
});

test("a longer session admits more than 30 tool calls while retaining its configured cap", async () => {
  const sent: Record<string, unknown>[] = [];
  const c = new LiveControl(
    "long-session",
    { player, debug: false },
    analysis,
    (event) => sent.push(event),
    undefined,
    32,
  );
  const reading = assert.rejects(
    readLiveControl(c.subscribe(), () => {}),
    /tool call limit/,
  );
  for (let i = 0; i < 33; i++) {
    c.receive(functionCall("get_passage", { atMs: 1000 }, `c${i}`));
    await flush();
  }
  await reading;
  assert.equal(
    sent.filter((e) => e.type === "response.item.create").length,
    32,
  );
  c.close();
});

test("one authenticated session stream carries decisions, heartbeat and graceful close", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const events: LiveControlEvent[] = [];
  const sent: Record<string, unknown>[] = [];
  const c = new LiveControl(
    "session",
    { player, debug: true },
    analysis,
    (event) => sent.push(event),
  );
  const response = c.subscribe();
  const reading = readLiveControl(response, (event) => events.push(event));
  assert.equal(c.subscribe().status, 409);
  assert.equal(c.update({ sessionId: "wrong", player }), false);
  assert.equal(
    c.update({ sessionId: "session", player: { ...player, sequence: 1 } }),
    true,
  );
  c.receive({
    type: "session.input_transcript.delta",
    delta: "Dinner plans",
    start_ms: 0,
    end_ms: 100,
  });
  c.receive({
    type: "session.delegation.created",
    delegation: { id: "d", target: "responses" },
  });
  c.receive(functionCall("ignore_input", {}, "c1"));
  await flush();
  c.receive({
    type: "session.input_transcript.delta",
    delta: "What was that?",
    start_ms: 2000,
    end_ms: 2100,
  });
  c.receive({
    type: "session.delegation.created",
    delegation: { id: "d2", target: "responses" },
  });
  c.receive({
    type: "response.event",
    delegation_id: "d2",
    event: { type: "response.output_text.delta", delta: "That was the host." },
  });
  await flush();
  t.mock.timers.tick(15000);
  await flush();
  c.close();
  await reading;
  assert.deepEqual(
    events.filter((e) => e.type === "observing").map((e) => e.text),
    ["Dinner plans", "What was that?"],
  );
  assert.equal(events.filter((e) => e.type === "decision").length, 1);
  assert.equal(events.filter((e) => e.type === "engage").length, 1);
  assert.ok(events.some((e) => e.type === "heartbeat"));
  assert.equal(events.at(-1)?.type, "closed");
  assert.equal(c.update({ sessionId: "session", player }), false);
  assert.deepEqual(
    sent.map((e) => e.type),
    ["response.item.create", "response.create"],
  );
});

test("a report pending at disconnect resolves as rejected and nothing runs before subscription", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const sent: Record<string, unknown>[] = [];
  const c = new LiveControl(
    "session",
    { player, debug: false },
    analysis,
    (event) => sent.push(event),
  );
  // Events before any browser subscription are still supplier truth; the
  // pause decision has nowhere to go and must not block the tool result forever.
  c.receive(functionCall("control_podcast", { commands: [{ type: "pause" }] }));
  await flush();
  assert.equal(sent.length, 0);
  const response = c.subscribe();
  await response.body!.cancel();
  await flush();
  // The stream is gone and the session with it: the pending command resolves
  // rather than leaking, and nothing is sent to a supplier we are leaving.
  assert.equal(sent.length, 0);
  c.close();
  assert.equal(c.subscribe().status, 409);
  c.receive(functionCall("get_passage", { atMs: 1000 }, "late"));
  await flush();
  assert.equal(sent.length, 0, "a closed control executes nothing");
});

test("sideband loss is an explicit stream error and a stalled tab has a bounded queue", async () => {
  const make = () =>
    new LiveControl("session", { player, debug: false }, analysis, () => {});
  const c = make(),
    response = c.subscribe();
  c.close("Sideband disconnected");
  await assert.rejects(
    readLiveControl(response, () => {}),
    /Sideband disconnected/,
  );
  const stalled = make();
  const stream = stalled.subscribe();
  for (let i = 0; i < 80; i++)
    stalled.receive({ type: "session.input_transcript.delta", delta: "a" });
  const events: LiveControlEvent[] = [];
  await readLiveControl(stream, (e) => events.push(e));
  assert.ok(events.length <= 68);
  assert.equal(events.at(-1)?.type, "closed");
});

test("NDJSON parser handles split UTF-8, multiple results, malformed frames and early EOF", async () => {
  const encoder = new TextEncoder();
  const chunks = [
    '{"type":"ready","sessionId":"s"}\n{"type":"observing","version":0,"text":"你',
    '好"}\n{"type":"heartbeat"}\n',
  ];
  const events: LiveControlEvent[] = [];
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        const bytes = encoder.encode(chunk);
        controller.enqueue(bytes.slice(0, 5));
        controller.enqueue(bytes.slice(5));
      }
      controller.close();
    },
  });
  await assert.rejects(
    readLiveControl(
      new Response(stream, {
        headers: { "Content-Type": "application/x-ndjson" },
      }),
      (e) => events.push(e),
    ),
    /disconnected/,
  );
  assert.deepEqual(
    events.map((e) => e.type),
    ["ready", "observing", "heartbeat"],
  );
  assert.equal(events[1].type === "observing" && events[1].text, "你好");
  await assert.rejects(
    readLiveControl(
      new Response('{"type":"bogus"}\n', {
        headers: { "Content-Type": "application/x-ndjson" },
      }),
      () => {},
    ),
  );
  await assert.rejects(
    readLiveControl(new Response("{}", { status: 500 }), () => {}),
    /Voice control connection failed/,
  );
});

test("sideband adapter parses frames, forwards close and fails on handshake errors", async () => {
  class FakeSocket extends EventEmitter {
    sent: string[] = [];
    send(text: string) {
      this.sent.push(text);
    }
    close() {
      this.emit("close");
    }
  }
  const fake = new FakeSocket();
  const received: Record<string, unknown>[] = [];
  let closed = 0;
  const pending = attachLiveSideband(
    "key",
    "session-id",
    (event) => received.push(event),
    () => closed++,
    (url, options) => {
      assert.equal(url, "wss://api.openai.com/v1/live/sessions/session-id/attach");
      assert.equal(
        (options.headers as Record<string, string>).Authorization,
        "Bearer key",
      );
      return fake as unknown as WebSocket;
    },
  );
  fake.emit("open");
  const sideband = await pending;
  fake.emit("message", Buffer.from('{"type":"session.started"}'));
  fake.emit("message", Buffer.from("not json"));
  sideband.send("hello");
  sideband.close();
  assert.deepEqual(received, [{ type: "session.started" }]);
  assert.deepEqual(fake.sent, ["hello"]);
  assert.equal(closed, 1);
  const failing = new FakeSocket();
  const rejected = attachLiveSideband(
    "key",
    "s",
    () => {},
    () => {},
    () => failing as unknown as WebSocket,
  );
  failing.emit("error", Error("refused"));
  await assert.rejects(rejected, /refused/);
});
