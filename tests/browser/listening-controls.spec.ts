import { test, expect, type Page } from "@playwright/test";

async function openDemo(page: Page) {
  await page.route("**/api/episodes/demo-natural-resume/checkpoint", (route) =>
    route.fulfill({ json: { positionMs: 3, history: [] } }),
  );
  await page.route("**/api/health", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...(await response.json()),
        liveConfigured: true,
        microphone: {
          vadEnabled: false,
          threshold: 0.025,
          minSpeechMs: 120,
          silenceMs: 160,
        },
        voiceLifecycle: {
          preRollMs: 750,
          graceMs: 100,
          idleCloseMs: 60000,
          autoResumeMs: 3000,
        },
      },
    });
  });
  // No test can fall through to a paid voice or transcription request.
  await page.route("**/api/episodes/*/live", (route) =>
    route.fulfill({ status: 503, json: { error: "测试连接不可用" } }),
  );
  await page.route("**/api/episodes/*/transcribe-question", (route) =>
    route.fulfill({ json: { text: "测试问题" } }),
  );
  await page.route("**/api/episodes/*/question", (route) =>
    route.fulfill({
      json: {
        revision: route.request().postDataJSON().revision,
        action: "answer",
        answer: "散步给思考留出空间。",
        sources: [],
        tools: [],
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("link", { name: /给思考留一点空间/ }).click();
}

async function ask(page: Page, text = "为什么？") {
  await page.getByRole("textbox", { name: "输入消息" }).fill(text);
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.locator(".message.assistant").last()).toContainText("散步");
}

const paused = (page: Page) =>
  page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.paused);

test("denied entry permission keeps playback and follow-up controls usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, { micRequests: 0 });
    navigator.mediaDevices.getUserMedia = async () => {
      (window as any).micRequests++;
      throw new DOMException("denied", "NotAllowedError");
    };
  });
  await openDemo(page);
  await page.getByRole("button", { name: "开启麦克风", exact: true }).click();
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect.poll(() => paused(page)).toBe(false);
  expect(await page.evaluate(() => (window as any).micRequests)).toBe(1);
  await ask(page);
  await expect(page.locator(".followup-window")).toContainText(/秒后继续播放/);
  await page.getByRole("button", { name: "先别继续" }).click();
  await expect(page.locator(".followup-window")).toContainText("准备好了");
  await ask(page, "再解释一点");
  await page.waitForTimeout(3400);
  expect(await paused(page)).toBe(true);
  await page.getByRole("button", { name: "继续听 ↗" }).click();
  await expect.poll(() => paused(page)).toBe(false);
  await ask(page);
  await expect(page.locator(".followup-window")).toContainText(/秒后继续播放/);
  await expect.poll(() => paused(page), { timeout: 5000 }).toBe(false);
});

test("microphone rejection leaves original playback usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("未允许麦克风", "NotAllowedError");
    };
  });
  await openDemo(page);
  await page.getByRole("button", { name: "开启麦克风", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("仍可继续收听");
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect.poll(() => paused(page)).toBe(false);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect.poll(() => paused(page)).toBe(true);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect.poll(() => paused(page)).toBe(false);
});

test("long answers leave eight seconds and long conversations show heard context", async ({
  page,
}) => {
  await openDemo(page);
  await page.clock.install();
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = 26;
  });
  await page.route("**/api/episodes/*/question", (route) =>
    route.fulfill({
      json: {
        revision: route.request().postDataJSON().revision,
        action: "answer",
        answer: "散步让思考变得轻松。".repeat(24),
        sources: [],
        tools: [],
      },
    }),
  );
  await ask(page);
  await expect(page.locator(".followup-window")).toContainText(
    "8 秒后继续播放",
  );
  await page.getByRole("button", { name: "先别继续" }).click();
  await page.clock.fastForward(61000);
  await expect(page.locator(".return-context")).toContainText("刚才听到");
  expect(await paused(page)).toBe(true);
});
