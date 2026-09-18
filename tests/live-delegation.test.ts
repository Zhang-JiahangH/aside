import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveDelegation } from "../backend/src/live-delegation.js";
import { createPlayerConfig } from "@aside/engine/player";
import type { Analysis } from "@aside/engine/core";
import type {
  LiveControlEvent,
  LivePlayerState,
} from "@aside/engine/contracts";

const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const analysis: Analysis = {
  version: "1",
  source: "demo",
  summary: "",
  hostStyle: "calm",
  speakers: [],
  voice: "masculine",
  voiceReason: "",
  passages: [
    { id: "a", startMs: 0, endMs: 20000, text: "Walking makes room for thought.", speaker: "host" },
    { id: "b", startMs: 20000, endMs: 40000, text: "A biography tells someone else's life story.", speaker: "host" },
    { id: "c", startMs: 40000, endMs: 60000, text: "An autobiography tells your own.", speaker: "host" },
  ],
  anchors: [],
};
const state = (patch: Partial<LivePlayerState> = {}): LivePlayerState => ({
  version: 0,
  sequence: 0,
  revision: 1,
  positionMs: 45000,
  wasPlaying: true,
  audibleSource: "podcast",
  config: createPlayerConfig(),
  ...patch,
});
function setup(debug = false, limit = 30) {
  let now = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  let next = 0;
  const events: LiveControlEvent[] = [];
  const sent: Record<string, any>[] = [];
  const costs: unknown[] = [];
  const shadowed: { text: string; interrupted: boolean; decided: string[]; closed: boolean }[] = [];
  const delegation = new LiveDelegation(
    state(),
    analysis,
    {
      emit: (event) => events.push(event),
      send: (event) => sent.push(event),
      now: () => now,
      after: (delay, run) => {
        const id = next++;
        timers.set(id, { at: now + delay, run });
        return () => {
          timers.delete(id);
        };
      },
      telemetry: (totals) => costs.push(totals),
      shadow: ({ text, interrupted }) => {
        const entry = { text, interrupted, decided: [] as string[], closed: false };
        shadowed.push(entry);
        return {
          decided: (action) => entry.decided.push(action),
          close: () => (entry.closed = true),
        };
      },
    },
    debug,
    limit,
  );
  const advance = async (ms = 200) => {
    now += ms;
    for (const [id, t] of [...timers])
      if (t.at <= now) {
        timers.delete(id);
        t.run();
      }
    await flush();
  };
  let timeline = 0;
  const speak = (delta: string) => {
    delegation.receive({
      type: "session.input_transcript.delta",
      delta,
      start_ms: timeline,
      end_ms: timeline + 100,
    });
    timeline += 100;
  };
  let currentId = "d1";
  const delegate = (id = "d1") => {
    currentId = id;
    delegation.receive({
      type: "session.delegation.created",
      delegation: { id, type: "delegation", target: "responses" },
    });
  };
  const backend = (event: Record<string, unknown>, delegation_id = currentId) =>
    delegation.receive({ type: "response.event", delegation_id, event });
  const call = (name: string, args: unknown, call_id = "call-1") =>
    backend({
      type: "response.output_item.done",
      item: { type: "function_call", call_id, name, arguments: JSON.stringify(args) },
    });
  const decisions = () =>
    events.filter((e): e is Extract<LiveControlEvent, { type: "decision" }> => e.type === "decision");
  const engages = () =>
    events.filter((e): e is Extract<LiveControlEvent, { type: "engage" }> => e.type === "engage");
  const outputs = () =>
    sent
      .filter((e) => e.type === "response.item.create")
      .map((e) => JSON.parse(e.item.output));
  let sequence = 0;
  const ack = (decisionId: string, applied = true, patch: Partial<LivePlayerState> = {}) =>
    delegation.update(state({ sequence: ++sequence, ...patch }), { decisionId, applied });
  return { delegation, events, sent, costs, shadowed, advance, speak, delegate, backend, call, decisions, engages, outputs, ack };
}

test("a podcast lookup engages the browser and returns passages over the sideband", async () => {
  const s = setup(true);
  s.speak("What is a biography?");
  assert.equal(s.events.at(-1)?.type, "observing");
  s.delegate();
  assert.equal(s.events.at(-1)?.type, "classifying");
  s.call("search_podcast", { query: "biography" });
  await flush();
  const [engage] = s.engages();
  assert.ok(engage, "a lookup means the backend is answering");
  assert.equal(engage.text, "What is a biography?");
  assert.equal(engage.player.positionMs, 45000);
  assert.equal(engage.player.wasPlaying, true);
  assert.deepEqual(
    s.sent.map((e) => e.type),
    ["response.item.create", "response.create"],
    "tool output then continuation, nothing else",
  );
  assert.equal(s.sent[0].item.call_id, "call-1");
  assert.equal(s.sent[0].item.type, "function_call_output");
  assert.equal("delegation_id" in s.sent[0], false);
  assert.match(s.sent[0].item.output, /biography/);
  // The continuation is its own response; its text is the whole remaining reply.
  s.backend({ type: "response.completed", response: {} });
  s.backend({ type: "response.created" });
  s.backend({ type: "response.output_text.delta", delta: "A biography " });
  s.backend({ type: "response.output_text.delta", delta: "is a life story." });
  s.backend({
    type: "response.completed",
    response: {
      model: "gpt-5.6-luna",
      service_tier: "priority",
      usage: {
        input_tokens: 3000,
        input_tokens_details: { cached_tokens: 2000 },
        output_tokens: 90,
        output_tokens_details: { reasoning_tokens: 30 },
      },
    },
  });
  const answered = s.events.find((e) => e.type === "answered");
  assert.equal(answered?.type, "answered");
  assert.equal(answered?.type === "answered" && answered.decisionId, engage.decisionId);
  assert.equal(answered?.type === "answered" && answered.answer, "A biography is a life story.");
  assert.equal(answered?.type === "answered" && answered.sources.length > 0, true);
  assert.equal(answered?.type === "answered" && answered.final, true, "no tool call follows: the reply is complete");
  assert.equal(s.engages().length, 1, "one engage per delegation");
  assert.deepEqual(s.costs, [
    { model: "gpt-5.6-luna", rounds: 1, tiers: ["priority"], inputTokens: 3000, cachedInputTokens: 2000, outputTokens: 90, reasoningTokens: 30 },
  ]);
  s.delegation.close();
});

test("an answer without tools engages at its first text delta", async () => {
  const s = setup();
  s.speak("Say that again?");
  s.delegate();
  s.backend({ type: "response.output_text.delta", delta: "Sure." });
  assert.equal(s.engages().length, 1);
  s.backend({ type: "response.output_text.delta", delta: " Walking makes room." });
  s.backend({ type: "response.completed", response: {} });
  assert.equal(s.engages().length, 1);
  assert.equal(s.events.filter((e) => e.type === "answered").length, 1);
  s.delegation.close();
});

test("heard speech reaches Responses even when Live emits no delegation event", async () => {
  const s = setup();
  s.speak("200 文大概多少钱");
  await s.advance(600);
  assert.deepEqual(
    s.sent.map((event) => event.type),
    ["response.item.create", "response.create"],
  );
  const item = s.sent[0].item;
  assert.equal(item.type, "message");
  assert.equal(
    item.role,
    "user",
    "recognized speech remains untrusted user data",
  );
  assert.equal(item.content[0].type, "input_text");
  const snapshot = JSON.parse(item.content[0].text);
  assert.equal(snapshot.voiceInput.text, "200 文大概多少钱");
  assert.equal(snapshot.voiceInput.turnId, snapshot.player.turnId);
  assert.equal(snapshot.player.source, "voice");
  assert.equal(snapshot.player.positionMs, 45000);
  assert.equal(snapshot.player.wasPlaying, true);
  assert.equal(s.sent.filter((e) => e.type === "response.create").length, 1);
  assert.equal(
    s.engages().length,
    0,
    "requesting interpretation does not open audio",
  );
  assert.equal(
    s.decisions().length,
    0,
    "requesting interpretation does not pause playback",
  );
  s.backend({
    type: "response.created",
    response: { id: "fallback-response" },
  });
  s.backend({ type: "response.output_text.delta", delta: "要看时代和地区。" });
  s.backend({ type: "response.completed", response: {} });
  assert.equal(s.engages().length, 1);
  assert.equal(s.engages()[0].text, "200 文大概多少钱");
  assert.equal(
    s.events.some((e) => e.type === "answered"),
    true,
  );
  await s.advance(12000);
  assert.equal(s.sent.filter((e) => e.type === "response.create").length, 1);
  assert.equal(
    s.events.some((e) => e.type === "error"),
    false,
  );
  s.delegation.close();
});

test("a fallback carries the current audible assistant and preserves the utterance's original player state", async () => {
  const s = setup();
  s.speak("Yes");
  const assistant = {
    decisionId: "reply",
    text: "Shall I resume?",
    state: "quiet" as const,
  };
  s.delegation.update(
    state({
      sequence: 1,
      positionMs: 47000,
      wasPlaying: false,
      audibleSource: "none",
      playback: {
        mode: "awaiting_followup",
        interrupted: true,
        resumeMs: 44000,
      },
      assistant,
    }),
  );
  await s.advance(600);
  const message = s.sent.find((event) => event.item?.type === "message");
  assert.ok(
    message,
    "the backend must receive actual input before response.create",
  );
  const snapshot = JSON.parse(message.item.content[0].text);
  assert.equal(snapshot.player.positionMs, 45000);
  assert.equal(snapshot.conversation.playback.positionMs, 47000);
  assert.equal(
    snapshot.conversation.playback.playback.mode,
    "awaiting_followup",
  );
  assert.deepEqual(snapshot.conversation.assistant, assistant);
  s.delegation.close();
});

test("rejected transcript input is an explicit error even after response.created", async () => {
  const s = setup();
  s.speak("What did he mean?");
  await s.advance(600);
  const message = s.sent.find((event) => event.item?.type === "message");
  assert.ok(message);
  s.backend({ type: "response.created", response: {} });
  s.delegation.receive({
    type: "error",
    error: { client_event_id: message.event_id, code: "invalid_value" },
  });
  assert.equal(s.events.at(-1)?.type, "error");
  await s.advance(10000);
  assert.equal(s.events.filter((event) => event.type === "error").length, 1);
});

test("a fallback still lets the model ignore bystanders without an interruption", async () => {
  const s = setup();
  s.speak("Honey, what should we eat tonight?");
  await s.advance(600);
  assert.equal(s.sent.filter((e) => e.type === "response.create").length, 1);
  s.backend({ type: "response.created", response: {} });
  s.call("ignore_input", {});
  s.backend({ type: "response.completed", response: {} });
  await flush();
  s.backend({ type: "response.completed", response: {} });
  await s.advance(12000);
  assert.deepEqual(
    s.decisions().map((e) => e.result.action),
    ["ignore"],
  );
  assert.equal(s.engages().length, 0);
  assert.equal(
    s.events.some((e) => e.type === "error"),
    false,
  );
  s.delegation.close();
});

test("manual player changes cancel an unrequested fallback", async () => {
  const s = setup();
  s.speak("Please explain that");
  s.delegation.update(state({ sequence: 1, version: 1 }));
  await s.advance(12000);
  assert.equal(s.sent.length, 0);
  s.delegation.close();
});

test("a rejected or missing fallback and a failed backend produce an explicit error", async () => {
  for (const failure of ["timeout", "rejected", "failed"] as const) {
    const s = setup(true);
    s.speak("What was that?");
    await s.advance(600);
    if (failure === "timeout") await s.advance(10000);
    else if (failure === "rejected")
      s.delegation.receive({
        type: "error",
        error: { client_event_id: s.sent[0].event_id },
      });
    else s.backend({ type: "response.failed", response: {} });
    assert.equal(s.events.at(-1)?.type, "error");
    s.delegation.close();
  }
});

test("a fallback respects the session's existing request budget", async () => {
  const s = setup(false, 0);
  s.speak("What is that?");
  await s.advance(600);
  assert.equal(s.sent.length, 0);
  assert.equal(s.events.at(-1)?.type, "error");
});

for (const initialDecision of ["wait_for_input", "ignore_input"])
  test(`new speech after ${initialDecision} receives a second interpretation, not a repeated pause`, async () => {
    const s = setup();
    s.speak("When");
    await s.advance(600);
    s.backend({ type: "response.created", response: {} });
    s.call(initialDecision, {});
    s.backend({ type: "response.completed", response: {} });
    await flush();
    s.backend({ type: "response.completed", response: {} });
    s.speak(" did that happen?");
    await s.advance(600);
    const inputs = s.sent
      .filter((event) => event.item?.type === "message")
      .map((event) => JSON.parse(event.item.content[0].text));
    assert.deepEqual(
      inputs.map((input) => input.voiceInput.text),
      ["When", "When did that happen?"],
    );
    assert.equal(
      inputs[0].voiceInput.turnId,
      inputs[1].voiceInput.turnId,
      "new words revise the same utterance",
    );
    assert.equal(
      s.sent.filter((e) => e.type === "response.create").length,
      3,
      "first request, tool continuation, then new interpretation",
    );
    s.backend({ type: "response.created", response: {} }, "d2");
    s.backend({ type: "response.output_text.delta", delta: "In 1921." }, "d2");
    s.backend({ type: "response.completed", response: {} }, "d2");
    s.backend(
      { type: "response.output_text.delta", delta: "Old response" },
      "d1",
    );
    assert.equal(s.engages()[0].text, "When did that happen?");
    assert.equal(s.engages().length, 1);
    s.delegation.close();
  });

test("invalidated delegations cannot answer or control playback, but their usage is recorded", async () => {
  const s = setup();
  s.speak("Please explain");
  s.delegate();
  s.delegation.update(state({ sequence: 1, version: 1 }));
  s.delegate();
  s.backend({ type: "response.output_text.delta", delta: "Stale answer" });
  s.call("resume_podcast", {});
  s.backend({
    type: "response.completed",
    response: { usage: { input_tokens: 10, output_tokens: 5 } },
  });
  await s.advance(12000);
  assert.equal(s.engages().length, 0);
  assert.equal(s.decisions().length, 0);
  assert.equal(s.sent.length, 0);
  assert.equal(s.costs.length, 1);
  s.delegation.close();
});

test("a later utterance has its own fallback and old delegation events cannot answer it", async () => {
  const s = setup();
  s.speak("First question");
  s.delegate();
  s.backend({ type: "response.output_text.delta", delta: "First answer" });
  s.backend({ type: "response.completed", response: {} });
  const first = s.engages()[0];
  s.delegation.receive({
    type: "session.input_transcript.delta",
    delta: "Second question",
    start_ms: 3000,
    end_ms: 3300,
  });
  const observing = s.events.at(-1);
  assert.equal(observing?.type, "observing");
  assert.notEqual(
    observing?.type === "observing" && observing.input?.turnId,
    first.input?.turnId,
  );
  await s.advance(600);
  s.backend(
    { type: "response.output_text.delta", delta: "Stale answer" },
    "d1",
  );
  assert.equal(s.engages().length, 1);
  s.backend(
    { type: "response.output_text.delta", delta: "Second answer" },
    "d2",
  );
  s.backend({ type: "response.completed", response: {} }, "d2");
  assert.equal(s.engages()[1].text, "Second question");
  assert.equal(
    s.events.some((e) => e.type === "answered" && e.answer.includes("Stale")),
    false,
  );
  s.delegation.close();
});

test("late output from a completed response cannot cancel the next utterance's fallback", async () => {
  const s = setup();
  s.speak("First question");
  s.delegate();
  s.backend({ type: "response.output_text.delta", delta: "First answer" });
  s.backend({ type: "response.completed", response: {} });
  s.delegation.receive({ type: "session.input_transcript.delta", delta: "Next question", start_ms: 3000, end_ms: 3300 });
  s.backend({ type: "response.output_text.done" });
  await s.advance(600);
  assert.equal(s.sent.filter((e) => e.type === "response.create").length, 1);
  s.delegation.close();
});

test("a player command waits for the browser's report before the tool result returns", async () => {
  const s = setup();
  s.speak("A little slower please");
  s.delegate();
  s.call("control_podcast", { commands: [{ type: "adjust_rate", direction: "slower" }] });
  await flush();
  const [decision] = s.decisions();
  assert.equal(decision.result.action, "player_control");
  assert.equal(decision.text, "A little slower please");
  assert.equal(s.sent.length, 0, "nothing returns until the client reports");
  s.ack(decision.decisionId, true, { config: { ...createPlayerConfig(), playbackRate: 0.9 } });
  await flush();
  assert.equal(s.sent.length, 2);
  const [output] = s.outputs();
  assert.equal(output.accepted, true);
  assert.equal(output.player.playbackRate, 0.9);
  assert.equal(s.engages().length, 0, "a pure control never opens the reply window");
  s.backend({ type: "response.completed", response: {} });
  assert.equal(
    s.events.at(-1)?.type,
    "discard",
    "a control-only turn tells the client to drop buffered voice output",
  );
  s.delegation.close();
});

test("a rejected or unanswered command is reported honestly and the session survives", async () => {
  const s = setup();
  s.speak("Pause");
  s.delegate();
  s.call("control_podcast", { commands: [{ type: "pause" }] }, "c1");
  await flush();
  const first = s.decisions()[0];
  // The listener already said "Pause": the local fast path took it, and the
  // backend's identical pause is answered from that outcome.
  assert.equal(
    first.result.action === "player_control" &&
      first.result.commandId.endsWith(":fast-pause"),
    true,
  );
  assert.equal(s.sent.length, 0, "the fast pause is still waiting for the client");
  s.ack(first.decisionId, true, { wasPlaying: false, audibleSource: "none" });
  await flush();
  assert.equal(s.outputs()[0].accepted, true);
  s.speak("Louder");
  s.delegate("d2");
  s.call("control_podcast", { commands: [{ type: "set_volume", volume: 1 }] }, "c2");
  await flush();
  const second = s.decisions().at(-1)!;
  s.ack(second.decisionId, false);
  await flush();
  assert.equal(s.outputs()[1].accepted, false);
  s.speak("Skip ahead");
  s.delegate("d3");
  s.call("control_podcast", { commands: [{ type: "skip", direction: "forward" }] }, "c3");
  await flush();
  assert.equal(s.sent.length, 4);
  await s.advance(10000);
  assert.equal(s.sent.length, 6, "an unanswered report times out into a rejection");
  assert.equal(s.outputs()[2].accepted, false);
  assert.equal(s.events.some((e) => e.type === "error"), false);
  s.delegation.close();
});

test("a bare pause word stops the podcast before any delegation and the backend's pause is deduplicated", async () => {
  const s = setup();
  s.speak("等一下");
  await flush();
  const [decision] = s.decisions();
  assert.equal(decision.result.action, "player_control");
  assert.equal(decision.result.action === "player_control" && decision.result.commands[0].type, "pause");
  s.ack(decision.decisionId, true, { wasPlaying: false, audibleSource: "none" });
  s.delegate();
  s.call("control_podcast", { commands: [{ type: "pause" }] });
  await flush();
  assert.equal(s.decisions().length, 1, "no second pause decision");
  assert.equal(s.outputs()[0].accepted, true);
  s.delegation.close();
});

test("a pause word followed by a question engages on the follow-up only", async () => {
  const s = setup();
  s.speak("Hold on");
  await flush();
  assert.equal(s.decisions().length, 1);
  s.speak(", what does that mean?");
  await flush();
  assert.equal(s.decisions().length, 1, "the growing sentence is no longer a bare pause");
  s.ack(s.decisions()[0].decisionId, true, { wasPlaying: false, audibleSource: "none" });
  s.delegate();
  s.call("control_podcast", { commands: [{ type: "pause" }], followUpQuestion: "What does that mean?" });
  await flush();
  assert.equal(s.decisions().length, 1);
  const [engage] = s.engages();
  assert.equal(engage.text, "What does that mean?");
  assert.equal(s.outputs()[0].accepted, true);
  s.delegation.close();
});

test("bystander speech is ignored silently and a fresh utterance can still engage", async () => {
  const s = setup(true);
  s.speak("Honey, what should we eat?");
  s.delegate();
  s.call("ignore_input", {});
  await flush();
  const [ignore] = s.decisions();
  assert.equal(ignore.result.action, "ignore");
  assert.equal(ignore.text, "");
  assert.equal(s.outputs()[0].accepted, true);
  s.backend({ type: "response.output_text.delta", delta: "[hum]" });
  s.backend({ type: "response.completed", response: {} });
  assert.equal(s.engages().length, 0, "text after ignore never opens the reply window");
  assert.equal(s.events.some((e) => e.type === "answered"), false);
  s.speak("Aside, what is an autobiography?");
  s.delegate("d2");
  s.call("get_passage", { atMs: 45000 }, "c2");
  await flush();
  assert.equal(s.engages().length, 1);
  s.delegation.close();
});

test("resume waits for the client and a manual action cancels a pending report", async () => {
  const s = setup();
  s.speak("OK, go on");
  s.delegate();
  s.call("resume_podcast", {});
  await flush();
  const [decision] = s.decisions();
  assert.equal(decision.result.action, "resume");
  // The listener pressed play themselves: version bump, the report never comes.
  s.delegation.update(state({ sequence: 1, version: 1, wasPlaying: true }));
  await flush();
  assert.equal(s.outputs()[0].accepted, false);
  s.delegation.close();
});

test("the backend's transcript window follows playback with session.update, at most once per passage", async () => {
  const s = setup();
  s.delegation.update(state({ sequence: 1, positionMs: 47000 }));
  assert.equal(s.sent.length, 0, "same passage: no refresh");
  s.delegation.update(state({ sequence: 2, positionMs: 21000 }));
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].type, "session.update");
  assert.equal(s.sent[0].session.delegation.type, "responses");
  assert.match(s.sent[0].session.delegation.responses.instructions, /playheadMs 21000/);
  assert.match(s.sent[0].session.delegation.responses.instructions, /Walking makes room/);
  assert.doesNotMatch(s.sent[0].session.delegation.responses.instructions, /autobiography tells your own/);
  s.delegation.update(state({ sequence: 3, positionMs: 1000 }));
  assert.equal(s.sent.length, 1, "rate limited to every 3 seconds");
  await s.advance(3000);
  assert.equal(s.sent.length, 2);
  assert.match(s.sent[1].session.delegation.responses.instructions, /playheadMs 1000/);
  s.delegation.close();
});

test("the tool call cap ends the session with an explicit error", async () => {
  const s = setup(false, 2);
  s.speak("Louder");
  s.delegate();
  s.call("get_passage", { atMs: 1000 }, "c1");
  await flush();
  s.call("get_passage", { atMs: 1000 }, "c2");
  await flush();
  s.call("get_passage", { atMs: 1000 }, "c3");
  await flush();
  assert.equal(s.events.at(-1)?.type, "error");
  assert.equal(s.sent.filter((e) => e.type === "response.item.create").length, 2);
});

test("the shadow classifier hears each utterance the backend sees and its first decision, and changes nothing", async () => {
  const s = setup();
  s.speak("Honey, what should we have for dinner?");
  s.delegate();
  assert.equal(s.shadowed.length, 0, "only once the backend has started on it");
  s.backend({ type: "response.created" });
  s.backend({ type: "response.created" });
  assert.equal(s.shadowed.length, 1, "once per utterance");
  assert.equal(s.shadowed[0].text, "Honey, what should we have for dinner?");
  s.call("ignore_input", {});
  await flush();
  assert.deepEqual(s.shadowed[0].decided, ["ignore"]);
  assert.equal(s.decisions().at(-1)?.result.action, "ignore", "the backend's decision stands");
  s.delegation.close();
});
