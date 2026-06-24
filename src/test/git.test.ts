import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractPrUrl,
  taskBranchName,
  commitAll,
  commitsSince,
  createBranch,
} from "../core/git.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

test("taskBranchName is deterministic and short", () => {
  assert.equal(taskBranchName("abcdef12-3456-7890"), "hive/task-abcdef12");
});

test("extractPrUrl picks the last URL from gh output", () => {
  const out = [
    "Warning: 1 uncommitted change",
    "Creating pull request for hive/task-abc into main in octo/repo",
    "",
    "https://github.com/octo/repo/pull/42",
  ].join("\n");
  assert.equal(extractPrUrl(out), "https://github.com/octo/repo/pull/42");
  assert.equal(extractPrUrl("no url here"), "");
});

test("commitAll commits only when there are changes; commitsSince counts them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hive-git-"));
  try {
    git(dir, "init", "-q");
    git(dir, "config", "user.email", "t@t.dev");
    git(dir, "config", "user.name", "t");
    writeFileSync(join(dir, "a.txt"), "1\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "base");
    const baseSha = git(dir, "rev-parse", "HEAD");

    await createBranch(dir, taskBranchName("deadbeef-0000"));

    // Nothing changed yet
    assert.equal(await commitAll(dir, "noop"), false);
    assert.equal(await commitsSince(dir, baseSha), 0);

    // A real change
    writeFileSync(join(dir, "a.txt"), "1\n2\n");
    assert.equal(await commitAll(dir, "agent change"), true);
    assert.equal(await commitsSince(dir, baseSha), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
