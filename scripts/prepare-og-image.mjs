import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Renders the 1200x630 Open Graph / Twitter card images into frontend/public,
// one per interface language: a link preview has to read in the language of the
// title beside it. Re-run after brand or headline changes: npm run prepare:og

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cards = [
  {
    file: "og-image.png",
    lang: "en",
    heading: "Follow your curiosity,<br /><em>ask anytime.</em>",
    sub: "Interrupt a podcast. Ask out loud. Keep listening.",
  },
  {
    file: "og-image-zh.png",
    lang: "zh-CN",
    heading: "听到好奇的地方，<br /><em>随时插话。</em>",
    sub: "用语音打断播客，随口提问，接着听。",
  },
];

const mark = `<svg viewBox="0 0 100 100" width="58" height="58" aria-hidden="true"><g fill="#73777d">
  <circle cx="50" cy="23" r="12"/>
  <path d="M32 34 C22 39 14 47 10 57" fill="none" stroke="#73777d" stroke-width="11" stroke-linecap="round"/>
  <path d="M68 34 C78 39 86 47 90 57" fill="none" stroke="#73777d" stroke-width="11" stroke-linecap="round"/>
  <rect x="32" y="62" width="10" height="19" rx="5"/>
  <rect x="45" y="54" width="10" height="34" rx="5"/>
  <rect x="60" y="62" width="10" height="20" rx="5"/>
</g></svg>`;

const bars = Array.from(
  { length: 40 },
  (_, index) => `<i style="height:${10 + ((index * 17 + 7) % 41)}px"></i>`,
).join("");

const html = (card) => `<!doctype html>
<html lang="${card.lang}">
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        width: 1200px;
        height: 630px;
        padding: 76px 88px 64px;
        background: #f7f6f3;
        color: #292c30;
        font-family: "PingFang SC", system-ui, -apple-system, sans-serif;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        position: relative;
        overflow: hidden;
      }
      .orbit {
        position: absolute;
        border: 1px solid #e0dfdc;
        border-radius: 50%;
      }
      .orbit-a { width: 620px; height: 620px; top: -300px; right: -160px; }
      .orbit-b { width: 420px; height: 420px; top: -200px; right: -60px; border-color: #dfe6e1; }
      .brand {
        display: flex;
        align-items: center;
        gap: 16px;
        font-family: Georgia, "Songti SC", serif;
        font-size: 60px;
        letter-spacing: -3px;
        color: #73777d;
      }
      h1 {
        margin: 0;
        font-family: Georgia, "Songti SC", "PingFang SC", serif;
        font-size: 78px;
        font-weight: 600;
        line-height: 1.18;
        letter-spacing: -1px;
      }
      h1 em { font-style: normal; color: #334d3d; }
      .sub {
        margin: 26px 0 0;
        font-size: 27px;
        line-height: 1.5;
        color: #565b61;
      }
      .foot {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
      }
      .wave { display: flex; align-items: flex-end; gap: 6px; height: 56px; }
      .wave i {
        display: block;
        width: 6px;
        border-radius: 3px;
        background: #5b7768;
        opacity: 0.55;
      }
      .site {
        font-size: 22px;
        letter-spacing: 3px;
        text-transform: uppercase;
        color: #6d7278;
      }
    </style>
  </head>
  <body>
    <span class="orbit orbit-a"></span>
    <span class="orbit orbit-b"></span>
    <div class="brand">Aside ${mark}</div>
    <div>
      <h1>${card.heading}</h1>
      <p class="sub">${card.sub}</p>
    </div>
    <div class="foot">
      <span class="site">asidefm.com</span>
      <span class="wave">${bars}</span>
    </div>
  </body>
</html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  for (const card of cards) {
    const target = resolve(root, "frontend/public", card.file);
    await page.setContent(html(card), { waitUntil: "load" });
    await mkdir(dirname(target), { recursive: true });
    await page.screenshot({ path: target });
    console.log(`wrote ${target}`);
  }
} finally {
  await browser.close();
}
