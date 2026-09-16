import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAIProvider } from "../backend/src/provider.js";
import type { QuestionModel } from "../backend/src/question-model.js";

test("OpenAI adapter maps question input, tool output, citations and cancellation", async (t) => {
  const provider = new OpenAIProvider("test-placeholder", "test-model");
  const abort = new AbortController();
  const inputs: unknown[] = [];
  const calls = t.mock.method(
    provider.client.responses,
    "create",
    async (body: unknown, options: { signal?: AbortSignal }) => {
      inputs.push(body);
      assert.equal(options.signal, abort.signal);
      return {
        id: "response-1",
        output_text: "回答",
        output: [
          { type: "web_search_call" },
          {
            type: "function_call",
            call_id: "call-1",
            name: "search_podcast",
            arguments: '{"query":"词语"}',
          },
          {
            type: "message",
            content: [
              {
                type: "output_text",
                annotations: [
                  {
                    type: "url_citation",
                    title: "Source",
                    url: "https://example.com/source",
                  },
                ],
              },
            ],
          },
        ],
      };
    },
  );
  const request: Parameters<QuestionModel["reply"]>[0] = {
    instructions: "政策",
    tools: [],
    toolResults: [],
    signal: abort.signal,
    context: {
      playheadMs: 10,
      currentPassage: null,
      recentTranscript: [],
      earlierExcerpts: [],
      hostStyle: "",
      history: [],
    },
  };
  const result = await provider.reply(request);
  assert.deepEqual(result, {
    id: "response-1",
    answer: "回答",
    searchedWeb: true,
    sources: [{ text: "Source", url: "https://example.com/source" }],
    calls: [
      { id: "call-1", name: "search_podcast", arguments: '{"query":"词语"}' },
    ],
  });
  assert.deepEqual(inputs[0], {
    model: "test-model",
    instructions: "政策",
    input: [{ role: "user", content: JSON.stringify(request.context) }],
    previous_response_id: undefined,
    tools: [],
    max_output_tokens: 1000,
    parallel_tool_calls: false,
  });
  await provider.reply({
    ...request,
    context: undefined,
    previousId: "response-1",
    toolResults: [{ callId: "call-1", value: { text: "已经听过" } }],
  });
  assert.deepEqual((inputs[1] as { input: unknown }).input, [
    {
      type: "function_call_output",
      call_id: "call-1",
      output: '{"text":"已经听过"}',
    },
  ]);
  assert.equal(calls.mock.callCount(), 2);
});

test("Live session setup keeps native audio and client delegation, with silent playback control policy", async (t) => {
  const { InteractiveProvider, LiveCreationRejected } =
    await import("../backend/src/interactive-provider.js");
  const provider = new InteractiveProvider("test-placeholder");
  const analysis = {
    version: "1",
    source: "demo" as const,
    passages: [],
    anchors: [],
    summary: "",
    hostStyle: "brief",
    speakers: [],
    voice: "feminine" as const,
    voiceReason: "test",
  };
  let status = 200;
  let body: any;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.openai.com/v1/live/sessions");
    body = JSON.parse(init.body as string);
    return Response.json(
      { session: { id: "live-test" }, transport: { sdp: "answer" } },
      { status },
    );
  });
  const result = await provider.createLive("offer", analysis, 1000, [
    { role: "user", text: "Earlier question" },
    { role: "assistant", text: "Earlier answer" },
  ]);
  assert.equal(result.session.id, "live-test");
  assert.equal(body.session.model, "gpt-live-1");
  assert.deepEqual(body.session.delegation, { type: "client" });
  assert.deepEqual(body.transport, { type: "webrtc", sdp: "offer" });
  assert.equal(body.session.audio.output.voice, "gleam");
  assert.match(body.session.instructions, /"wait wait"/);
  assert.match(body.session.instructions, /complete pause requests/);
  assert.match(
    body.session.instructions,
    /Ignore speech addressed to other people/,
  );
  assert.match(
    body.session.instructions,
    /as soon as the actionable intent is clear/,
  );
  assert.match(
    body.session.instructions,
    /Do not claim any playback operation succeeded/,
  );
  await provider.createLive("offer", { ...analysis, voice: "masculine" }, 0);
  assert.equal(body.session.audio.output.voice, "meridian");
  for (const code of [400, 408, 503]) {
    status = code;
    await assert.rejects(
      provider.createLive("offer", analysis, 0),
      code === 400 ? LiveCreationRejected : /Live session creation failed/,
    );
  }
});

test("the recorded-audio fallback forwards cancellation, and trial requests filter expensive tools", async (t) => {
  const { InteractiveProvider } =
    await import("../backend/src/interactive-provider.js");
  const provider = new InteractiveProvider(
    "test-placeholder",
    "test-model",
    true,
  );
  const signal = new AbortController().signal;
  t.mock.method(
    provider.client.audio.transcriptions,
    "create",
    async (body: any, options: any) => {
      assert.equal(body.model, "whisper-1");
      assert.equal(options.signal, signal);
      return { text: "pause" };
    },
  );
  assert.equal(
    await provider.transcribeQuestion(Buffer.from("wav"), signal),
    "pause",
  );
  t.mock.method(provider.client.responses, "create", async (body: any) => {
    assert.deepEqual(body.tools, []);
    assert.equal(body.parallel_tool_calls, false);
    return { id: "response", output_text: "", output: [] };
  });
  const context = {
    playheadMs: 0,
    currentPassage: null,
    recentTranscript: [],
    earlierExcerpts: [],
    hostStyle: "",
    history: [],
  };
  await provider.reply({
    context,
    instructions: "",
    toolResults: [],
    tools: [{ type: "web_search" }],
  });
  await assert.rejects(
    provider.reply({
      context: { ...context, hostStyle: "x".repeat(33000) },
      instructions: "",
      toolResults: [],
      tools: [],
    }),
    /Trial context too large/,
  );
});
