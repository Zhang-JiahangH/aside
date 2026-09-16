import { z } from "zod";
import { buildContext, getPassage, searchPodcast } from "@aside/engine/server";
import { explicitResume, type Analysis } from "@aside/engine/core";
import {
  playerCommandsSchema,
  type QuestionRequest,
  type QuestionResult,
  type QuestionPhase,
} from "@aside/engine/contracts";
import type { QuestionModel, ToolResult } from "./question-model.js";
import {
  questionInstructions,
  playerToolInstructions,
} from "./dialogue-policy.js";
import { questionTools } from "./question-tools.js";
export interface QuestionAnswerer {
  answer(
    analysis: Analysis,
    request: QuestionRequest,
    signal?: AbortSignal,
    progress?: (phase: QuestionPhase) => void,
  ): Promise<QuestionResult>;
}
/** Application policy: intent, heard-only retrieval, tool budget and sources. */
export class QuestionService implements QuestionAnswerer {
  constructor(
    private model: QuestionModel,
    private rounds = 5,
  ) {}
  async answer(
    analysis: Analysis,
    request: QuestionRequest,
    signal?: AbortSignal,
    progress?: (phase: QuestionPhase) => void,
  ): Promise<QuestionResult> {
    signal?.throwIfAborted();
    const resume = (): QuestionResult => ({
      revision: request.revision,
      answer: "",
      action: "resume",
      sources: [],
      tools: ["resume_podcast"],
    });
    const latest =
      request.history.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
    if (request.player?.source !== "voice" && explicitResume(latest))
      return { ...resume(), tools: [] };
    const sources: QuestionResult["sources"] = [],
      used: string[] = [];
    let previousId: string | undefined;
    let toolResults: ToolResult[] = [];
    for (let round = 0; round < this.rounds; round++) {
      signal?.throwIfAborted();
      progress?.(round === 0 ? "working" : "continuing");
      const response = await this.model.reply({
        context:
          round === 0
            ? {
                ...buildContext(analysis, request.atMs, request.history),
                ...(request.player ? { player: request.player } : {}),
              }
            : undefined,
        previousId,
        toolResults,
        instructions: questionInstructions + playerToolInstructions,
        tools: questionTools,
        signal,
      });
      signal?.throwIfAborted();
      previousId = response.id;
      toolResults = [];
      if (response.searchedWeb) used.push("search_web");
      sources.push(...response.sources);
      if (response.calls.length > 8) throw Error("Tool call limit reached");
      const terminal = response.calls.some((call) =>
        [
          "control_podcast",
          "resume_podcast",
          "ignore_input",
          "wait_for_input",
        ].includes(call.name),
      );
      if (terminal && response.calls.length > 1) {
        toolResults = response.calls.map((call) => ({
          callId: call.id,
          value: {
            error:
              "Return one decision only; combine playback operations in one control_podcast call",
          },
        }));
        continue;
      }
      for (const call of response.calls) {
        used.push(call.name);
        let result: unknown;
        try {
          const args: unknown = JSON.parse(call.arguments);
          if (call.name === "control_podcast") {
            const { commands, followUpQuestion } = z
              .object({
                commands: playerCommandsSchema,
                followUpQuestion: z.string().trim().min(1).max(2000).optional(),
              })
              .strict()
              .parse(args);
            // Terminal result: never spend a second model round narrating a control.
            return {
              revision: request.revision,
              action: "player_control",
              commandId: `${request.player?.turnId ?? request.revision}:${call.id}`,
              commands,
              ...(followUpQuestion ? { followUpQuestion } : {}),
              answer: "",
              sources: [],
              tools: [call.name],
            };
          }
          if (call.name === "ignore_input" || call.name === "wait_for_input") {
            z.object({}).strict().parse(args);
            return {
              revision: request.revision,
              action: call.name === "ignore_input" ? "ignore" : "wait",
              answer: "",
              sources: [],
              tools: [call.name],
            };
          }
          if (call.name === "resume_podcast") {
            z.object({}).strict().parse(args);
            return resume();
          }
          progress?.("searching");
          if (call.name === "get_passage") {
            const { atMs } = z
              .object({ atMs: z.number().finite().nonnegative() })
              .parse(args);
            result = getPassage(analysis, atMs, request.atMs);
          } else if (call.name === "search_podcast") {
            const { query } = z
              .object({ query: z.string().max(2000) })
              .parse(args);
            result = searchPodcast(analysis, query, request.atMs);
          } else result = { error: "Unknown tool" };
          if (Array.isArray(result))
            for (const passage of result)
              sources.push({ text: passage.text, startMs: passage.startMs });
        } catch {
          result = { error: "Invalid tool arguments" };
        }
        toolResults.push({ callId: call.id, value: result });
      }
      if (!response.calls.length)
        return {
          revision: request.revision,
          answer: response.answer,
          action: "answer",
          sources,
          tools: [...new Set(used)],
        };
    }
    throw Error("Tool round limit reached");
  }
}
