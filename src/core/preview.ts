/**
 * Preview-URL pipeline (platform-agnostic).
 *
 * The deploy platform (Vercel, Netlify, Railway, Render, Fly, Coolify, or any
 * setup that calls the GitHub Deployments API) publishes the preview URL of a
 * PR/commit through the standard GitHub signal: a `deployment_status` with
 * `state=success` and the URL in `environment_url` (fallback `target_url`).
 * Netlify only updates the commit `status`, so we read that too.
 *
 * One core, two triggers: a webhook (instant) and a bounded poll (zero-config
 * fallback). Both funnel through `recordPreview`, the single sink that stores
 * the URL on the matching task and emits the milestone.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getTask, getTaskByHeadSha, updateTask } from "./store.js";
import { recordEvent } from "./bus.js";

const execFileAsync = promisify(execFile);
const GH_BIN = process.env.GH_BIN || "gh";

// Polling fallback is on by default (uses gh, already a dependency). Set
// HIVE_PREVIEW=0 to disable. The webhook works regardless when configured.
const POLL_ENABLED = process.env.HIVE_PREVIEW !== "0";
const POLL_INTERVAL_MS = parseInt(process.env.HIVE_PREVIEW_INTERVAL_MS || "15000", 10);
const POLL_TIMEOUT_MS = parseInt(process.env.HIVE_PREVIEW_TIMEOUT_MS || "600000", 10);

// ── Pure helpers (unit-tested, no I/O) ───────────────────────────────────────

/** Normalize a repo spec (slug, https, or ssh URL) to "owner/repo". */
export function repoSlug(repo: string): string | null {
  if (!repo) return null;
  const s = repo.trim().replace(/\.git$/, "");
  const m = s.match(/github\.com[/:]([^/]+\/[^/]+)/);
  if (m) return m[1];
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) return s;
  return null;
}

interface StatusLike {
  state?: string;
  environment?: string | { name?: string };
  environment_url?: string;
  target_url?: string | null;
  context?: string;
}

function envName(s: StatusLike): string {
  const e = s.environment;
  return (typeof e === "string" ? e : e?.name) || "";
}

/** True for a successful, non-production deployment/status that carries a URL. */
function isUsablePreview(s: StatusLike): boolean {
  if (s.state && s.state !== "success") return false;
  if (/prod/i.test(envName(s))) return false;
  return Boolean(s.environment_url || s.target_url);
}

/** Pick the preview URL from a single status object (or null). */
export function previewUrlOf(s: StatusLike): string | null {
  if (!isUsablePreview(s)) return null;
  return s.environment_url || s.target_url || null;
}

/** Pick a preview URL from a list of statuses (first usable one). */
export function pickPreviewUrl(statuses: StatusLike[]): string | null {
  for (const s of statuses) {
    const url = previewUrlOf(s);
    if (url) return url;
  }
  return null;
}

// ── The single sink ──────────────────────────────────────────────────────────

/** Store the preview URL on the task (once) and emit the milestone. Idempotent. */
export function recordPreview(taskId: string, url: string): boolean {
  const task = getTask(taskId);
  if (!task || task.previewUrl) return false; // unknown or already set
  updateTask(taskId, { previewUrl: url });
  recordEvent(taskId, "preview", { url });
  return true;
}

// ── Trigger 1: webhook ───────────────────────────────────────────────────────

/**
 * Handle a GitHub `deployment_status` or `status` webhook: extract the preview
 * URL, find the task by its pushed head sha, and record it. Returns true if a
 * task was updated.
 */
export function handleWebhookEvent(event: string, payload: any): boolean {
  if (!payload) return false;

  let status: StatusLike | null = null;
  let sha: string | undefined;

  if (event === "deployment_status") {
    status = payload.deployment_status || null;
    sha = payload.deployment?.sha;
    if (status && status.environment === undefined) {
      status = { ...status, environment: payload.deployment?.environment };
    }
  } else if (event === "status") {
    status = payload; // commit-status payload is itself the status (Netlify)
    sha = payload.sha;
  } else {
    return false;
  }

  if (!status || !sha) return false;
  const url = previewUrlOf(status);
  if (!url) return false;

  const slug = repoSlug(payload.repository?.full_name || "");
  const task = getTaskByHeadSha(sha);
  if (!task) return false;
  if (slug && task.repo && repoSlug(task.repo) !== slug) return false;

  return recordPreview(task.id, url);
}

// ── Trigger 2: bounded polling fallback ──────────────────────────────────────

async function gh<T>(path: string): Promise<T | null> {
  try {
    const { stdout } = await execFileAsync(GH_BIN, ["api", path], {
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    });
    return JSON.parse(stdout) as T;
  } catch {
    return null;
  }
}

/** Query the platform-published preview URL for a pushed commit (one shot). */
export async function findPreviewUrl(
  repo: string,
  sha: string
): Promise<string | null> {
  const slug = repoSlug(repo);
  if (!slug || !sha) return null;

  const deployments = await gh<{ id: number }[]>(
    `repos/${slug}/deployments?sha=${sha}`
  );
  if (Array.isArray(deployments)) {
    for (const d of deployments) {
      const statuses = await gh<StatusLike[]>(
        `repos/${slug}/deployments/${d.id}/statuses`
      );
      const url = Array.isArray(statuses) ? pickPreviewUrl(statuses) : null;
      if (url) return url;
    }
  }

  // Netlify and other commit-status-only platforms.
  const combined = await gh<{ statuses: StatusLike[] }>(
    `repos/${slug}/commits/${sha}/status`
  );
  if (combined?.statuses) {
    const url = pickPreviewUrl(combined.statuses);
    if (url) return url;
  }
  return null;
}

/**
 * Poll for the preview URL after a PR is pushed; record it when found. Stops
 * early if the URL appears (webhook may beat us — `recordPreview` is idempotent
 * and we re-check the task each tick). Fire-and-forget; never throws.
 */
export function watchPreview(taskId: string, repo: string | null, sha: string): void {
  if (!POLL_ENABLED || !repo || !sha) return;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  const tick = async () => {
    const task = getTask(taskId);
    if (!task || task.previewUrl) return; // webhook already set it, or gone
    const url = await findPreviewUrl(repo, sha).catch(() => null);
    if (url) {
      recordPreview(taskId, url);
      return;
    }
    if (Date.now() < deadline) setTimeout(tick, POLL_INTERVAL_MS).unref();
  };

  setTimeout(tick, POLL_INTERVAL_MS).unref();
}
