import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureDiff } from "../core/runner.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

test("captureDiff returns the working-tree diff since the base commit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hive-diff-"));
  try {
    git(dir, "init", "-q");
    git(dir, "config", "user.email", "t@t.dev");
    git(dir, "config", "user.name", "t");
    writeFileSync(join(dir, "file.txt"), "one\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "base");
    const baseSha = git(dir, "rev-parse", "HEAD");

    // Agent-like change (uncommitted)
    writeFileSync(join(dir, "file.txt"), "one\ntwo\n");

    const diff = await captureDiff(dir, baseSha);
    assert.match(diff, /\+two/);
    assert.match(diff, /file\.txt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("captureDiff returns empty string when there is no base sha", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hive-diff-"));
  try {
    git(dir, "init", "-q");
    assert.equal(await captureDiff(dir, ""), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
