interface Ports {
  now(): number;
  after(ms: number, run: () => void): () => void;
  request(eventId: string): void;
  fail(message: string): void;
}
interface Input {
  id: string;
  revision: number;
  firstAt: number;
  lastAt: number;
}

/** Ask the configured backend to interpret speech if Live never hands it off.
 * This neither classifies intent nor authorizes a player action or audio output.
 */
export class LiveResponseTrigger {
  private latest?: Input;
  private active?: Pick<Input, "id" | "revision">;
  private handled?: Pick<Input, "id" | "revision">;
  private sealed?: string;
  private timer?: () => void;
  private pending?: { id: string; cancel(): void };
  private lastRequestAt = -Infinity;
  private closed = false;
  constructor(private ports: Ports) {}

  observe(id: string) {
    if (this.closed) return;
    const now = this.ports.now();
    this.latest = {
      id,
      revision: (this.latest?.id === id ? this.latest.revision : 0) + 1,
      firstAt: this.latest?.id === id ? this.latest.firstAt : now,
      lastAt: now,
    };
    this.arm();
  }
  started(id: string) {
    if (this.closed) return;
    this.timer?.();
    this.timer = undefined;
    this.pending?.cancel();
    this.pending = undefined;
    // Tool continuations cannot consume speech that arrived after this request.
    if (this.active?.id !== id)
      this.active = {
        id,
        revision: this.latest?.id === id ? this.latest.revision : 0,
      };
  }
  finished(id: string, waitForInput: boolean) {
    if (this.active?.id !== id) return;
    this.handled = this.active;
    this.active = undefined;
    if (!waitForInput) this.sealed = id;
    this.arm();
  }
  private arm() {
    this.timer?.();
    this.timer = undefined;
    const input = this.latest;
    if (
      this.closed ||
      this.active ||
      !input ||
      this.sealed === input.id ||
      (this.handled?.id === input.id && this.handled.revision >= input.revision)
    )
      return;
    // Briefly coalesce fragments, but never require the listener to finish.
    const due = Math.min(
      input.lastAt + 600,
      Math.max(input.firstAt, this.lastRequestAt) + 1200,
    );
    this.timer = this.ports.after(Math.max(0, due - this.ports.now()), () => {
      this.timer = undefined;
      this.active = { id: input.id, revision: input.revision };
      this.lastRequestAt = this.ports.now();
      const id = crypto.randomUUID();
      this.pending = {
        id,
        cancel: this.ports.after(10000, () => {
          this.pending = undefined;
          this.ports.fail(
            "Voice response did not start. Please reconnect the microphone and try again.",
          );
        }),
      };
      this.ports.request(id);
    });
  }
  reject(eventId: unknown) {
    if (!this.pending || this.pending.id !== eventId) return false;
    this.pending.cancel();
    this.pending = undefined;
    this.ports.fail(
      "Voice response could not start. Please reconnect the microphone and try again.",
    );
    return true;
  }
  reset() {
    this.timer?.();
    this.pending?.cancel();
    this.timer = this.pending = undefined;
    this.latest = this.active = this.handled = undefined;
    this.sealed = undefined;
    this.lastRequestAt = -Infinity;
  }
  close() {
    this.closed = true;
    this.reset();
  }
}
