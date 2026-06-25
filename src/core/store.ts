/**
 * Durable task store backed by SQLite (node:sqlite, no external dependency).
 *
 * Holds every task and its event timeline so the board, CLI, MCP and Telegram
 * surfaces all read the same source of truth — and so progress survives a
 * server restart (unlike the previous in-memory-only sessions).
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Task,
  TaskEvent,
  TaskInput,
  TaskStatus,
  Schedule,
  ScheduleInput,
} from "./types.js";

let db: DatabaseSync | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  repo        TEXT,
  branch      TEXT,
  prompt      TEXT NOT NULL,
  model       TEXT,
  provider    TEXT,
  status      TEXT NOT NULL,
  base_sha    TEXT,
  head_sha    TEXT,
  diff        TEXT,
  pr_url      TEXT,
  preview_url TEXT,
  error       TEXT,
  created_at  INTEGER NOT NULL,
  started_at  INTEGER,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS task_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  type    TEXT NOT NULL,
  payload TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_events_task ON task_events (task_id, id);

CREATE TABLE IF NOT EXISTS schedules (
  id          TEXT PRIMARY KEY,
  prompt      TEXT NOT NULL,
  repo        TEXT,
  branch      TEXT,
  model       TEXT,
  provider    TEXT,
  spec        TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  next_run_at INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sched_due ON schedules (enabled, next_run_at);
`;

/** Open the database (idempotent) and ensure the schema exists. */
export function initStore(
  path = process.env.HIVE_DB_PATH || "data/hive.db"
): void {
  if (db) return;
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  // Migrations for stores created before these columns existed (idempotent).
  for (const col of ["head_sha TEXT", "preview_url TEXT"]) {
    try {
      db.exec(`ALTER TABLE tasks ADD COLUMN ${col}`);
    } catch {
      // column already exists
    }
  }
}

function getDb(): DatabaseSync {
  if (!db) initStore();
  return db!;
}

/** Close the database. Mainly used by tests. */
export function closeStore(): void {
  db?.close();
  db = null;
}

interface TaskRow {
  id: string;
  repo: string | null;
  branch: string | null;
  prompt: string;
  model: string | null;
  provider: string | null;
  status: string;
  base_sha: string | null;
  head_sha: string | null;
  diff: string | null;
  pr_url: string | null;
  preview_url: string | null;
  error: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    repo: row.repo,
    branch: row.branch,
    prompt: row.prompt,
    model: row.model,
    provider: row.provider,
    status: row.status as TaskStatus,
    baseSha: row.base_sha,
    headSha: row.head_sha,
    diff: row.diff,
    prUrl: row.pr_url,
    previewUrl: row.preview_url,
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

/** Insert a new task in the `queued` state and return it. */
export function createTask(input: TaskInput): Task {
  const task: Task = {
    id: randomUUID(),
    repo: input.repo ?? null,
    branch: input.branch ?? null,
    prompt: input.prompt,
    model: input.model ?? null,
    provider: input.provider ?? null,
    status: "queued",
    baseSha: null,
    headSha: null,
    diff: null,
    prUrl: null,
    previewUrl: null,
    error: null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
  };

  getDb()
    .prepare(
      `INSERT INTO tasks
        (id, repo, branch, prompt, model, provider, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      task.id,
      task.repo,
      task.branch,
      task.prompt,
      task.model,
      task.provider,
      task.status,
      task.createdAt
    );

  return task;
}

/** Columns that updateTask is allowed to write, mapped to camelCase patch keys. */
const UPDATABLE: Record<string, keyof Task> = {
  branch: "branch",
  model: "model",
  provider: "provider",
  status: "status",
  base_sha: "baseSha",
  head_sha: "headSha",
  diff: "diff",
  pr_url: "prUrl",
  preview_url: "previewUrl",
  error: "error",
  started_at: "startedAt",
  finished_at: "finishedAt",
};

/** Apply a partial update to a task and return the fresh row (or null). */
export function updateTask(id: string, patch: Partial<Task>): Task | null {
  const sets: string[] = [];
  const values: unknown[] = [];

  for (const [column, key] of Object.entries(UPDATABLE)) {
    if (key in patch) {
      sets.push(`${column} = ?`);
      values.push(patch[key] ?? null);
    }
  }

  if (sets.length) {
    values.push(id);
    getDb()
      .prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`)
      .run(...(values as (string | number | null)[]));
  }

  return getTask(id);
}

/** Fetch a single task by id. */
export function getTask(id: string): Task | null {
  const row = getDb()
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(id) as unknown as TaskRow | undefined;
  return row ? rowToTask(row) : null;
}

/** Fetch the most recent task whose pushed head commit matches a sha. */
export function getTaskByHeadSha(sha: string): Task | null {
  if (!sha) return null;
  const row = getDb()
    .prepare(
      "SELECT * FROM tasks WHERE head_sha = ? ORDER BY created_at DESC, rowid DESC LIMIT 1"
    )
    .get(sha) as unknown as TaskRow | undefined;
  return row ? rowToTask(row) : null;
}

/** List tasks, newest first, optionally filtered by status. */
export function listTasks(opts: { status?: TaskStatus; limit?: number } = {}): Task[] {
  const limit = opts.limit ?? 100;
  const rows = opts.status
    ? (getDb()
        .prepare(
          "SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC, rowid DESC LIMIT ?"
        )
        .all(opts.status, limit) as unknown as TaskRow[])
    : (getDb()
        .prepare("SELECT * FROM tasks ORDER BY created_at DESC, rowid DESC LIMIT ?")
        .all(limit) as unknown as TaskRow[]);
  return rows.map(rowToTask);
}

/** Append an event to a task's timeline. */
export function appendEvent(
  taskId: string,
  type: string,
  payload?: unknown
): TaskEvent {
  const ts = Date.now();
  const serialized = payload === undefined ? null : JSON.stringify(payload);
  const result = getDb()
    .prepare(
      "INSERT INTO task_events (task_id, ts, type, payload) VALUES (?, ?, ?, ?)"
    )
    .run(taskId, ts, type, serialized);
  return {
    id: Number(result.lastInsertRowid),
    taskId,
    ts,
    type,
    payload: payload ?? null,
  };
}

interface EventRow {
  id: number;
  task_id: string;
  ts: number;
  type: string;
  payload: string | null;
}

/** Read a task's events in order, optionally only those after a given id. */
export function getEvents(
  taskId: string,
  opts: { afterId?: number; limit?: number } = {}
): TaskEvent[] {
  const afterId = opts.afterId ?? 0;
  const limit = opts.limit ?? 1000;
  const rows = getDb()
    .prepare(
      "SELECT * FROM task_events WHERE task_id = ? AND id > ? ORDER BY id ASC LIMIT ?"
    )
    .all(taskId, afterId, limit) as unknown as EventRow[];
  return rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    ts: row.ts,
    type: row.type,
    payload: row.payload === null ? null : JSON.parse(row.payload),
  }));
}

// ── Schedules (recurring tasks) ──

interface ScheduleRow {
  id: string;
  prompt: string;
  repo: string | null;
  branch: string | null;
  model: string | null;
  provider: string | null;
  spec: string;
  enabled: number;
  last_run_at: number | null;
  next_run_at: number | null;
  created_at: number;
}

function rowToSchedule(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    prompt: row.prompt,
    repo: row.repo,
    branch: row.branch,
    model: row.model,
    provider: row.provider,
    spec: row.spec,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
  };
}

/** Create a schedule. nextRunAt is computed by the caller (scheduler). */
export function createSchedule(
  input: ScheduleInput & { nextRunAt: number | null }
): Schedule {
  const sched: Schedule = {
    id: randomUUID(),
    prompt: input.prompt,
    repo: input.repo ?? null,
    branch: input.branch ?? null,
    model: input.model ?? null,
    provider: input.provider ?? null,
    spec: input.spec,
    enabled: input.enabled ?? true,
    lastRunAt: null,
    nextRunAt: input.nextRunAt,
    createdAt: Date.now(),
  };
  getDb()
    .prepare(
      `INSERT INTO schedules
        (id, prompt, repo, branch, model, provider, spec, enabled, next_run_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      sched.id,
      sched.prompt,
      sched.repo,
      sched.branch,
      sched.model,
      sched.provider,
      sched.spec,
      sched.enabled ? 1 : 0,
      sched.nextRunAt,
      sched.createdAt
    );
  return sched;
}

const SCHED_UPDATABLE: Record<string, keyof Schedule> = {
  prompt: "prompt",
  repo: "repo",
  branch: "branch",
  model: "model",
  provider: "provider",
  spec: "spec",
  enabled: "enabled",
  last_run_at: "lastRunAt",
  next_run_at: "nextRunAt",
};

/** Apply a partial update to a schedule and return the fresh row (or null). */
export function updateSchedule(
  id: string,
  patch: Partial<Schedule>
): Schedule | null {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [column, key] of Object.entries(SCHED_UPDATABLE)) {
    if (key in patch) {
      sets.push(`${column} = ?`);
      const v = patch[key];
      values.push(key === "enabled" ? (v ? 1 : 0) : v ?? null);
    }
  }
  if (sets.length) {
    values.push(id);
    getDb()
      .prepare(`UPDATE schedules SET ${sets.join(", ")} WHERE id = ?`)
      .run(...(values as (string | number | null)[]));
  }
  return getSchedule(id);
}

/** Fetch a single schedule by id. */
export function getSchedule(id: string): Schedule | null {
  const row = getDb()
    .prepare("SELECT * FROM schedules WHERE id = ?")
    .get(id) as unknown as ScheduleRow | undefined;
  return row ? rowToSchedule(row) : null;
}

/** List all schedules, newest first. */
export function listSchedules(): Schedule[] {
  const rows = getDb()
    .prepare("SELECT * FROM schedules ORDER BY created_at DESC, rowid DESC")
    .all() as unknown as ScheduleRow[];
  return rows.map(rowToSchedule);
}

/** Delete a schedule. Returns true if a row was removed. */
export function deleteSchedule(id: string): boolean {
  const result = getDb().prepare("DELETE FROM schedules WHERE id = ?").run(id);
  return Number(result.changes) > 0;
}

/** Enabled schedules whose next run time is at or before `now`. */
export function dueSchedules(now: number): Schedule[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM schedules WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at ASC"
    )
    .all(now) as unknown as ScheduleRow[];
  return rows.map(rowToSchedule);
}
