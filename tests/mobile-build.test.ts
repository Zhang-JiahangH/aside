import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBuildEnvironment } from "../mobile/app.config.js";

test("local signing uses the real HTTPS service unless a test API is explicitly selected", () => {
  assert.deepEqual(resolveBuildEnvironment({ APP_VARIANT: "local" }), {
    local: true,
    testApi: false,
    apiUrl: "https://asidefm.com",
  });
  assert.throws(
    () =>
      resolveBuildEnvironment({ EXPO_PUBLIC_API_URL: "http://127.0.0.1:4311" }),
    /HTTPS/,
  );
  assert.deepEqual(
    resolveBuildEnvironment({
      ASIDE_TEST_API: "1",
      EXPO_PUBLIC_API_URL: "http://127.0.0.1:4311",
    }),
    {
      local: true,
      testApi: true,
      apiUrl: "http://127.0.0.1:4311",
    },
  );
});
test("distribution builds cannot silently carry a fixture URL or a test flag", () => {
  for (const url of [
    "http://asidefm.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://10.0.2.2",
  ]) {
    assert.throws(
      () =>
        resolveBuildEnvironment({
          APP_VARIANT: "production",
          EXPO_PUBLIC_API_URL: url,
        }),
      /HTTPS/,
    );
  }
  assert.throws(
    () =>
      resolveBuildEnvironment({
        APP_VARIANT: "production",
        ASIDE_TEST_API: "1",
      }),
    /production/,
  );
  assert.throws(
    () =>
      resolveBuildEnvironment({
        EXPO_PUBLIC_API_URL: "https://asidefm.com/?token=secret",
      }),
    /origin/,
  );
});
