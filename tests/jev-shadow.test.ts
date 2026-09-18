import { test } from "node:test";
import assert from "node:assert/strict";
import {
  backendAction,
  createJevShadow,
  jevTimeoutMs,
  type ShadowRecord,
} from "../backend/src/jev-shadow.js";

function setup(respond: (body: any) => Promise<Response> | Response) {
  let now = 0;
  const timers: { at: number; run: () => void; off: boolean }[] = [];
  const records: ShadowRecord[] = [];
  const requests: any[] = [];
  const shadow = createJevShadow("key", (entry) => records.push(entry), {
    fetch: (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      requests.push({ body, headers: init?.headers });
      return respond(body);
    }) as typeof fetch,
    now: () => now,
    after: (ms, run) => {
      const timer = { at: now + ms, run, off: false };
      timers.push(timer);
      return () => (timer.off = true);
    },
  });
  const advance = (ms: number) => {
    now += ms;
    for (const timer of timers)
      if (!timer.off && timer.at <= now) {
        timer.off = true;
        timer.run();
      }
  };
  return { shadow, records, requests, advance };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const answer = (choice: string, confidence = 0.9) =>
  Response.json({ answers: { action: { type: "choice", choice, confidence } } });

test("the backend's first call maps into the shared decision space", () => {
  assert.equal(backendAction("ignore_input"), "ignore");
  assert.equal(backendAction("wait_for_input"), "wait");
  assert.equal(backendAction("resume_podcast"), "resume");
  assert.equal(backendAction("search_podcast", '{"query":"x"}'), "question");
  assert.equal(backendAction(undefined), "question");
  const control = (value: unknown) =>
    backendAction("control_podcast", JSON.stringify(value));
  assert.equal(control({ commands: [{ type: "pause" }] }), "pause");
  assert.equal(control({ commands: [{ type: "play" }] }), "resume");
  assert.equal(control({ commands: [{ type: "adjust_rate" }] }), "control");
  assert.equal(
    control({ commands: [{ type: "pause" }], followUpQuestion: "Why?" }),
    "question",
    "a pause that carries a question is a question",
  );
  assert.equal(backendAction("control_podcast", "not json"), "control");
});

test("one record pairs Jev's choice with the backend's first decision, without the utterance", async () => {
  const s = setup(() => answer("pause", 0.93));
  const handle = s.shadow({ text: "等一下", wasPlaying: true, interrupted: false });
  s.advance(140);
  await flush();
  assert.equal(s.records.length, 0, "waits for the backend");
  s.advance(1000);
  handle.decided("pause");
  handle.decided("question");
  assert.equal(s.records.length, 1, "only the first decision counts");
  assert.deepEqual(s.records[0], {
    status: "ok",
    jev: "pause",
    confidence: 0.93,
    jevMs: 140,
    backend: "pause",
    backendMs: 1140,
    characters: 3,
    han: true,
    wasPlaying: true,
  });
  assert.equal(JSON.stringify(s.records[0]).includes("等一下"), false);
  assert.equal(s.requests[0].body.model, "typesafe/jev-1.13");
  assert.match(s.requests[0].body.state, /等一下/);
  assert.match(s.requests[0].body.state, /"podcast":"playing"/);
});

test("failures are outcomes: an overloaded, invalid or silent Jev still yields a record", async () => {
  const overloaded = setup(() => new Response("busy", { status: 529 }));
  overloaded.shadow({ text: "Pause", wasPlaying: true, interrupted: false }).decided("pause");
  await flush();
  assert.equal(overloaded.records[0].status, "http_529");
  assert.equal(overloaded.records[0].jev, undefined);

  const invalid = setup(() => answer("dance"));
  invalid.shadow({ text: "Pause", wasPlaying: true, interrupted: false }).decided("pause");
  await flush();
  assert.equal(invalid.records[0].status, "invalid");

  const silent = setup(() => new Promise<Response>(() => {}));
  silent.shadow({ text: "Pause", wasPlaying: false, interrupted: true }).decided("pause");
  silent.advance(jevTimeoutMs);
  assert.equal(silent.records[0].status, "timeout");
  assert.equal(silent.records[0].jevMs, jevTimeoutMs);
  assert.match(silent.requests[0].body.state, /paused for a conversation/);
});

test("a superseded utterance or a backend that never decides still records Jev's side", async () => {
  const s = setup(() => answer("ignore", 0.8));
  s.shadow({ text: "Hmm", wasPlaying: true, interrupted: false }).close();
  await flush();
  assert.equal(s.records.length, 1);
  assert.equal(s.records[0].backend, undefined);
  assert.equal(s.records[0].jev, "ignore");

  const never = setup(() => answer("ignore"));
  never.shadow({ text: "Hmm", wasPlaying: true, interrupted: false });
  await flush();
  never.advance(15000);
  assert.equal(never.records.length, 1);
  assert.equal(never.records[0].backend, undefined);
});
