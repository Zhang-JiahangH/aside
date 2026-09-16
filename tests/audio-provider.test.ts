import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { Passage } from "@aside/engine/core";
import { AudioProvider } from "../backend/src/audio-provider.js";

const segments = [
  { text: " 穩定性的問題 ", start: 1.2, end: 2.8 },
  { text: "後來我們換了做法。", start: 2.8, end: 5.4 },
];
const words = [
  { word: "穩定", start: 1.2, end: 1.9 },
  { word: "性的", start: 1.9, end: 2.4 },
  { word: "問題", start: 2.4, end: 2.8 },
];

async function transcriptionFor(
  t: TestContext,
  prompt?: string,
): Promise<{ body: Record<string, unknown>; passages: Passage[] }> {
  const provider = new AudioProvider("test-placeholder");
  const bodies: Record<string, unknown>[] = [];
  t.mock.method(
    provider.client.audio.transcriptions,
    "create",
    async (body: Record<string, unknown>) => {
      bodies.push(body);
      // A provider may return word timing whether or not it was requested.
      return { segments, words };
    },
  );
  const passages = await provider.transcribeAudio(
    new Uint8Array([0]),
    60000,
    prompt,
  );
  return { body: bodies[0], passages };
}

async function bodyFor(
  t: TestContext,
  prompt?: string,
): Promise<Record<string, unknown>> {
  return (await transcriptionFor(t, prompt)).body;
}

/** Returns the transcript outline the enrichment prompt actually carries. */
async function outlineFor(
  t: TestContext,
  passages: Passage[],
): Promise<unknown> {
  const provider = new AudioProvider("test-placeholder");
  const prompts: string[] = [];
  t.mock.method(
    provider.client.chat.completions,
    "create",
    async (body: {
      messages: { content: { type: string; text?: string }[] }[];
    }) => {
      const text = body.messages[0].content.find(
        (part) => part.type === "text",
      )?.text;
      prompts.push(text ?? "");
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "s",
                hostStyle: "h",
                speakers: [],
                groups: [],
              }),
            },
            finish_reason: "stop",
          },
        ],
      };
    },
  );
  await provider.enrichAudio(new Uint8Array([0]), passages, async () => {});
  const marker = "Transcript: ";
  const prompt = prompts[0];
  return JSON.parse(prompt.slice(prompt.indexOf(marker) + marker.length));
}

test("the steering prompt is optional, trimmed and bounded", async (t) => {
  assert.equal("prompt" in (await bodyFor(t)), false);
  assert.equal("prompt" in (await bodyFor(t, "   ")), false);
  assert.equal(
    (await bodyFor(t, "  这是一段带标点的中文朗读。  "))["prompt"],
    "这是一段带标点的中文朗读。",
  );
  assert.equal(
    (await bodyFor(t, "甲".repeat(400)))["prompt"],
    "甲".repeat(120),
  );
});

test("transcription asks for segment granularity and keeps no word timing", async (t) => {
  const { body, passages } = await transcriptionFor(t);
  assert.deepEqual(body["timestamp_granularities"], ["segment"]);
  assert.deepEqual(passages, [
    {
      id: "p-60000-0",
      startMs: 61200,
      endMs: 62800,
      text: "穩定性的問題",
      speaker: "unknown",
    },
    {
      id: "p-60000-1",
      startMs: 62800,
      endMs: 65400,
      text: "後來我們換了做法。",
      speaker: "unknown",
    },
  ]);
});

test("the enrichment prompt carries an outline, not whole passages", async (t) => {
  // A cached transcript from an older analysis still has per-word timing.
  const cached = [
    {
      id: "p-0-0",
      startMs: 1200,
      endMs: 2800,
      text: "穩定性的問題",
      speaker: "unknown",
      words: [{ text: "穩定", startMs: 1200, endMs: 1900 }],
    },
  ] as unknown as Passage[];
  const outline = await outlineFor(t, cached);
  assert.deepEqual(outline, [
    { id: "p-0-0", startMs: 1200, endMs: 2800, text: "穩定性的問題" },
  ]);
  assert.equal(JSON.stringify(outline).includes("words"), false);
  assert.equal(JSON.stringify(outline).includes("speaker"), false);
});
