/** Appended to a failure so the listener knows playback continues. */
export const keepListeningHint = "。可以继续听节目，或重新尝试提问。";
/** Errors that already tell the listener they can carry on. */
const reassures = /可以继续听|仍可继续收听|keep listening/i;
/**
 * Adds the reassurance once. Some failures -- "AI trials are temporarily
 * paused. You can keep listening." -- already carry one, and appending the
 * sentence again reads as a stutter in both languages.
 */
export function withKeepListeningHint(text: string) {
  return reassures.test(text) ? text : `${text}${keepListeningHint}`;
}
