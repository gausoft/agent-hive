import { test } from "node:test";
import assert from "node:assert/strict";
import { validateToken, hasAnyToken, resetTokenCache } from "../auth.js";

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  resetTokenCache();
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    resetTokenCache();
  }
}

test("single API_TOKEN resolves to an admin profile", () => {
  withEnv({ API_TOKEN: "secret", API_TOKENS: undefined }, () => {
    assert.equal(hasAnyToken(), true);
    assert.deepEqual(validateToken("secret"), { name: "Admin", role: "admin" });
    assert.equal(validateToken("wrong"), null);
    assert.equal(validateToken(undefined), null);
  });
});

test("API_TOKENS map takes precedence and carries roles", () => {
  withEnv(
    {
      API_TOKEN: "ignored",
      API_TOKENS: JSON.stringify({
        adm: { name: "Admin", role: "admin" },
        bob: { name: "Bob" },
      }),
    },
    () => {
      assert.deepEqual(validateToken("adm"), { name: "Admin", role: "admin" });
      // Missing role defaults to "user"
      assert.deepEqual(validateToken("bob"), { name: "Bob", role: "user" });
      // Single token is ignored when the map is present
      assert.equal(validateToken("ignored"), null);
    }
  );
});

test("malformed API_TOKENS falls back to single API_TOKEN", () => {
  withEnv({ API_TOKEN: "fallback", API_TOKENS: "{not json" }, () => {
    assert.deepEqual(validateToken("fallback"), { name: "Admin", role: "admin" });
  });
});

test("no tokens configured means nothing validates", () => {
  withEnv({ API_TOKEN: undefined, API_TOKENS: undefined }, () => {
    assert.equal(hasAnyToken(), false);
    assert.equal(validateToken("anything"), null);
  });
});
