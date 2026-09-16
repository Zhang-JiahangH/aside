import { test, expect } from "@playwright/test";

test.use({ locale: "en-US" });

test("English browser default, persistent switch, and uninterrupted playback", async ({
  page,
}) => {
  await page.route("**/api/episodes/demo-natural-resume/checkpoint", (route) =>
    route.fulfill({
      json: {
        positionMs: 0,
        history: [{ role: "user", text: "保留这段对话" }],
      },
    }),
  );
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("denied", "NotAllowedError");
    };
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", { name: /Recorded then.*Your turn now/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: /给思考留一点空间/ }).click();
  await expect(page.getByRole("region", { name: "Transcript" })).toContainText(
    "今天天气真好",
  );
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0.2);
  const audio = await page.locator("audio").elementHandle();
  const position = await audio!.evaluate(
    (audio: HTMLAudioElement) => audio.currentTime,
  );
  await page.getByRole("button", { name: "Interface language" }).click();
  await page.getByRole("option", { name: "中文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("region", { name: "文字稿" })).toBeVisible();
  await expect(page.getByRole("log")).toContainText("保留这段对话");
  expect(
    await audio!.evaluate(
      (audio: HTMLAudioElement, previous: number) =>
        audio.isConnected && !audio.paused && audio.currentTime >= previous,
      position,
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "界面语言" })).toContainText(
    "中文",
  );
  await expect(page).toHaveTitle("Aside · 用语音打断播客，随口提问接着听");
  await page.getByRole("button", { name: "界面语言" }).click();
  await page.getByRole("option", { name: "English" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Interface language" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("Chinese browser works when preference storage is unavailable", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "zh-TW" });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === "aside.locale") throw new Error("blocked");
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "aside.locale") throw new Error("blocked");
      return setItem.call(this, key, value);
    };
  });
  await page.goto("http://127.0.0.1:5173/");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.getByRole("button", { name: "界面语言" }).click();
  await page.getByRole("option", { name: "English" }).click();
  await expect(
    page.getByRole("heading", { name: /Recorded then.*Your turn now/ }),
  ).toBeVisible();
  await context.close();
});
