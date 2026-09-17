import assert from "node:assert/strict";

// These malformed requests exercise routing and auth without sending email,
// guessing a code, or invoking a model. A web-only deployment must fail loudly.
const origin = new URL(process.argv[2] ?? "https://asidefm.com").origin;
const checks = [
  ["mobile email start", "/auth/mobile/email/start", "POST", {}, 400],
  ["mobile email verify", "/auth/mobile/email/verify", "POST", {}, 400],
  [
    "Bearer session validation",
    "/auth/session",
    "GET",
    { Authorization: `Bearer ${"0".repeat(64)}` },
    401,
  ],
  ["website Origin protection", "/auth/email/start", "POST", {}, 403],
];
const results = await Promise.allSettled(
  checks.map(async ([name, path, method, headers, status]) => {
    const response = await fetch(`${origin}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      ...(method === "POST" ? { body: "{}" } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    const value = await response.json();
    assert.equal(
      response.status,
      status,
      `${name}: expected ${status}, received ${response.status} (${String(value.error ?? "unexpected response").slice(0, 150)})`,
    );
    assert.equal(typeof value.error, "string", `${name}: missing JSON error`);
    console.log(`PASS ${name}`);
  }),
);
for (const result of results) {
  if (result.status === "rejected") {
    console.error(`FAIL ${result.reason.message}`);
    process.exitCode = 1;
  }
}
