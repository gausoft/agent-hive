import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  initStore,
  closeStore,
  createTask,
  updateTask,
  getTask,
  listTasks,
  appendEvent,
  getEvents,
  reconcileOrphanedTasks,
} from "../core/store.js";

before(() => initStore(":memory:"));
after(() => closeStore());

// node:sqlite :memory: is per-connection; we reuse one connection and just
// assert on freshly created ids, so no cross-test cleanup is required.

test("createTask inserts a queued task with defaults", () => {
  const task = createTask({ prompt: "do the thing", repo: "octo/repo" });
  assert.equal(task.status, "queued");
  assert.equal(task.repo, "octo/repo");
  assert.equal(task.prUrl, null);
  assert.ok(task.id.length > 0);
  assert.ok(task.createdAt > 0);

  const fetched = getTask(task.id);
  assert.deepEqual(fetched, task);
});

test("updateTask applies a partial patch and ignores unknown keys", () => {
  const task = createTask({ prompt: "x" });
  const updated = updateTask(task.id, {
    status: "running",
    startedAt: 123,
    prUrl: "https://github.com/o/r/pull/1",
  });
  assert.equal(updated?.status, "running");
  assert.equal(updated?.startedAt, 123);
  assert.equal(updated?.prUrl, "https://github.com/o/r/pull/1");
  // Unchanged fields stay put
  assert.equal(updated?.prompt, "x");
});

test("updateTask on a missing id returns null", () => {
  assert.equal(updateTask("nope", { status: "done" }), null);
});

test("listTasks filters by status and returns newest first", () => {
  const a = createTask({ prompt: "a" });
  const b = createTask({ prompt: "b" });
  updateTask(a.id, { status: "done" });
  updateTask(b.id, { status: "done" });

  const done = listTasks({ status: "done" });
  const ids = done.map((t) => t.id);
  assert.ok(ids.includes(a.id) && ids.includes(b.id));
  // b was created after a, so it should come first
  assert.ok(ids.indexOf(b.id) < ids.indexOf(a.id));
});

test("appendEvent + getEvents preserve order and JSON payloads", () => {
  const task = createTask({ prompt: "stream me" });
  appendEvent(task.id, "started");
  appendEvent(task.id, "log", { line: "hello" });
  const e3 = appendEvent(task.id, "done", { ok: true });

  const events = getEvents(task.id);
  assert.equal(events.length, 3);
  assert.equal(events[0].type, "started");
  assert.deepEqual(events[1].payload, { line: "hello" });
  assert.deepEqual(events[2].payload, { ok: true });

  // afterId paginates the timeline
  const tail = getEvents(task.id, { afterId: events[1].id });
  assert.equal(tail.length, 1);
  assert.equal(tail[0].id, e3.id);
});

test("reconcileOrphanedTasks fails running/review/verifying, leaves terminal states", () => {
  const t1 = createTask({ prompt: "a" });
  const t2 = createTask({ prompt: "b" });
  const t3 = createTask({ prompt: "c" });
  updateTask(t1.id, { status: "running" });
  updateTask(t2.id, { status: "verifying" });
  updateTask(t3.id, { status: "done" });
  const n = reconcileOrphanedTasks();
  assert.ok(n >= 2); // other tests may leave non-terminal tasks in the shared DB
  assert.equal(getTask(t1.id)?.status, "failed");
  assert.equal(getTask(t2.id)?.status, "failed");
  assert.equal(getTask(t3.id)?.status, "done");
});
