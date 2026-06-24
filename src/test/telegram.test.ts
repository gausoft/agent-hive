import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNewCommand, formatMilestone } from "../telegram/bot.js";

test("parseNewCommand extracts an optional repo then the prompt", () => {
  assert.deepEqual(parseNewCommand("/new fix the login bug"), {
    prompt: "fix the login bug",
  });
  assert.deepEqual(parseNewCommand("/new owner/repo add a healthcheck"), {
    repo: "owner/repo",
    prompt: "add a healthcheck",
  });
  assert.deepEqual(
    parseNewCommand("/new https://github.com/o/r refactor utils"),
    { repo: "https://github.com/o/r", prompt: "refactor utils" }
  );
  // A bare repo with no prompt is treated as a prompt, not a repo.
  assert.deepEqual(parseNewCommand("/new owner/repo"), {
    prompt: "owner/repo",
  });
  assert.equal(parseNewCommand("/new   "), null);
});

test("parseNewCommand tolerates the @botname suffix", () => {
  assert.deepEqual(parseNewCommand("/new@hivebot ship it"), {
    prompt: "ship it",
  });
});

test("formatMilestone renders known events and skips noise", () => {
  assert.equal(
    formatMilestone({ type: "pr", payload: { url: "https://x/pull/1" } }),
    "✅ PR opened: https://x/pull/1"
  );
  assert.equal(
    formatMilestone({ type: "error", payload: { message: "boom" } }),
    "❌ Task failed: boom"
  );
  assert.equal(formatMilestone({ type: "status", payload: { status: "done" } }), "🏁 Done");
  // running/aborted handled; an unknown status or type yields null.
  assert.equal(formatMilestone({ type: "status", payload: { status: "queued" } }), null);
  assert.equal(formatMilestone({ type: "session", payload: {} }), null);
});
