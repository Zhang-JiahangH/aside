import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveResponseTrigger } from "../backend/src/live-response-trigger.js";

function setup() {
  let now = 0;
  let serial = 0;
  const timers = new Map<number, { at: number; run(): void }>();
  const requests: string[] = [];
  const errors: string[] = [];
  const trigger = new LiveResponseTrigger({
    now: () => now,
    after: (ms, run) => {
      const id = ++serial;
      timers.set(id, { at: now + ms, run });
      return () => {
        timers.delete(id);
      };
    },
    request: (id) => {
      requests.push(id);
    },
    fail: (error) => {
      errors.push(error);
      trigger.close();
    },
  });
  const advance = (ms: number) => {
    const end = now + ms;
    while (true) {
      const next = [...timers]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, t] = next;
      now = t.at;
      timers.delete(id);
      t.run();
    }
    now = end;
  };
  return { trigger, requests, errors, advance };
}

test("recognized speech requests the backend when Live never delegates, without waiting for a final transcript", () => {
  const s = setup();
  s.trigger.observe("a");
  s.advance(599);
  assert.equal(s.requests.length, 0);
  s.advance(1);
  assert.equal(s.requests.length, 1);
  s.advance(5000);
  assert.equal(
    s.requests.length,
    1,
    "no repeated requests while awaiting the backend",
  );
  s.trigger.started("a");
  s.trigger.finished("a", false);
  s.trigger.observe("a");
  s.advance(20000);
  assert.equal(
    s.requests.length,
    1,
    "trailing fragments cannot repeat an answered request",
  );
  assert.deepEqual(s.errors, []);
});

test("continuous partial transcripts cannot postpone the fallback forever", () => {
  const s = setup();
  s.trigger.observe("a");
  for (let i = 0; i < 5; i++) {
    s.advance(200);
    s.trigger.observe("a");
  }
  assert.equal(s.requests.length, 0);
  s.advance(200);
  assert.equal(s.requests.length, 1);
  s.trigger.close();
});

test("a natural delegation cancels the fallback and its continuations never start a second request", () => {
  const s = setup();
  s.trigger.observe("a");
  s.advance(300);
  s.trigger.started("a");
  s.trigger.observe("a");
  s.trigger.started("a");
  s.advance(10000);
  assert.equal(s.requests.length, 0);
  s.trigger.finished("a", false);
  s.advance(1000);
  assert.equal(s.requests.length, 0);
});

test("a question queued during backend work waits for that work, and stale completions cannot clear it", () => {
  const s = setup();
  s.trigger.observe("a");
  s.trigger.started("a");
  s.trigger.observe("b");
  s.advance(2000);
  assert.equal(s.requests.length, 0);
  s.trigger.finished("a", false);
  s.advance(0);
  assert.equal(s.requests.length, 1);
  s.trigger.started("b");
  s.trigger.finished("a", false);
  s.trigger.finished("b", false);
  s.advance(10000);
  assert.deepEqual(s.errors, []);
});

test("wait_for_input rechecks only when new speech arrives, including words received during the request", () => {
  const s = setup();
  s.trigger.observe("a");
  s.advance(600);
  s.trigger.started("a");
  s.trigger.observe("a");
  s.trigger.finished("a", true);
  s.advance(600);
  assert.equal(s.requests.length, 2);
  s.trigger.started("a");
  s.trigger.finished("a", true);
  s.advance(5000);
  assert.equal(
    s.requests.length,
    2,
    "an incomplete utterance is not polled repeatedly",
  );
  s.trigger.observe("a");
  s.advance(600);
  assert.equal(s.requests.length, 3);
  s.trigger.close();
});

test("missing acknowledgements and rejected requests report failure instead of silent waiting", () => {
  const s = setup();
  s.trigger.observe("a");
  s.advance(10600);
  assert.equal(s.errors.length, 1);
  assert.match(s.errors[0], /did not start/);
  s.advance(20000);
  assert.equal(s.requests.length, 1);
  const rejected = setup();
  rejected.trigger.observe("a");
  rejected.advance(600);
  assert.equal(rejected.trigger.reject("unrelated"), false);
  assert.equal(rejected.trigger.reject(rejected.requests[0]), true);
  assert.match(rejected.errors[0], /could not start/);
  const raced = setup();
  raced.trigger.observe("a");
  raced.advance(600);
  raced.trigger.started("a");
  assert.equal(
    raced.trigger.reject(raced.requests[0]),
    false,
    "a natural delegation won the race",
  );
  raced.trigger.finished("a", false);
  raced.advance(20000);
  assert.deepEqual(raced.errors, []);
});

test("manual cancellation and closure clear pending work; reset permits a later utterance", () => {
  const s = setup();
  s.trigger.observe("a");
  s.trigger.reset();
  s.advance(12000);
  assert.equal(s.requests.length, 0);
  s.trigger.observe("b");
  s.advance(600);
  s.trigger.close();
  s.trigger.observe("c");
  s.trigger.started("c");
  s.advance(12000);
  assert.equal(s.requests.length, 1);
  assert.deepEqual(s.errors, []);
});

test("delegation before the first transcript suppresses a redundant fallback", () => {
  const s = setup();
  s.trigger.started("a");
  s.trigger.observe("a");
  s.advance(2000);
  assert.equal(s.requests.length, 0);
  s.trigger.finished("a", false);
  s.trigger.close();
});
