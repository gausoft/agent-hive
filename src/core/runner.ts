/**
 * Task runner: the autonomous lifecycle of a single task.
 *
 * Unlike the previous fire-and-forget IIFE in routes/prompt.ts, the runner
 * persists progress to the durable store *before* cleaning up the workspace,
 * so the board / CLI / Telegram can follow a task — and replay it after a
 * restart. It also fans out every pi event to an in-process bus keyed by task
 * id, so surfaces can stream live without polling.
 *
 * State machine: queued -> running -> [review] -> [verifying] -> done | failed.
 * When a task has maxIterations > 1, a failed verification feeds the verifier's
 * feedback back to the maker session and re-runs — the maker is never the grader.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve, basename } from "node:path";
import { rmSync } from "node:fs";
import { createManagedSession, getSession } from "../sessions/manager.js";
import { resolveProvider } from "./providers.js";
import { runCodeReview } from "../loops/review.js";
import { verifyTask } from "../loops/verify.js";
import {
  taskBranchName,
  createBranch,
  commitAll,
  commitsSince,
  currentSha,
  pushBranch,
  openPullRequest,
} from "./git.js";
import { appendEvent, getTask, updateTask } from "./store.js";
import { recordEvent, emitTaskEvent, subscribeTask } from "./bus.js";
import { watchPreview } from "./preview.js";

const execFileAsync = promisify(execFile);
const WORKSPACE = resolve(process.env.WORKSPACE || "/tmp/hive-workspace");
const KEEP_WORKSPACE = process.env.HIVE_KEEP_WORKSPACE === "1";
// Open a PR with the work by default; set HIVE_OPEN_PR=0 to let the agent push freely.
const OPEN_PR = process.env.HIVE_OPEN_PR !== "0";

export const DEFAULT_SYSTEM_PROMPT =
  process.env.HIVE_SYSTEM_PROMPT ||
  "You are a senior software developer. Be direct and concise, show code, skip filler. Don't gold-plate, but don't leave it half-done. Be thorough: check multiple locations, consider naming conventions. Flag risks, don't over-explain the obvious. If unsure, say so. Prefer established patterns.";

export interface RunOptions {
  systemPromptOverride?: string;
  thinkingLevel?: string;
  reviewCycles?: number;
  reviewModel?: string;
}

// ── Live event bus (shared module, keyed by task id) ───────────────────────

// Re-exported for back-compat (core/index.ts, routes/tasks.ts import it here).
export { subscribeTask };

/** Persist a milestone event and broadcast it live. */
function record(taskId: string, type: string, payload?: unknown): void {
  recordEvent(taskId, type, payload);
}

// Live mapping from task id to its pi session id, plus tasks being aborted.
const taskSessions = new Map<string, string>();
const aborting = new Set<string>();

/**
 * Abort a running (or reviewing) task. Returns false if the task is not in an
 * abortable state. The terminal `aborted` status is set by runTask's catch.
 */
export async function abortTask(taskId: string): Promise<boolean> {
  const task = getTask(taskId);
  if (!task || (task.status !== "running" && task.status !== "review" && task.status !== "verifying")) {
    return false;
  }
  aborting.add(taskId);
  const sessionId = taskSessions.get(taskId);
  if (sessionId) {
    const managed = getSession(sessionId);
    if (managed) {
      try {
        await managed.session.abort();
      } catch {
        // best effort
      }
    }
  }
  return true;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function safeName(name: string): string {
  const base = basename(name);
  if (base !== name || base.includes("..") || base.includes("/")) {
    throw new Error("Invalid name: " + name);
  }
  return base;
}

function toSshUrl(repoUrl: string): string {
  const match = repoUrl.match(/https?:\/\/github\.com\/([^/]+\/[^/]+)/);
  if (match) {
    let path = match[1];
    if (!path.endsWith(".git")) path += ".git";
    return "git@github.com:" + path;
  }
  return repoUrl;
}

/**
 * Capture the diff produced by the task. `git diff <baseSha>` compares the
 * pre-task commit against the working tree, so it covers both committed and
 * uncommitted changes the agent made.
 */
export async function captureDiff(
  repoDir: string,
  baseSha: string
): Promise<string> {
  if (!baseSha) return "";
  try {
    const { stdout } = await execFileAsync("git", ["diff", baseSha], {
      cwd: repoDir,
      timeout: 15000,
      maxBuffer: 5 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return "";
  }
}

async function cloneRepo(taskId: string, repo: string, branch: string | null) {
  const repoName = safeName(repo.replace(/\.git$/, "").split("/").pop() || repo);
  const repoDir = join(WORKSPACE, taskId, repoName);
  const sshUrl = toSshUrl(repo);
  const cloneArgs = ["clone", "--depth", "1"];
  if (branch) cloneArgs.push("--branch", branch);
  cloneArgs.push(sshUrl, repoDir);
  await execFileAsync("git", cloneArgs, {
    timeout: 60000,
    maxBuffer: 1024 * 1024,
  });

  // Commit identity (override via GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL)
  const name = process.env.GIT_AUTHOR_NAME || "agent-hive";
  const email =
    process.env.GIT_AUTHOR_EMAIL || "agent-hive@users.noreply.github.com";
  await execFileAsync("git", ["config", "user.name", name], { cwd: repoDir });
  await execFileAsync("git", ["config", "user.email", email], { cwd: repoDir });

  // Pre-task SHA for diff-based review and final diff capture
  let baseSha = "";
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: repoDir,
      timeout: 5000,
    });
    baseSha = stdout.trim();
  } catch {
    // Fresh repo with no commits — baseSha stays empty.
  }

  return { repoDir, baseSha };
}

// ── The lifecycle ───────────────────────────────────────────────────────────

/**
 * Run a previously created (`queued`) task to completion, persisting progress.
 * Resolves when the task reaches a terminal state; never throws (failures are
 * recorded on the task).
 */
export async function runTask(taskId: string, opts: RunOptions = {}): Promise<void> {
  const task = getTask(taskId);
  if (!task) throw new Error("Task not found: " + taskId);

  updateTask(taskId, { status: "running", startedAt: Date.now() });
  record(taskId, "status", { status: "running" });

  const cleanupRoot = join(WORKSPACE, taskId);
  let repoDir = "";
  let baseSha = "";

  try {
    if (task.repo) {
      const cloned = await cloneRepo(taskId, task.repo, task.branch);
      repoDir = cloned.repoDir;
      baseSha = cloned.baseSha;
      updateTask(taskId, { baseSha: baseSha || null });
      record(taskId, "cloned", { repo: task.repo, branch: task.branch });

      // Isolate the work on a dedicated branch when we are going to open a PR.
      if (OPEN_PR) {
        const workBranch = taskBranchName(taskId);
        await createBranch(repoDir, workBranch);
        record(taskId, "branch", { branch: workBranch, base: task.branch });
      }
    }

    const managed = await createManagedSession({
      provider: task.provider ?? undefined,
      model: task.model ?? undefined,
      thinkingLevel: opts.thinkingLevel,
      cwd: repoDir || undefined,
    });
    record(taskId, "session", {
      sessionId: managed.sessionId,
      model: managed.session.model?.id,
    });
    taskSessions.set(taskId, managed.sessionId);

    // Persist non-delta events (milestones, tool calls, final messages) and
    // broadcast everything live. Streaming text deltas are emitted live only,
    // to avoid flooding the store with per-token rows.
    const unsubscribe = managed.session.subscribe((event: any) => {
      emitTaskEvent(taskId, event);
      const isDelta =
        event.type === "message_update" &&
        event.assistantMessageEvent?.type === "text_delta";
      if (!isDelta) appendEvent(taskId, event.type || "event", event);
    });

    const systemPrompt = opts.systemPromptOverride || DEFAULT_SYSTEM_PROMPT;
    const repoInstruction = OPEN_PR
      ? "Read files, make changes, and commit when done. Do not push or open a PR \u2014 that is handled for you."
      : "Read files, make changes, commit and push when done.";
    const prefix = repoDir
      ? "The repo is at " +
        repoDir +
        ". Read AGENTS.md for project context. Work in that directory. " +
        repoInstruction +
        "\n\n"
      : "";
    const fullPrompt = systemPrompt + "\n\n" + prefix + task.prompt;

    // ── Maker → verifier loop ──
    // Iteration 1 runs the task prompt; on a failed verification, subsequent
    // iterations re-prompt the SAME maker session with the verifier's feedback.
    const maxIterations = Math.max(1, task.maxIterations ?? 1);
    let iteration = 0;
    let prompt = fullPrompt;

    for (;;) {
      iteration++;
      updateTask(taskId, { iterations: iteration });

      try {
        await managed.session.prompt(prompt);
      } catch (err) {
        unsubscribe();
        throw err;
      }

      // Verification requires a repo diff to judge; snippet tasks skip the loop.
      if (!repoDir || !baseSha) break;

      updateTask(taskId, { status: "verifying" });
      record(taskId, "status", { status: "verifying" });

      const iterDiff = await captureDiff(repoDir, baseSha);
      const result = await verifyTask({
        repoDir,
        taskPrompt: task.prompt,
        diff: iterDiff,
        verifyCommand: task.verifyCommand,
        provider: resolveProvider(task.provider ?? undefined),
        reviewModel: opts.reviewModel,
      });
      updateTask(taskId, { verdict: result.verdict });
      record(taskId, "verify", { iteration, ...result });

      if (result.verdict === "pass") break;
      if (iteration >= maxIterations) {
        unsubscribe();
        throw new Error(
          `Verification failed after ${iteration} iteration(s): ${result.feedback.slice(0, 500)}`
        );
      }

      updateTask(taskId, { status: "running" });
      record(taskId, "status", { status: "running", iteration: iteration + 1 });
      prompt =
        "An independent verifier reviewed your work and FAILED it. Fix the problems below, " +
        "then commit your fixes.\n\nVerifier feedback:\n" +
        result.feedback;
    }

    unsubscribe();

    // Optional diff-based review cycles (repos with a base commit only)
    const reviewCycles = opts.reviewCycles ?? 0;
    if (reviewCycles > 0 && repoDir && baseSha) {
      updateTask(taskId, { status: "review" });
      record(taskId, "status", { status: "review" });
      const provider = resolveProvider(task.provider ?? undefined);
      const result = await runCodeReview(repoDir, baseSha, {
        cycles: reviewCycles,
        provider,
        reviewModel: opts.reviewModel,
        mainModel: task.model ?? undefined,
      });
      record(taskId, "review", result);
    }

    // Capture the diff BEFORE cleanup so it survives in the store.
    if (repoDir) {
      const diff = await captureDiff(repoDir, baseSha);
      if (diff) updateTask(taskId, { diff });
    }

    // Push the work and open a pull request.
    if (repoDir && OPEN_PR) {
      try {
        const workBranch = taskBranchName(taskId);
        await commitAll(repoDir, "agent-hive: " + task.prompt.slice(0, 60));
        const ahead = await commitsSince(repoDir, baseSha);
        if (ahead > 0) {
          await pushBranch(repoDir, workBranch);
          const url = await openPullRequest(repoDir, {
            base: task.branch ?? undefined,
          });
          if (url) {
            updateTask(taskId, { prUrl: url });
            record(taskId, "pr", { url });
            // Match deploy-platform webhooks to this task by its head sha, and
            // poll as a zero-config fallback for the published preview URL.
            const headSha = await currentSha(repoDir);
            if (headSha) updateTask(taskId, { headSha });
            watchPreview(taskId, task.repo, headSha);
          }
        } else {
          record(taskId, "no_changes", {});
        }
      } catch (prErr: any) {
        // PR failures must not fail the task itself.
        record(taskId, "pr_error", { message: prErr?.message || String(prErr) });
      }
    }

    updateTask(taskId, { status: "done", finishedAt: Date.now() });
    record(taskId, "status", { status: "done" });
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (aborting.has(taskId)) {
      updateTask(taskId, { status: "aborted", finishedAt: Date.now() });
      record(taskId, "status", { status: "aborted" });
    } else {
      updateTask(taskId, { status: "failed", error: msg, finishedAt: Date.now() });
      record(taskId, "error", { message: msg });
    }
  } finally {
    aborting.delete(taskId);
    taskSessions.delete(taskId);
    if (repoDir && !KEEP_WORKSPACE) {
      try {
        rmSync(cleanupRoot, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  }
}
