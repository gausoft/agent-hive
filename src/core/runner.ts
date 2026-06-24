/**
 * Task runner: the autonomous lifecycle of a single task.
 *
 * Unlike the previous fire-and-forget IIFE in routes/prompt.ts, the runner
 * persists progress to the durable store *before* cleaning up the workspace,
 * so the board / CLI / Telegram can follow a task — and replay it after a
 * restart. It also fans out every pi event to an in-process bus keyed by task
 * id, so surfaces can stream live without polling.
 *
 * State machine: queued -> running -> [review] -> done | failed.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve, basename } from "node:path";
import { rmSync } from "node:fs";
import { EventEmitter } from "node:events";
import { createManagedSession } from "../sessions/manager.js";
import { resolveProvider } from "./providers.js";
import { runCodeReview } from "../loops/review.js";
import { appendEvent, getTask, updateTask } from "./store.js";

const execFileAsync = promisify(execFile);
const WORKSPACE = resolve(process.env.WORKSPACE || "/tmp/hive-workspace");
const KEEP_WORKSPACE = process.env.HIVE_KEEP_WORKSPACE === "1";

export const DEFAULT_SYSTEM_PROMPT =
  process.env.HIVE_SYSTEM_PROMPT ||
  "You are a senior software developer. Be direct and concise, show code, skip filler. Don't gold-plate, but don't leave it half-done. Be thorough: check multiple locations, consider naming conventions. Flag risks, don't over-explain the obvious. If unsure, say so. Prefer established patterns.";

export interface RunOptions {
  systemPromptOverride?: string;
  thinkingLevel?: string;
  reviewCycles?: number;
  reviewModel?: string;
}

// ── Live event bus (in-process), keyed by task id ──────────────────────────

const bus = new EventEmitter();
bus.setMaxListeners(0);

/** Subscribe to a task's live event stream. Returns an unsubscribe function. */
export function subscribeTask(
  taskId: string,
  listener: (event: unknown) => void
): () => void {
  bus.on(taskId, listener);
  return () => bus.off(taskId, listener);
}

/** Persist a milestone event and broadcast it live. */
function record(taskId: string, type: string, payload?: unknown): void {
  const event = appendEvent(taskId, type, payload);
  bus.emit(taskId, event);
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

    // Persist non-delta events (milestones, tool calls, final messages) and
    // broadcast everything live. Streaming text deltas are emitted live only,
    // to avoid flooding the store with per-token rows.
    const unsubscribe = managed.session.subscribe((event: any) => {
      bus.emit(taskId, event);
      const isDelta =
        event.type === "message_update" &&
        event.assistantMessageEvent?.type === "text_delta";
      if (!isDelta) appendEvent(taskId, event.type || "event", event);
    });

    const systemPrompt = opts.systemPromptOverride || DEFAULT_SYSTEM_PROMPT;
    const prefix = repoDir
      ? "The repo is at " +
        repoDir +
        ". Read AGENTS.md for project context. Work in that directory. Read files, make changes, commit and push when done.\n\n"
      : "";
    const fullPrompt = systemPrompt + "\n\n" + prefix + task.prompt;

    try {
      await managed.session.prompt(fullPrompt);
    } finally {
      unsubscribe();
    }

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

    // NOTE: PR creation hook lands in step 4 (core/git.ts).

    updateTask(taskId, { status: "done", finishedAt: Date.now() });
    record(taskId, "status", { status: "done" });
  } catch (err: any) {
    updateTask(taskId, {
      status: "failed",
      error: err?.message || String(err),
      finishedAt: Date.now(),
    });
    record(taskId, "error", { message: err?.message || String(err) });
  } finally {
    if (repoDir && !KEEP_WORKSPACE) {
      try {
        rmSync(cleanupRoot, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  }
}
