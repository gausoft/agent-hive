import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNewArgs } from "../cli/hive.js";

test("parseNewArgs splits flags from the free-text prompt", () => {
  assert.deepEqual(
    parseNewArgs(["--repo", "owner/repo", "add", "a", "healthcheck"]),
    { flags: { repo: "owner/repo" }, prompt: "add a healthcheck" }
  );
  assert.deepEqual(
    parseNewArgs(["fix", "--model", "deepseek-chat", "the", "bug"]),
    { flags: { model: "deepseek-chat" }, prompt: "fix the bug" }
  );
  assert.deepEqual(parseNewArgs(["just", "a", "prompt"]), {
    flags: {},
    prompt: "just a prompt",
  });
  // A trailing flag with no value resolves to an empty string, not a crash.
  assert.deepEqual(parseNewArgs(["do", "it", "--branch"]), {
    flags: { branch: "" },
    prompt: "do it",
  });
});
