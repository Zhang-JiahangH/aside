import OpenAI, { toFile } from "openai";
import { z } from "zod";
import { liveStartupHistory } from "@aside/engine/server";
import type { Analysis, Turn } from "@aside/engine/core";
import type { QuestionModel, ModelReply } from "./question-model.js";
import {
  hostPerspective,
  playerInteractionInstructions,
} from "./dialogue-policy.js";

export class LiveCreationRejected extends Error {}

/** Network-only adapter, shared by Workers and the local Node server. */
export class InteractiveProvider implements QuestionModel {
  readonly client: OpenAI;
  constructor(
    key: string,
    readonly model = "gpt-5.6-terra",
    readonly trial = false,
  ) {
    this.client = new OpenAI({ apiKey: key, maxRetries: 0, timeout: 90000 });
  }
  async reply(
    request: Parameters<QuestionModel["reply"]>[0],
  ): Promise<ModelReply> {
    const input: OpenAI.Responses.ResponseInput = request.context
      ? [{ role: "user", content: JSON.stringify(request.context) }]
      : request.toolResults.map((result) => ({
          type: "function_call_output",
          call_id: result.callId,
          output: JSON.stringify(result.value),
        }));
    if (
      this.trial &&
      new TextEncoder().encode(JSON.stringify(input)).length > 32000
    )
      throw Error("Trial context too large");
    const response = await this.client.responses.create(
      {
        model: this.model,
        instructions: request.instructions,
        input,
        previous_response_id: request.previousId,
        tools: this.trial
          ? request.tools.filter((tool) => tool.type !== "web_search")
          : request.tools,
        max_output_tokens: this.trial ? 600 : 1000,
        parallel_tool_calls: false,
      },
      { signal: request.signal },
    );
    const sources: ModelReply["sources"] = [];
    const calls: ModelReply["calls"] = [];
    let searchedWeb = false;
    for (const item of response.output) {
      if (item.type === "web_search_call") searchedWeb = true;
      if (item.type === "function_call")
        calls.push({
          id: item.call_id,
          name: item.name,
          arguments: item.arguments,
        });
      if (item.type === "message")
        for (const content of item.content)
          if (content.type === "output_text")
            for (const annotation of content.annotations)
              if (annotation.type === "url_citation")
                sources.push({ text: annotation.title, url: annotation.url });
    }
    return {
      id: response.id,
      answer: response.output_text,
      sources,
      calls,
      searchedWeb,
    };
  }
  async transcribeQuestion(audio: Buffer, signal?: AbortSignal) {
    const result = await this.client.audio.transcriptions.create(
      {
        model: "whisper-1",
        file: await toFile(audio, "question.wav", { type: "audio/wav" }),
        response_format: "json",
      },
      { signal },
    );
    return result.text;
  }
  async createLive(
    sdp: string,
    a: Analysis,
    atMs: number,
    history: Turn[] = [],
  ) {
    const response = await fetch("https://api.openai.com/v1/live/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.client.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          model: "gpt-live-1",
          input: liveStartupHistory(history).map((t) => ({
            type: "message",
            role: t.role,
            content: [
              {
                type: t.role === "assistant" ? "output_text" : "input_text",
                text: t.text,
              },
            ],
          })),
          delegation: { type: "client" },
          audio: {
            output: { voice: a.voice === "feminine" ? "gleam" : "meridian" },
          },
          instructions:
            hostPerspective +
            playerInteractionInstructions +
            "Wait silently at startup. Do not greet or answer old history. Listen during podcast playback, but do not speak over it. Ignore speech addressed to other people. Delegate addressed playback requests and substantive questions as soon as the actionable intent is clear, even while the user continues speaking. Remain silent while the app classifies or executes the request; the app controls whether playback pauses. If the app says a local recording is being handled, wait for its backend result instead of duplicating it. Determine spoken reply language ONLY from the latest actual user utterance or their explicit language request. English questions MUST receive spoken English answers; Chinese questions receive Chinese answers. Host style, metadata, control messages, summaries and previous assistant replies do not determine reply language. Preserve the language and concise length of backend answers instead of translating or expanding them. For simple questions use 2-3 short spoken sentences; expand only when asked or needed. No markdown, lists, greetings, repeated questions or automatic follow-up invitations. Let the app manage playback and follow-up waiting. Delegate factual questions and all playback requests (including rate, volume, mute, pause, seek and repeat) to the backend. Remain available for follow-ups. Never interpret silence as permission to resume. If a lookup takes time give at most one brief concrete progress update. Host style: " +
            a.hostStyle +
            " Initial playhead ms: " +
            atMs,
        },
        transport: { type: "webrtc", sdp },
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408
      )
        throw new LiveCreationRejected(
          `Live session rejected (${response.status})`,
        );
      throw Error(`Live session creation failed (${response.status})`);
    }
    return z
      .object({
        session: z.object({ id: z.string() }),
        transport: z.object({ sdp: z.string() }),
      })
      .parse(await response.json());
  }
}
