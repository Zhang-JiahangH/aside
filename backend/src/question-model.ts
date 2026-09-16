import type { buildContext } from "@aside/engine/server";
import type { Source, PlayerInput } from "@aside/engine/contracts";
export type QuestionTool =
  | { type: "web_search" }
  | {
      type: "function";
      name: string;
      description: string;
      parameters: Record<string, unknown>;
      strict: boolean;
    };
export interface ToolResult {
  callId: string;
  value: unknown;
}
export interface ModelReply {
  id: string;
  answer: string;
  sources: Source[];
  searchedWeb: boolean;
  calls: { id: string; name: string; arguments: string }[];
}
/** Only the data needed by this app's question loop, with no SDK types. */
export interface QuestionModel {
  reply(request: {
    context?: ReturnType<typeof buildContext> & { player?: PlayerInput };
    previousId?: string;
    toolResults: ToolResult[];
    instructions: string;
    tools: QuestionTool[];
    signal?: AbortSignal;
  }): Promise<ModelReply>;
}
