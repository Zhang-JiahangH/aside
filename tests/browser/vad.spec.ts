import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/episodes/demo-natural-resume/checkpoint", (route) =>
    route.fulfill({ json: { positionMs: 0, history: [] } }),
  );
});

for (const quiet of [false, true])
  test(`real local Silero rejects noise and detects ${quiet ? "quiet" : "normal"} speech`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    let creates = 0;
    await page.route("**/api/health", async (route) => {
      const r = await route.fetch();
      await route.fulfill({
        json: {
          ...(await r.json()),
          liveConfigured: true,
          microphone: {
            threshold: 0.025,
            minSpeechMs: 120,
            silenceMs: 650,
            vadEnabled: true,
            vadThreshold: 0.8,
          },
        },
      });
    });
    await page.route("**/api/episodes/*/live", (route) => {
      creates++;
      return route.fulfill({
        status: 503,
        json: { error: "Test only: no cloud calls" },
      });
    });
    await page.route("**/api/episodes/*/transcribe-question", (route) =>
      route.fulfill({ json: { text: "测试语音" } }),
    );
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: async () => {
          const ctx = new AudioContext();
          const dest = ctx.createMediaStreamDestination();
          const gain = ctx.createGain();
          gain.gain.value = 0;
          const osc = ctx.createOscillator();
          osc.connect(gain).connect(dest);
          osc.start();
          await ctx.resume();
          Object.assign(window, { vadFixture: { ctx, dest, gain } });
          return dest.stream;
        },
      });
    });
    await page.goto("/?debug");
    await page.getByRole("link", { name: /给思考留一点空间/ }).click();
    await page.locator(".debug-toggle").click();
    await page.getByRole("button", { name: "开启麦克风", exact: true }).click();
    await page.getByRole("button", { name: "播放", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "● 本地监听" }),
    ).toBeVisible({ timeout: 30000 });
    await page.evaluate(() => {
      (window as any).vadFixture.gain.gain.value = 0.3;
    });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      (window as any).vadFixture.gain.gain.value = 0;
    });
    // Auto mode now opens one continuous Live connection when enabled. VAD
    // still rejects the tone, and unclassified input must not pause playback.
    expect(creates).toBe(1);
    await expect(page.locator(".debug")).not.toContainText(
      "Local speech started",
    );
    expect(
      await page.locator("audio").evaluate((a: HTMLAudioElement) => a.paused),
    ).toBe(false);
    await page.evaluate(async (quiet) => {
      const { ctx, dest } = (window as any).vadFixture;
      const bytes = await (
        await fetch("/api/episodes/demo-natural-resume/audio")
      ).arrayBuffer();
      const buffer = await ctx.decodeAudioData(bytes);
      if (quiet) {
        const size = Math.round(buffer.sampleRate * 0.032);
        let peakRms = 0;
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const data = buffer.getChannelData(channel);
          for (let at = 0; at < data.length; at += size) {
            let sum = 0;
            const n = Math.min(size, data.length - at);
            for (let i = 0; i < n; i++) sum += data[at + i] ** 2;
            peakRms = Math.max(peakRms, Math.sqrt(sum / n));
          }
        }
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const data = buffer.getChannelData(channel);
          for (let i = 0; i < data.length; i++) data[i] *= 0.012 / peakRms;
        }
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(dest);
      source.start(0, 0, 5);
    }, quiet);
    await expect(page.locator(".debug")).toContainText("Local speech started", {
      timeout: 10000,
    });
    expect(
      await page.locator("audio").evaluate((a: HTMLAudioElement) => a.paused),
    ).toBe(false);
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "麦克风未监听" }),
    ).toBeVisible();
    await page.evaluate(() => (window as any).vadFixture.ctx.close());
  });
