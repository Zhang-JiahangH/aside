import { test } from "node:test";
import assert from "node:assert/strict";
import {
  message,
  resolveLocale,
  setLocale,
  withKeepListeningHint,
} from "../frontend/src/i18n";

test("locale follows ordered browser preferences with English fallback", () => {
  assert.equal(resolveLocale(["en-US", "zh-CN"]), "en");
  assert.equal(resolveLocale(["zh-TW", "en-US"]), "zh");
  assert.equal(resolveLocale(["zh-Hans-CN"]), "zh");
  assert.equal(resolveLocale(["fr-FR", "zh-CN"]), "zh");
  assert.equal(resolveLocale(["fr-FR"]), "en");
  assert.equal(resolveLocale([]), "en");
});

test("saved supported language overrides the browser; invalid preference is ignored", () => {
  assert.equal(resolveLocale(["en-US"], "zh"), "zh");
  assert.equal(resolveLocale(["zh-CN"], "en"), "en");
  assert.equal(resolveLocale(["zh-CN"], "fr"), "zh");
});

test("the keep-listening reassurance is appended once, never twice", () => {
  setLocale("en");
  // The trial notice already reassures, so the suffix must be left off.
  assert.equal(
    message(withKeepListeningHint("AI 试用暂时关闭，仍可继续收听")),
    "AI trials are temporarily paused. You can keep listening.",
  );
  assert.equal(
    message(withKeepListeningHint("今日 AI 试用暂时关闭，仍可继续收听")),
    "AI trials are paused for today. You can keep listening.",
  );
  // A plain failure still gets the reassurance, in the reader's language.
  assert.equal(
    message(withKeepListeningHint("服务暂时不可用，请重试")),
    "The service is temporarily unavailable. Please try again. You can keep listening or try asking again.",
  );
  setLocale("zh");
  assert.equal(
    message(withKeepListeningHint("AI 试用暂时关闭，仍可继续收听")),
    "AI 试用暂时关闭，仍可继续收听",
  );
  assert.equal(
    message(withKeepListeningHint("服务暂时不可用，请重试")),
    "服务暂时不可用，请重试。可以继续听节目，或重新尝试提问。",
  );
  setLocale("en");
});
