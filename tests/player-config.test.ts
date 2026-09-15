import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createPlayerConfig,
  clampPlayerPosition,
  resolvePlayerCommand,
  type PlayerCommand,
} from "@aside/engine/player";

const config = createPlayerConfig();
const context = { config, positionMs: 25000, durationMs: 60000, anchors: [] };
const resolve = (command: PlayerCommand) =>
  resolvePlayerCommand(command, context);

describe("Given a player-level configuration", () => {
  it("supplies immutable defaults and accepts independent overrides", () => {
    assert.equal(config.playbackRate, 1);
    assert.equal(config.seekStepMs, 10000);
    assert.equal(config.preservesPitch, true);
    assert.equal(Object.isFrozen(config), true);
    const custom = createPlayerConfig({ playbackRate: 0.8, seekStepMs: 5000 });
    assert.equal(custom.playbackRate, 0.8);
    assert.equal(custom.seekStepMs, 5000);
    assert.equal(custom.volume, 1);
    assert.equal(config.playbackRate, 1);
  });

  it("rejects non-finite values, unknown settings and inconsistent rate limits", () => {
    for (const patch of [
      { playbackRate: NaN },
      { volume: Infinity },
      { volume: -0.1 },
      { muted: "false" },
      { seekStepMs: 0 },
      { repeatFallbackMs: -1 },
      { rateStep: 0 },
      { minRate: 2, maxRate: 1 },
      { playbackRate: 3 },
      { minRate: 0.1 },
      { maxRate: 10 },
      { persona: "host" },
      { playbackRate: undefined },
    ])
      assert.throws(
        () => createPlayerConfig(patch as never),
        JSON.stringify(patch),
      );
  });
});

describe("Given a remote command", () => {
  it("rejects invalid playback context and bounds even extreme finite skip amounts", () => {
    for (const [position, duration] of [
      [NaN, 60000],
      [0, Infinity],
      [0, -1],
    ])
      assert.throws(() => clampPlayerPosition(position, duration));
    assert.deepEqual(
      resolvePlayerCommand(
        { type: "skip", direction: "forward", amountMs: Number.MAX_VALUE },
        {
          ...context,
          positionMs: Number.MAX_VALUE,
          durationMs: Number.MAX_VALUE,
        },
      ),
      { type: "seek", atMs: Number.MAX_VALUE, playback: "preserve" },
    );
  });
  it("changes speed relative to the current value and clamps to configured limits", () => {
    assert.deepEqual(resolve({ type: "set_rate", rate: 3 }), {
      type: "configure",
      config: { ...config, playbackRate: 2 },
    });
    assert.deepEqual(resolve({ type: "adjust_rate", direction: "slower" }), {
      type: "configure",
      config: { ...config, playbackRate: 0.9 },
    });
    let current = createPlayerConfig({ playbackRate: 0.7, rateStep: 0.1 });
    for (let i = 0; i < 4; i++) {
      const result = resolvePlayerCommand(
        { type: "adjust_rate", direction: "slower" },
        { ...context, config: current },
      );
      assert.equal(result.type, "configure");
      if (result.type === "configure") current = result.config;
    }
    assert.equal(current.playbackRate, 0.5);
    assert.deepEqual(
      resolvePlayerCommand(
        { type: "adjust_rate", direction: "faster" },
        {
          ...context,
          config: createPlayerConfig({ playbackRate: 1.95 }),
        },
      ),
      { type: "configure", config: { ...config, playbackRate: 2 } },
    );
    assert.deepEqual(resolve({ type: "set_rate", rate: 0.25 }), {
      type: "configure",
      config: { ...config, playbackRate: 0.5 },
    });
  });

  it("controls volume and mute independently", () => {
    assert.deepEqual(resolve({ type: "set_volume", volume: 0.3 }), {
      type: "configure",
      config: { ...config, volume: 0.3 },
    });
    assert.deepEqual(resolve({ type: "set_muted", muted: true }), {
      type: "configure",
      config: { ...config, muted: true },
    });
  });

  it("uses the configured skip step, explicit offsets and episode boundaries", () => {
    assert.deepEqual(resolve({ type: "skip", direction: "backward" }), {
      type: "seek",
      atMs: 15000,
      playback: "preserve",
    });
    assert.deepEqual(
      resolve({ type: "skip", direction: "forward", amountMs: 50000 }),
      {
        type: "seek",
        atMs: 60000,
        playback: "preserve",
      },
    );
    assert.deepEqual(resolve({ type: "seek", atMs: -100 }), {
      type: "seek",
      atMs: 0,
      playback: "preserve",
    });
    assert.deepEqual(
      resolve({ type: "seek", atMs: 999999, playback: "pause" }),
      {
        type: "seek",
        atMs: 60000,
        playback: "pause",
      },
    );
    assert.deepEqual(
      resolvePlayerCommand(
        { type: "skip", direction: "forward" },
        {
          ...context,
          config: createPlayerConfig({ seekStepMs: 5000 }),
        },
      ),
      { type: "seek", atMs: 30000, playback: "preserve" },
    );
  });

  it("repeats the current semantic segment, or the previous one at an exact boundary", () => {
    const anchors = [
      {
        id: "second",
        startMs: 20000,
        endMs: 30000,
        text: "second",
        confidence: 1,
      },
      {
        id: "first",
        startMs: 10000,
        endMs: 20000,
        text: "first",
        confidence: 1,
      },
      {
        id: "future",
        startMs: 40000,
        endMs: 50000,
        text: "future",
        confidence: 1,
      },
    ];
    assert.deepEqual(
      resolvePlayerCommand({ type: "repeat" }, { ...context, anchors }),
      {
        type: "seek",
        atMs: 20000,
        playback: "play",
      },
    );
    assert.deepEqual(
      resolvePlayerCommand(
        { type: "repeat" },
        { ...context, anchors, positionMs: 20000 },
      ),
      {
        type: "seek",
        atMs: 10000,
        playback: "play",
      },
    );
    assert.equal(anchors[0].id, "second");
  });

  it("falls back to a bounded rewind when semantic timestamps are missing or only in the future", () => {
    assert.deepEqual(resolve({ type: "repeat" }), {
      type: "seek",
      atMs: 15000,
      playback: "play",
    });
    assert.deepEqual(
      resolvePlayerCommand(
        { type: "repeat" },
        {
          ...context,
          positionMs: 2000,
          anchors: [
            {
              id: "future",
              startMs: 4000,
              endMs: 5000,
              text: "future",
              confidence: 1,
            },
          ],
        },
      ),
      { type: "seek", atMs: 0, playback: "play" },
    );
    assert.deepEqual(
      resolvePlayerCommand(
        { type: "repeat" },
        {
          ...context,
          config: createPlayerConfig({ repeatFallbackMs: 5000 }),
        },
      ),
      { type: "seek", atMs: 20000, playback: "play" },
    );
  });

  it("preserves transport commands and rejects malformed input before any execution", () => {
    for (const type of ["play", "pause", "stop"] as const)
      assert.deepEqual(resolve({ type }), { type });
    for (const command of [
      { type: "seek", atMs: Infinity },
      { type: "set_rate", rate: 0 },
      { type: "skip", direction: "forward", amountMs: -1 },
      { type: "set_volume", volume: 2 },
      { type: "set_muted", muted: "yes" },
      { type: "seek", atMs: 0, playback: "unknown" },
      { type: "invented" },
      { type: "pause", extra: true },
    ])
      assert.throws(() => resolvePlayerCommand(command, context));
  });
});
