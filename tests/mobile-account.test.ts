import { test } from "node:test";
import assert from "node:assert/strict";
import { restoreAccount } from "../mobile/src/account-session.js";

test("a failed session lookup retains credentials and can be retried", async () => {
  let credential: string | null = "saved-session";
  let online = false;
  const user = { id: "account", email: "listener@example.com" };
  const session = {
    restore: async () => {},
    me: async () => {
      if (!online) throw new TypeError("Network request failed");
      assert.equal(credential, "saved-session");
      return { user };
    },
    forget: async () => {
      credential = null;
    },
  };
  await assert.rejects(restoreAccount(session), /Network request failed/);
  assert.equal(credential, "saved-session");
  online = true;
  assert.equal(await restoreAccount(session), user);
});

test("a confirmed signed-out session clears stale credentials", async () => {
  let forgotten = false;
  assert.equal(
    await restoreAccount({
      restore: async () => {},
      me: async () => ({ user: null }),
      forget: async () => {
        forgotten = true;
      },
    }),
    null,
  );
  assert.equal(forgotten, true);
});

test("a web-only deployment cannot discard a saved mobile credential", async () => {
  const user = { id: "account" };
  let mobileSupported = false;
  const session = {
    token: "saved-session" as string | null,
    restore: async () => {},
    me: async () => ({ user: mobileSupported ? user : null }),
    forget: async () => {
      session.token = null;
    },
  };
  await assert.rejects(restoreAccount(session), /temporarily unavailable/);
  assert.equal(session.token, "saved-session");
  mobileSupported = true;
  assert.equal(await restoreAccount(session), user);
});

test("an expired token permits signing in again while a server outage preserves it", async () => {
  for (const status of [401, 503]) {
    let forgotten = false;
    const session = {
      restore: async () => {},
      me: async (): Promise<{ user: null }> => {
        throw Object.assign(new Error("Request failed"), { status });
      },
      forget: async () => {
        forgotten = true;
      },
    };
    if (status === 401) assert.equal(await restoreAccount(session), null);
    else await assert.rejects(restoreAccount(session));
    assert.equal(forgotten, status === 401);
  }
});
