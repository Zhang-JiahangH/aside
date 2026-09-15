import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
const exec = promisify(execFile);
function parseSilences(stderr: string) {
  const pauses: { startMs: number; endMs: number }[] = [];
  let start: number | undefined;
  for (const line of stderr.split("\n")) {
    const a = /silence_start: ([\d.]+)/.exec(line);
    if (a) start = Number(a[1]) * 1000;
    const b = /silence_end: ([\d.]+)/.exec(line);
    if (b && start !== undefined) {
      pauses.push({
        startMs: Math.round(start),
        endMs: Math.round(Number(b[1]) * 1000),
      });
      start = undefined;
    }
  }
  return pauses;
}
export async function findSilences(path: string) {
  const { stderr } = await exec(
    "ffmpeg",
    [
      "-hide_banner",
      "-i",
      path,
      "-af",
      "silencedetect=noise=-35dB:d=0.18",
      "-f",
      "null",
      "-",
    ],
    { timeout: 25 * 60000, maxBuffer: 8 * 1024 * 1024 },
  );
  return parseSilences(stderr);
}
/**
 * One decode pass writes the mono speech track the models receive and reports
 * the pauses that segment boundaries snap to.
 */
export async function encodeSpeechTrack(path: string, output: string) {
  const { stderr } = await exec(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-y",
      "-i",
      path,
      "-filter_complex",
      "[0:a:0]asplit=2[scan][speech];[scan]silencedetect=noise=-35dB:d=0.18[silent]",
      "-map",
      "[silent]",
      "-f",
      "null",
      "-",
      "-map",
      "[speech]",
      "-ac",
      "1",
      "-ar",
      "24000",
      "-b:a",
      "48k",
      output,
    ],
    { timeout: 25 * 60000, maxBuffer: 8 * 1024 * 1024 },
  );
  return parseSilences(stderr);
}
/**
 * Cuts the speech track at the planned boundaries without re-encoding, as
 * `segment-<n>.mp3` in `dir`. Cuts land on MP3 frame edges, so the returned
 * offsets come from the segment list rather than the plan.
 */
export async function cutSegments(
  track: string,
  plan: { offsetMs: number; durationMs: number }[],
  dir: string,
) {
  const cuts = plan.slice(1).map((chunk) => (chunk.offsetMs / 1000).toFixed(3));
  const list = join(dir, "segments.csv");
  await exec(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-i",
      track,
      "-map",
      "0:a",
      "-c",
      "copy",
      "-f",
      "segment",
      ...(cuts.length
        ? ["-segment_times", cuts.join(",")]
        : ["-segment_time", "86400"]),
      "-reset_timestamps",
      "1",
      "-segment_list",
      list,
      "-segment_list_type",
      "csv",
      join(dir, "segment-%d.mp3"),
    ],
    { timeout: 5 * 60000 },
  );
  return (await readFile(list, "utf8"))
    .trim()
    .split("\n")
    .map((line) => {
      const [, start, end] = line.split(",");
      return {
        offsetMs: Math.round(Number(start) * 1000),
        durationMs: Math.round((Number(end) - Number(start)) * 1000),
      };
    });
}
export function planChunks(
  durationMs: number,
  pauses: { startMs: number; endMs: number }[],
) {
  const chunks: { offsetMs: number; durationMs: number }[] = [];
  let at = 0;
  while (at < durationMs) {
    const target = Math.min(at + 240000, durationMs);
    const nearest =
      target === durationMs
        ? undefined
        : pauses
            .filter((p) => Math.abs((p.startMs + p.endMs) / 2 - target) < 15000)
            .sort(
              (a, b) =>
                Math.abs((a.startMs + a.endMs) / 2 - target) -
                Math.abs((b.startMs + b.endMs) / 2 - target),
            )[0];
    const end = nearest
      ? Math.round((nearest.startMs + nearest.endMs) / 2)
      : target;
    chunks.push({ offsetMs: at, durationMs: end - at });
    at = end;
  }
  return chunks;
}
