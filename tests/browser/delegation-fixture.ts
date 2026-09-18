import { LiveDelegation } from "../../backend/src/live-delegation";
import type { Analysis } from "@aside/engine/core";
import type {
  LiveControlEvent,
  LiveControlUpdate,
  LivePlayerState,
} from "@aside/engine/contracts";
import type { PlayerCommand } from "@aside/engine/player";

/** What the substituted backend model decides for one delegated utterance. */
export interface BackendDecision {
  ignore?: boolean;
  wait?: boolean;
  resume?: boolean;
  commands?: PlayerCommand[];
  followUpQuestion?: string;
  answer?: string;
  /** Read the podcast first, as a real answer usually does. */
  lookup?: boolean;
}
export const defaultDecision = (text: string): BackendDecision => {
  const t = text.toLowerCase();
  if (t.includes("dinner") || t.includes("don't") || t.includes("honey"))
    return { ignore: true };
  if (t.includes("slower"))
    return { commands: [{ type: "adjust_rate", direction: "slower" }] };
  if (t.includes("resume")) return { commands: [{ type: "play" }] };
  if (t.includes("pause") || t.includes("wait"))
    return { commands: [{ type: "pause" }] };
  return { ignore: true };
};

/**
 * GPT-Live under Responses delegation, as the server sees it: transcript
 * fragments, a delegation per completed utterance, and the backend model's
 * function calls and text. Only the model is substituted; the production
 * coordinator executes the calls and talks to the browser.
 */
export class FakeDelegatedLive {
  readonly utterances: string[] = [];
  readonly toolReturns: { call_id: string; output: unknown }[] = [];
  private delegation: LiveDelegation;
  private continuations: (() => void)[] = [];
  private serial = 0;
  private transcript = "";
  private transcriptEnd = -Infinity;
  constructor(
    player: LivePlayerState,
    analysis: Analysis,
    emit: (event: LiveControlEvent) => void,
    private decide: (
      text: string,
      turn: number,
    ) => BackendDecision | Promise<BackendDecision>,
    debug = false,
  ) {
    this.delegation = new LiveDelegation(
      player,
      analysis,
      {
        emit,
        send: (event) => {
          if (event.type === "response.item.create") {
            const item = event.item as { call_id: string; output: string };
            this.toolReturns.push({
              call_id: item.call_id,
              output: JSON.parse(item.output),
            });
          }
          if (event.type === "response.create") {
            const continueResponse = this.continuations.shift();
            if (continueResponse) continueResponse();
            else void this.delegate(this.transcript, false);
          }
        },
        now: Date.now,
        after: (ms, run) => {
          const timer = setTimeout(run, ms);
          return () => clearTimeout(timer);
        },
      },
      debug,
    );
  }
  receive(event: Record<string, unknown>) {
    if (
      event.type === "session.input_transcript.delta" &&
      typeof event.delta === "string"
    ) {
      if (Number(event.start_ms) - this.transcriptEnd > 1200)
        this.transcript = "";
      this.transcript += event.delta;
      this.transcriptEnd = Number(event.end_ms);
    }
    this.delegation.receive(event);
  }
  update(player: LivePlayerState, ack?: LiveControlUpdate["acknowledgement"]) {
    this.delegation.update(player, ack);
  }
  close() {
    this.delegation.close();
  }
  /** The voice model judged the utterance complete and handed it to the backend. */
  async delegate(text: string, automatic = true) {
    const id = `delegation-${++this.serial}`;
    const turn = this.utterances.push(text);
    // GPT-Live delegates first; the backend model then takes its time.
    if (automatic)
      this.receive({
        type: "session.delegation.created",
        delegation: { id, type: "delegation", target: "responses" },
      });
    const backend = (event: Record<string, unknown>) =>
      this.receive({ type: "response.event", delegation_id: id, event });
    backend({ type: "response.created", response: {} });
    const decision = await this.decide(text, turn);
    const call = (name: string, args: unknown) =>
      new Promise<void>((resolve) => {
        this.continuations.push(() => {
          backend({ type: "response.created", response: {} });
          resolve();
        });
        backend({
          type: "response.output_item.done",
          item: {
            type: "function_call",
            call_id: `${id}-${name}`,
            name,
            arguments: JSON.stringify(args),
          },
        });
        backend({ type: "response.completed", response: {} });
      });
    if (decision.ignore) await call("ignore_input", {});
    if (decision.wait) await call("wait_for_input", {});
    if (decision.resume) await call("resume_podcast", {});
    if (decision.commands)
      await call("control_podcast", {
        commands: decision.commands,
        ...(decision.followUpQuestion
          ? { followUpQuestion: decision.followUpQuestion }
          : {}),
      });
    if (decision.lookup)
      await call("search_podcast", { query: text.slice(0, 20) });
    if (decision.answer !== undefined)
      backend({ type: "response.output_text.delta", delta: decision.answer });
    backend({
      type: "response.completed",
      response: {
        model: "gpt-5.6-luna",
        service_tier: "priority",
        usage: {
          input_tokens: 100,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 10,
          output_tokens_details: { reasoning_tokens: 0 },
        },
      },
    });
  }
}
