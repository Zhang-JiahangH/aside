import { test } from "node:test";
import assert from "node:assert/strict";
import { readMicrophoneConfig } from "../backend/src/config.js";
test("microphone configuration uses defaults and only exposes allowlisted numbers", () => {
  assert.deepEqual(readMicrophoneConfig({ OPENAI_API_KEY: "test-secret" }), {
    vadEnabled: true,
    vadThreshold: 0.8,
    vadMinRms: 0.003,
    threshold: 0.025,
    minSpeechMs: 120,
    silenceMs: 650,
  });
  assert.deepEqual(
    readMicrophoneConfig({
      ASIDE_MIC_THRESHOLD: ".04",
      ASIDE_MIC_MIN_SPEECH_MS: "200",
      ASIDE_MIC_SILENCE_MS: "900",
    }),
    {
      threshold: 0.04,
      minSpeechMs: 200,
      silenceMs: 900,
      vadEnabled: true,
      vadThreshold: 0.8,
      vadMinRms: 0.003,
    },
  );
});
test("invalid microphone settings fail early instead of disabling detection silently", () => {
  for (const value of ["nope", "0", "-1", "Infinity", "1.1"])
    assert.throws(
      () => readMicrophoneConfig({ ASIDE_MIC_THRESHOLD: value }),
      /ASIDE_MIC_THRESHOLD/,
    );
  assert.throws(
    () => readMicrophoneConfig({ ASIDE_MIC_MIN_SPEECH_MS: "1.5" }),
    /ASIDE_MIC_MIN_SPEECH_MS/,
  );
  assert.throws(
    () => readMicrophoneConfig({ ASIDE_MIC_SILENCE_MS: "9999" }),
    /ASIDE_MIC_SILENCE_MS/,
  );
  assert.equal(
    readMicrophoneConfig({ ASIDE_MIC_THRESHOLD: " " }).threshold,
    0.025,
  );
});

test("voice lifecycle budgets have bounded configurable defaults", async () => {
  const { readVoiceLifecycleConfig } = await import("../backend/src/config.js");
  assert.deepEqual(readVoiceLifecycleConfig({}), {
    preRollMs: 750,
    graceMs: 5000,
    idleCloseMs: 60000,
    autoResumeMs: 2000,
  });
  assert.equal(
    readVoiceLifecycleConfig({ ASIDE_LIVE_GRACE_MS: "0" }).graceMs,
    0,
  );
  for (const env of [
    { ASIDE_LIVE_GRACE_MS: "-1" },
    { ASIDE_MIC_PRE_ROLL_MS: "Infinity" },
    { ASIDE_LIVE_IDLE_CLOSE_MS: "999999" },
  ])
    assert.throws(() => readVoiceLifecycleConfig(env));
});

test("VAD configuration validates confidence and requires explicit opt-out", () => {
  assert.equal(
    readMicrophoneConfig({ ASIDE_MIC_VAD_ENABLED: "false" }).vadEnabled,
    false,
  );
  assert.equal(
    readMicrophoneConfig({ ASIDE_MIC_VAD_THRESHOLD: "0.9" }).vadThreshold,
    0.9,
  );
  assert.throws(() => readMicrophoneConfig({ ASIDE_MIC_VAD_ENABLED: "maybe" }));
  for (const value of ["NaN", "0", "1.5"])
    assert.throws(() =>
      readMicrophoneConfig({ ASIDE_MIC_VAD_THRESHOLD: value }),
    );
});
