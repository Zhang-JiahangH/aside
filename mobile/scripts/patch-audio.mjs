/** SDK 54 backport of expo/expo#44974: paused Now Playing time must not advance. */
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
let path;
try {
  path = join(
    dirname(require.resolve("expo-audio/package.json")),
    "ios/MediaController.swift",
  );
} catch (error) {
  if (error.code === "MODULE_NOT_FOUND") process.exit(0); // Backend-only installation.
  throw error;
}
const source = await readFile(path, "utf8");
const before = "player.isPlaying ? player.ref.rate : 1.0";
const after = "player.isPlaying ? player.ref.rate : 0.0";
if (source.includes(before))
  await writeFile(path, source.replace(before, after));
else if (!source.includes(after))
  throw Error(
    "Review the expo-audio Now Playing backport after upgrading the SDK.",
  );

// SDK 54 resets the mode only when category options are empty. Recording uses
// Bluetooth options, so a previous WebRTC .voiceChat mode otherwise survives.
const modulePath = join(dirname(path), "AudioModule.swift");
const moduleSource = await readFile(modulePath, "utf8");
const modeBefore = "try session.setCategory(category, options: sessionOptions)";
const modeAfter =
  "try session.setCategory(category, mode: .default, options: sessionOptions)";
if (moduleSource.includes(modeBefore))
  await writeFile(modulePath, moduleSource.replace(modeBefore, modeAfter));
else if (!moduleSource.includes(modeAfter))
  throw Error(
    "Review the expo-audio recording mode reset after upgrading the SDK.",
  );
