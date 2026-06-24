/**
 * Recurring task scheduler — the durable replacement for a separate cron/prq
 * tool. A schedule dispatches a normal task on a recurrence, so the work flows
 * through the same store, board, and PR pipeline as any other task.
 *
 * Recurrence is deliberately a tiny subset, not full cron:
 *   "@every <n>(s|m|h|d)"  e.g. "@every 6h", "@every 30m"
 *   "@daily HH:MM"         local time, e.g. "@daily 09:00"
 */

import { createTask, dueSchedules, updateSchedule } from "./store.js";
import { runTask } from "./runner.js";

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Compute the next run time after `from`, or null if the spec is invalid. */
export function nextRun(spec: string, from: Date): Date | null {
  const s = spec.trim();

  const every = s.match(/^@every\s+(\d+)\s*(s|m|h|d)$/i);
  if (every) {
    const n = parseInt(every[1], 10);
    if (n <= 0) return null;
    return new Date(from.getTime() + n * UNIT_MS[every[2].toLowerCase()]);
  }

  const daily = s.match(/^@daily\s+(\d{1,2}):(\d{2})$/);
  if (daily) {
    const hh = parseInt(daily[1], 10);
    const mm = parseInt(daily[2], 10);
    if (hh > 23 || mm > 59) return null;
    const next = new Date(from);
    next.setHours(hh, mm, 0, 0);
    if (next.getTime() <= from.getTime()) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  return null;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Dispatch every schedule that is currently due, and reschedule it. */
export function tickScheduler(now = Date.now()): number {
  const due = dueSchedules(now);
  for (const sched of due) {
    const task = createTask({
      prompt: sched.prompt,
      repo: sched.repo,
      branch: sched.branch,
      model: sched.model,
      provider: sched.provider,
    });
    void runTask(task.id);
    const next = nextRun(sched.spec, new Date(now));
    updateSchedule(sched.id, {
      lastRunAt: now,
      nextRunAt: next ? next.getTime() : null,
      // An unparseable spec disables the schedule rather than looping hot.
      enabled: next !== null,
    });
  }
  return due.length;
}

/** Start the minute-resolution scheduler loop (idempotent). */
export function startScheduler(): void {
  if (timer) return;
  tickScheduler();
  timer = setInterval(() => tickScheduler(), 60_000);
}

/** Stop the scheduler loop. Mainly used by tests. */
export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
