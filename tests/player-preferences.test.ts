import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlayerConfig } from "@aside/engine/player";
import {
  loadPlayerConfig,
  savePlayerConfig,
} from "../frontend/src/player-preferences.js";

test("player preferences round-trip without depending on episode checkpoints", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  assert.deepEqual(loadPlayerConfig(storage), createPlayerConfig());
  const config = createPlayerConfig({
    playbackRate: 0.8,
    volume: 0.6,
    seekStepMs: 5000,
  });
  savePlayerConfig(config, storage);
  assert.deepEqual(loadPlayerConfig(storage), config);
});

test("unavailable, corrupt or incompatible preference storage falls back to defaults", () => {
  for (const text of [
    "{broken",
    "null",
    "[]",
    '{"playbackRate":9}',
    JSON.stringify({ ...createPlayerConfig(), muted: "yes" }),
  ]) {
    assert.deepEqual(
      loadPlayerConfig({ getItem: () => text }),
      createPlayerConfig(),
    );
  }
  assert.deepEqual(
    loadPlayerConfig({
      getItem: () => {
        throw Error("blocked");
      },
    }),
    createPlayerConfig(),
  );
  assert.doesNotThrow(() =>
    savePlayerConfig(createPlayerConfig(), {
      setItem: () => {
        throw Error("quota");
      },
    }),
  );
});
