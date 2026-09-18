/**
 * Shadow evaluation of Jev (TypeSafe's structured decision model, reached
 * through OpenRouter) as a fast admission classifier for heard utterances.
 *
 * It runs beside the backend model and changes nothing: each utterance yields
 * one record comparing Jev's choice with the backend's first decision. The
 * endpoint is alpha with a single provider, so every failure is an outcome to
 * count, never an error to surface. No utterance text leaves this module except
 * in the request to the model.
 */
export type ShadowAction =
  | "ignore"
  | "wait"
  | "pause"
  | "resume"
  | "control"
  | "question";

export interface ShadowRecord {
  /** The backend model's first decision; undefined if it never made one. */
  backend?: ShadowAction;
  backendMs?: number;
  jev?: ShadowAction;
  confidence?: number;
  /** ok, timeout, or the failure: http_529, invalid, network. */
  status: string;
  jevMs: number;
  characters: number;
  /** Han characters present: the listener spoke Chinese. */
  han: boolean;
  wasPlaying: boolean;
}

export interface ShadowUtterance {
  text: string;
  wasPlaying: boolean;
  /** The podcast is paused for a conversation. */
  interrupted: boolean;
}

export interface ShadowHandle {
  /** The backend model's first decision for this utterance. */
  decided(action: ShadowAction): void;
  /** The utterance was superseded or the session ended. */
  close(): void;
}

export type JevShadow = (utterance: ShadowUtterance) => ShadowHandle;

/** Pinned: `jev-latest` would change the decisions being measured. */
export const jevModel = "typesafe/jev-1.13";
const endpoint = "https://openrouter.ai/api/alpha/decisions";
/**
 * Give up here. A live admission path could afford about 300 ms; slower
 * answers are kept with their real latency so the analysis can draw that line.
 */
export const jevTimeoutMs = 3000;
/** A record without a backend decision is still written after this long. */
const backendWaitMs = 15000;

const question = {
  type: "choice",
  instructions: {
    question:
      "A podcast player app with a voice assistant hears speech through an open microphone. What should the app do with this utterance?",
    focus:
      "Decide from the utterance and the player state. People nearby also talk to each other; the app must not react to speech that is not meant for it. The utterance may be in Chinese or English.",
  },
  criteria: {
    ignore: {
      what: "Not addressed to the app: talk between people in the room, a phone call, self-talk, filler sounds like 'hmm', 'uh huh', '嗯', '哦'.",
      examples: ["Honey, what should we have for dinner?", "你作业写完了没有", "Hmm"],
    },
    wait: {
      what: "Addressed to the app but the sentence is clearly cut off mid-thought; more words are needed to know what is asked.",
      examples: ["Can you explain the", "我想问一下就是"],
    },
    pause: {
      what: "Asks only to pause or stop playback, with no question attached.",
      examples: ["Wait", "Hold on", "等一下", "暂停"],
    },
    resume: {
      what: "Asks to continue or return to the podcast playback.",
      not_for: "Asking the assistant to continue its explanation.",
      examples: ["OK, go on", "Back to the podcast", "继续", "接着放吧"],
    },
    control: {
      what: "Asks for another playback change: speed, seeking backward or forward, volume.",
      examples: ["Slow it down", "Go back thirty seconds", "声音大一点"],
    },
    question: {
      what: "Asks the assistant something or wants an explanation or more detail, including follow-ups. A leading 'wait' or '等一下' before a question is still a question.",
      examples: ["What did he mean by that?", "然后呢", "Continue explaining that point"],
    },
  },
} as const;
const actions = new Set<string>(Object.keys(question.criteria));

/** The backend's first function call (or plain text) in Jev's decision space. */
export function backendAction(
  name: string | undefined,
  args = "{}",
): ShadowAction {
  if (name === "ignore_input") return "ignore";
  if (name === "wait_for_input") return "wait";
  if (name === "resume_podcast") return "resume";
  if (name === "control_podcast") {
    let parsed: { commands?: { type?: string }[]; followUpQuestion?: string } =
      {};
    try {
      parsed = JSON.parse(args);
    } catch {}
    if (parsed.followUpQuestion?.trim()) return "question";
    const types = (parsed.commands ?? []).map((command) => command.type);
    if (types.length && types.every((type) => type === "pause")) return "pause";
    if (types.length && types.every((type) => type === "play")) return "resume";
    return "control";
  }
  // Lookups and plain text are both the backend answering.
  return "question";
}

export function createJevShadow(
  apiKey: string,
  record: (entry: ShadowRecord) => void,
  ports: {
    fetch: typeof fetch;
    now(): number;
    after(ms: number, run: () => void): () => void;
  },
): JevShadow {
  return (utterance) => {
    const started = ports.now();
    const entry: ShadowRecord = {
      status: "pending",
      jevMs: 0,
      characters: utterance.text.length,
      han: /[㐀-鿿]/.test(utterance.text),
      wasPlaying: utterance.wasPlaying,
    };
    let jevDone = false,
      backendDone = false,
      written = false;
    const write = () => {
      if (written || !jevDone) return;
      written = true;
      cancelWait();
      record(entry);
    };
    // A backend that never decides still leaves Jev's latency and outcome.
    const cancelWait = ports.after(backendWaitMs, () => {
      backendDone = true;
      write();
    });
    const abort = new AbortController();
    const cancelBudget = ports.after(jevTimeoutMs, () => {
      if (jevDone) return;
      entry.status = "timeout";
      entry.jevMs = ports.now() - started;
      jevDone = true;
      abort.abort();
      if (backendDone) write();
    });
    void ports
      .fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: jevModel,
          state: JSON.stringify({
            player: utterance.interrupted
              ? {
                  podcast: "paused for a conversation",
                  assistant: "in a conversation with the listener",
                }
              : {
                  podcast: utterance.wasPlaying ? "playing" : "paused",
                  conversation: "none",
                },
            utterance: utterance.text,
          }),
          questions: { action: question },
        }),
        signal: abort.signal,
      })
      .then(async (response) => {
        if (jevDone) return;
        entry.jevMs = ports.now() - started;
        if (!response.ok) {
          entry.status = `http_${response.status}`;
          return;
        }
        const body = (await response.json()) as {
          answers?: { action?: { choice?: string; confidence?: number } };
        };
        const answer = body.answers?.action;
        if (!answer?.choice || !actions.has(answer.choice)) {
          entry.status = "invalid";
          return;
        }
        entry.status = "ok";
        entry.jev = answer.choice as ShadowAction;
        entry.confidence = answer.confidence;
      })
      .catch(() => {
        if (jevDone) return;
        entry.status = "network";
        entry.jevMs = ports.now() - started;
      })
      .finally(() => {
        if (jevDone) return;
        jevDone = true;
        cancelBudget();
        if (backendDone) write();
      });
    return {
      decided(action) {
        if (backendDone) return;
        backendDone = true;
        entry.backend = action;
        entry.backendMs = ports.now() - started;
        write();
      },
      close() {
        if (backendDone) return;
        backendDone = true;
        write();
      },
    };
  };
}
