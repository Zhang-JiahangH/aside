import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

// Exercise the shipped image, including its codec libraries and runtime dependencies.
// This test never contacts a model or a business service.
const image = process.argv[2] ?? "aside-media:ci";
const docker = (...args) =>
  execFileSync("docker", args, { maxBuffer: 8 * 1024 * 1024, timeout: 60000 });
const container = docker(
  "run",
  "--rm",
  "-d",
  "--platform",
  "linux/amd64",
  "-p",
  "127.0.0.1::8080",
  image,
)
  .toString()
  .trim();
try {
  const address = docker("port", container, "8080/tcp").toString().trim();
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  const origin = `http://${address}`;
  let healthy = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    healthy = await fetch(`${origin}/health`)
      .then((r) => r.ok)
      .catch(() => false);
    if (healthy) break;
    await delay(500);
  }
  assert.ok(healthy, "The production image must boot and become healthy");
  const codec = (...args) =>
    docker("exec", container, "ffmpeg", "-v", "error", "-y", ...args);
  const read = (path) => docker("exec", container, "cat", path);
  const post = (path, body) =>
    fetch(`${origin}${path}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body,
      signal: AbortSignal.timeout(30000),
    });
  codec(
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=400:duration=1",
    "-c:a",
    "aac",
    "/tmp/question.m4a",
  );
  const question = await post("/question", read("/tmp/question.m4a"));
  assert.equal(question.status, 200);
  const wav = Buffer.from(await question.arrayBuffer());
  const probe = JSON.parse(
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        container,
        "ffprobe",
        "-v",
        "error",
        "-show_streams",
        "-of",
        "json",
        "pipe:0",
      ],
      { input: wav },
    ).toString(),
  );
  assert.equal(probe.streams[0].codec_name, "pcm_s16le");
  assert.equal(probe.streams[0].sample_rate, "16000");
  assert.equal(probe.streams[0].channels, 1);
  assert.equal((await post("/question", Buffer.from("invalid"))).status, 422);
  codec(
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=400:duration=31",
    "-c:a",
    "aac",
    "/tmp/overlong.m4a",
  );
  assert.equal(
    (await post("/question", read("/tmp/overlong.m4a"))).status,
    422,
  );
  console.log(
    "PASS: M4A decodes to mono 16 kHz PCM; invalid and overlong recordings are rejected",
  );

  codec(
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=400:duration=2",
    "-f",
    "lavfi",
    "-i",
    "color=c=green:s=80x80:d=0.04",
    "-map",
    "0:a",
    "-map",
    "1:v",
    "-c:a",
    "libmp3lame",
    "-c:v",
    "mjpeg",
    "-threads:v",
    "1",
    "-frames:v",
    "1",
    "-disposition:v",
    "attached_pic",
    "-id3v2_version",
    "3",
    "/tmp/episode.mp3",
  );
  const id = randomUUID();
  const prepared = await post(`/prepare?id=${id}`, read("/tmp/episode.mp3"));
  assert.equal(prepared.status, 200);
  const manifest = await prepared.json();
  assert.ok(manifest.durationMs >= 2000 && manifest.durationMs < 2500);
  assert.equal(manifest.cover, true);
  assert.ok(manifest.plan.length > 0);
  const chunk = await fetch(`${origin}/chunk?id=${id}&index=0`);
  assert.equal(chunk.status, 200);
  assert.equal(chunk.headers.get("content-type"), "audio/mpeg");
  assert.ok((await chunk.arrayBuffer()).byteLength > 1000);
  const cover = await fetch(`${origin}/cover?id=${id}`);
  assert.equal(cover.status, 200);
  assert.equal(cover.headers.get("content-type"), "image/jpeg");
  await cover.arrayBuffer();
  assert.equal(
    (await fetch(`${origin}/source?id=${id}`, { method: "DELETE" })).status,
    200,
  );
  assert.equal((await fetch(`${origin}/chunk?id=${id}&index=0`)).status, 409);
  console.log(
    "PASS: episode admission, MP3 segmentation, JPEG cover extraction and cleanup",
  );
} catch (error) {
  process.stderr.write(docker("logs", container));
  throw error;
} finally {
  docker("stop", "--time", "2", container);
}
