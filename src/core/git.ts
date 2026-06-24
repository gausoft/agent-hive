/**
 * Git + GitHub helpers for the task lifecycle: isolate work on a per-task
 * branch, commit any leftover changes, push, and open a pull request.
 *
 * Pushing and PR creation require write access on the origin (deploy key or the
 * authenticated gh account) — they are best-effort and surfaced as task events.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GH_BIN = process.env.GH_BIN || "gh";

/** Deterministic work-branch name for a task. */
export function taskBranchName(taskId: string): string {
  return "hive/task-" + taskId.slice(0, 8);
}

/** Create and check out a new branch. */
export async function createBranch(
  repoDir: string,
  branch: string
): Promise<void> {
  await execFileAsync("git", ["checkout", "-b", branch], {
    cwd: repoDir,
    timeout: 10000,
  });
}

/** Stage everything and commit if there is anything to commit. */
export async function commitAll(
  repoDir: string,
  message: string
): Promise<boolean> {
  await execFileAsync("git", ["add", "-A"], { cwd: repoDir, timeout: 10000 });
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
    cwd: repoDir,
    timeout: 10000,
  });
  if (!stdout.trim()) return false;
  await execFileAsync("git", ["commit", "-m", message], {
    cwd: repoDir,
    timeout: 15000,
  });
  return true;
}

/** Number of commits on the current branch ahead of the base commit. */
export async function commitsSince(
  repoDir: string,
  baseSha: string
): Promise<number> {
  const range = baseSha ? [baseSha + "..HEAD"] : ["HEAD"];
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-list", "--count", ...range],
      { cwd: repoDir, timeout: 10000 }
    );
    return parseInt(stdout.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

/** Push a branch to origin and set its upstream. */
export async function pushBranch(
  repoDir: string,
  branch: string
): Promise<void> {
  await execFileAsync("git", ["push", "-u", "origin", branch], {
    cwd: repoDir,
    timeout: 30000,
  });
}

/** Extract the PR URL from `gh pr create` output (last URL printed). */
export function extractPrUrl(stdout: string): string {
  const matches = stdout.match(/https?:\/\/\S+/g);
  return matches ? matches[matches.length - 1] : "";
}

/** Open a pull request for the current branch; returns the PR URL (or ""). */
export async function openPullRequest(
  repoDir: string,
  opts: { base?: string; title?: string; body?: string } = {}
): Promise<string> {
  const args = ["pr", "create", "--fill"];
  if (opts.base) args.push("--base", opts.base);
  if (opts.title) args.push("--title", opts.title);
  if (opts.body) args.push("--body", opts.body);
  const { stdout } = await execFileAsync(GH_BIN, args, {
    cwd: repoDir,
    env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
  return extractPrUrl(stdout);
}
