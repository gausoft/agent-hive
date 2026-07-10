import { test } from "node:test";
import assert from "node:assert";
import { verifyTask } from "../loops/verify.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("verifyCommand pass → verdict pass", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hive-verify-"));
  const res = await verifyTask({
    repoDir: dir,
    taskPrompt: "anything",
    diff: "some diff",
    verifyCommand: "exit 0",
    provider: "anthropic",
  });
  assert.equal(res.verdict, "pass");
  assert.equal(res.method, "command");
});

test("verifyCommand fail → verdict fail with output feedback", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hive-verify-"));
  const res = await verifyTask({
    repoDir: dir,
    taskPrompt: "anything",
    diff: "some diff",
    verifyCommand: "echo BROKEN_TEST >&2; exit 1",
    provider: "anthropic",
  });
  assert.equal(res.verdict, "fail");
  assert.match(res.feedback, /BROKEN_TEST/);
});

test("empty diff without command → fail (nothing produced)", async () => {
  const res = await verifyTask({
    repoDir: "/tmp",
    taskPrompt: "anything",
    diff: "",
    verifyCommand: null,
    provider: "anthropic",
  });
  assert.equal(res.verdict, "fail");
});
