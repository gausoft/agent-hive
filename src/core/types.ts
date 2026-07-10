/** Core domain types for tasks and their event log. */

export type TaskStatus =
  | "queued"
  | "running"
  | "review"
  | "verifying"
  | "done"
  | "failed"
  | "aborted";

export interface Task {
  id: string;
  repo: string | null;
  branch: string | null;
  prompt: string;
  model: string | null;
  provider: string | null;
  status: TaskStatus;
  baseSha: string | null;
  /** SHA of the pushed work commit — matches deploy-platform webhooks. */
  headSha: string | null;
  diff: string | null;
  prUrl: string | null;
  /** Preview URL published by the deploy platform for the PR/commit (if any). */
  previewUrl: string | null;
  error: string | null;
  /** Shell command whose exit code objectively verifies the work (e.g. "npm test"). */
  verifyCommand: string | null;
  /** Max maker→verifier iterations before giving up (default 1 = no retry). */
  maxIterations: number;
  /** Iterations actually consumed. */
  iterations: number;
  /** Final verdict: "pass" | "fail" | null (not verified). */
  verdict: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface TaskInput {
  repo?: string | null;
  branch?: string | null;
  prompt: string;
  model?: string | null;
  provider?: string | null;
  verifyCommand?: string | null;
  maxIterations?: number;
}

/** A single recorded event in a task's timeline (durable, survives restarts). */
export interface TaskEvent {
  id: number;
  taskId: string;
  ts: number;
  type: string;
  payload: unknown;
}

/** A recurring task definition (replaces a separate cron/prq tool). */
export interface Schedule {
  id: string;
  prompt: string;
  repo: string | null;
  branch: string | null;
  model: string | null;
  provider: string | null;
  /** Recurrence spec: "@every <n>(s|m|h|d)" or "@daily HH:MM" (local time). */
  spec: string;
  enabled: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  createdAt: number;
}

export interface ScheduleInput {
  prompt: string;
  spec: string;
  repo?: string | null;
  branch?: string | null;
  model?: string | null;
  provider?: string | null;
  enabled?: boolean;
}
