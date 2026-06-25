/**
 * In-process event bus, keyed by task id. Surfaces (board WS, Telegram, CLI)
 * subscribe here to follow a task live; the runner and the preview pipeline
 * publish to it. Kept in its own module so the runner and preview can both
 * publish without importing each other (no circular import).
 */

import { EventEmitter } from "node:events";
import { appendEvent } from "./store.js";
import type { TaskEvent } from "./types.js";

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

/** Broadcast a raw (non-persisted) event live — used for streaming text deltas. */
export function emitTaskEvent(taskId: string, event: unknown): void {
  bus.emit(taskId, event);
}

/** Persist a milestone event AND broadcast it live. */
export function recordEvent(
  taskId: string,
  type: string,
  payload?: unknown
): TaskEvent {
  const event = appendEvent(taskId, type, payload);
  bus.emit(taskId, event);
  return event;
}
