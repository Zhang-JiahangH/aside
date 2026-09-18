/**
 * Live has no semantic audio-done event. Mobile may resume only after the
 * backend's complete answer was heard AND the native playout queue drained.
 * Paraphrased/missing captions intentionally require explicit Continue.
 * Punctuation/spacing/case changes are harmless; missing words or numbers aren't.
 */
export class SpokenCompletion {
  private expected = "";
  private heard = "";
  private started = false;
  private drained = false;
  private normalize(value: string) {
    return (
      value
        .normalize("NFKC")
        .toLocaleLowerCase("en-US")
        .match(
          /\p{N}+(?:[.,]\p{N}+)*|\p{Script=Han}|(?:(?!\p{Script=Han})[\p{L}\p{M}])+/gu,
        )
        ?.join(" ") ?? ""
    );
  }
  answer(value: string) {
    this.expected = this.normalize(value);
  }
  transcript(value: string) {
    this.heard = this.normalize(value);
  }
  outputStarted() {
    this.started = true;
    this.drained = false;
  }
  outputDrained() {
    if (this.started) this.drained = true;
  }
  get complete() {
    return (
      this.started &&
      this.drained &&
      !!this.expected &&
      (this.expected.length < 20
        ? this.heard === this.expected
        : this.heard.endsWith(this.expected))
    );
  }
}
