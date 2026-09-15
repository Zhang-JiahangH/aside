import { z } from "zod";
import type { Anchor } from "./core.js";

// Product limits keep normal speech intelligible; applications may narrow them.
const rate = z.number().finite().min(0.5).max(2);
const milliseconds = z.number().finite().positive();
export const playerConfigSchema = z
  .object({
    playbackRate: rate,
    minRate: rate,
    maxRate: rate,
    rateStep: z.number().finite().min(0.01).max(1),
    volume: z.number().finite().min(0).max(1),
    muted: z.boolean(),
    preservesPitch: z.boolean(),
    seekStepMs: milliseconds,
    repeatFallbackMs: milliseconds,
  })
  .strict()
  .refine(
    (c) =>
      c.minRate <= c.maxRate &&
      c.playbackRate >= c.minRate &&
      c.playbackRate <= c.maxRate,
    { message: "Playback rate must be within the configured rate limits" },
  )
  .readonly();

/** Player preferences and control policy, independent of microphones and personas. */
export type PlayerConfig = z.infer<typeof playerConfigSchema>;
export const DEFAULT_PLAYER_CONFIG: PlayerConfig = Object.freeze({
  playbackRate: 1,
  minRate: 0.5,
  maxRate: 2,
  rateStep: 0.1,
  volume: 1,
  muted: false,
  preservesPitch: true,
  seekStepMs: 10000,
  repeatFallbackMs: 10000,
});

export function createPlayerConfig(
  patch: Partial<PlayerConfig> = {},
  base: PlayerConfig = DEFAULT_PLAYER_CONFIG,
): PlayerConfig {
  return playerConfigSchema.parse({ ...base, ...patch });
}

const seekPlayback = z.enum(["preserve", "play", "pause"]);
/** Language-independent commands. Natural-language parsing belongs outside the player. */
export const playerCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("play") }).strict(),
  z.object({ type: z.literal("pause") }).strict(),
  z.object({ type: z.literal("stop") }).strict(),
  z
    .object({
      type: z.literal("set_rate"),
      rate: z.number().finite().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("adjust_rate"),
      direction: z.enum(["slower", "faster"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("set_volume"),
      volume: z.number().finite().min(0).max(1),
    })
    .strict(),
  z.object({ type: z.literal("set_muted"), muted: z.boolean() }).strict(),
  z
    .object({
      type: z.literal("seek"),
      atMs: z.number().finite(),
      playback: seekPlayback.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("skip"),
      direction: z.enum(["backward", "forward"]),
      amountMs: milliseconds.optional(),
    })
    .strict(),
  z.object({ type: z.literal("repeat") }).strict(),
]);
export type PlayerCommand = z.infer<typeof playerCommandSchema>;
export type PlayerEffect =
  | { type: "configure"; config: PlayerConfig }
  | { type: "seek"; atMs: number; playback: z.infer<typeof seekPlayback> }
  | { type: "play" | "pause" | "stop" };

interface PlayerContext {
  config: PlayerConfig;
  positionMs: number;
  durationMs: number;
  anchors: readonly Anchor[];
}

export function clampPlayerPosition(atMs: number, durationMs: number): number {
  if (!Number.isFinite(atMs) || !Number.isFinite(durationMs) || durationMs < 0)
    throw Error(
      "Player position and duration must be finite; duration cannot be negative",
    );
  return Math.max(0, Math.min(durationMs, atMs));
}

/** Resolve and validate the whole command before touching audio or cancelling work. */
export function resolvePlayerCommand(
  input: unknown,
  context: PlayerContext,
): PlayerEffect {
  const command = playerCommandSchema.parse(input);
  const { config, durationMs, anchors } = context;
  const positionMs = clampPlayerPosition(context.positionMs, durationMs);
  const configure = (patch: Partial<PlayerConfig>): PlayerEffect => ({
    type: "configure",
    config: createPlayerConfig(patch, config),
  });
  const setRate = (value: number) =>
    configure({
      playbackRate: Math.max(config.minRate, Math.min(config.maxRate, value)),
    });
  switch (command.type) {
    case "play":
    case "pause":
    case "stop":
      return command;
    case "set_rate":
      return setRate(command.rate);
    case "adjust_rate":
      return setRate(
        Math.round(
          (config.playbackRate +
            (command.direction === "slower" ? -1 : 1) * config.rateStep) *
            1000,
        ) / 1000,
      );
    case "set_volume":
      return configure({ volume: command.volume });
    case "set_muted":
      return configure({ muted: command.muted });
    case "seek":
      return {
        type: "seek",
        atMs: clampPlayerPosition(command.atMs, durationMs),
        playback: command.playback ?? "preserve",
      };
    case "skip": {
      const amount = command.amountMs ?? config.seekStepMs;
      // Bound travel by the remaining distance before adding the requested offset.
      const available =
        command.direction === "backward" ? positionMs : durationMs - positionMs;
      const offset =
        Math.min(amount, available) *
        (command.direction === "backward" ? -1 : 1);
      return {
        type: "seek",
        atMs: clampPlayerPosition(positionMs + offset, durationMs),
        playback: "preserve",
      };
    }
    case "repeat": {
      // Strictly before the playhead: at a sentence boundary repeat what was just heard.
      // Anchors are semantic segments, not guaranteed word-aligned sentences.
      let latest: Anchor | undefined;
      for (const anchor of anchors) {
        if (
          Number.isFinite(anchor.startMs) &&
          anchor.startMs >= 0 &&
          anchor.startMs < positionMs &&
          anchor.endMs > anchor.startMs &&
          (!latest || anchor.startMs > latest.startMs)
        )
          latest = anchor;
      }
      return {
        type: "seek",
        atMs: clampPlayerPosition(
          latest?.startMs ?? positionMs - config.repeatFallbackMs,
          durationMs,
        ),
        playback: "play",
      };
    }
  }
}
