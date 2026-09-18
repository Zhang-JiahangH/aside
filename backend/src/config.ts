import type { MicrophoneConfig } from "@aside/engine/core";

/** Read only the explicit public allowlist. Never serialize process.env. */
export function readMicrophoneConfig(
  env: NodeJS.ProcessEnv = process.env,
): MicrophoneConfig {
  function number(
    name: string,
    fallback: number,
    min: number,
    max: number,
    integer = false,
  ) {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isInteger(value))
    ) {
      throw new Error(
        `${name} must be ${integer ? "an integer" : "a number"} between ${min} and ${max}`,
      );
    }
    return value;
  }
  const vad = env.ASIDE_MIC_VAD_ENABLED?.trim() || "true";
  if (!["true", "false"].includes(vad))
    throw Error("ASIDE_MIC_VAD_ENABLED must be true or false");
  return {
    vadEnabled: vad === "true",
    vadMinRms: number("ASIDE_MIC_VAD_MIN_RMS", 0.003, 0.0001, 0.1),
    vadThreshold: number("ASIDE_MIC_VAD_THRESHOLD", 0.8, 0.1, 0.99),
    threshold: number("ASIDE_MIC_THRESHOLD", 0.025, 0.001, 1),
    minSpeechMs: number("ASIDE_MIC_MIN_SPEECH_MS", 120, 40, 2000, true),
    silenceMs: number("ASIDE_MIC_SILENCE_MS", 650, 100, 5000, true),
  };
}

export function readVoiceLifecycleConfig(env: NodeJS.ProcessEnv = process.env) {
  const integer = (
    name: string,
    fallback: number,
    min: number,
    max: number,
  ) => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max)
      throw Error(`${name} must be an integer between ${min} and ${max}`);
    return n;
  };
  return {
    autoResumeMs: integer("ASIDE_AUTO_RESUME_MS", 2000, 0, 60000),
    preRollMs: integer("ASIDE_MIC_PRE_ROLL_MS", 750, 200, 3000),
    graceMs: integer("ASIDE_LIVE_GRACE_MS", 5000, 0, 60000),
    idleCloseMs: integer("ASIDE_LIVE_IDLE_CLOSE_MS", 60000, 10000, 300000),
  };
}
