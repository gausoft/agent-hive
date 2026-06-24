import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { nextRun } from "../core/scheduler.js";
import {
  initStore,
  closeStore,
  createSchedule,
  getSchedule,
  listSchedules,
  updateSchedule,
  deleteSchedule,
  dueSchedules,
} from "../core/store.js";

test("nextRun handles @every with each unit", () => {
  const from = new Date("2020-01-01T00:00:00.000Z");
  assert.equal(
    nextRun("@every 6h", from)!.getTime(),
    from.getTime() + 6 * 3600_000
  );
  assert.equal(
    nextRun("@every 30m", from)!.getTime(),
    from.getTime() + 30 * 60_000
  );
  assert.equal(
    nextRun("@every 2d", from)!.getTime(),
    from.getTime() + 2 * 86_400_000
  );
});

test("nextRun handles @daily relative to local time", () => {
  const before = new Date(2020, 0, 1, 8, 0, 0); // 08:00 local
  const r1 = nextRun("@daily 09:00", before)!;
  assert.equal(r1.getHours(), 9);
  assert.equal(r1.getDate(), 1);

  const after = new Date(2020, 0, 1, 10, 0, 0); // 10:00 local
  const r2 = nextRun("@daily 09:00", after)!;
  assert.equal(r2.getHours(), 9);
  assert.equal(r2.getDate(), 2); // rolls to next day
});

test("nextRun rejects invalid specs", () => {
  const from = new Date();
  assert.equal(nextRun("bogus", from), null);
  assert.equal(nextRun("@every 0h", from), null);
  assert.equal(nextRun("@daily 25:00", from), null);
  assert.equal(nextRun("@daily 09:99", from), null);
});

// ── store: schedules ──

beforeEach(() => initStore(":memory:"));
afterEach(() => closeStore());

test("schedule CRUD round-trips", () => {
  const s = createSchedule({
    prompt: "nightly deps audit",
    spec: "@daily 03:00",
    repo: "o/r",
    nextRunAt: 1000,
  });
  assert.equal(getSchedule(s.id)!.prompt, "nightly deps audit");
  assert.equal(listSchedules().length, 1);

  updateSchedule(s.id, { enabled: false });
  assert.equal(getSchedule(s.id)!.enabled, false);

  assert.equal(deleteSchedule(s.id), true);
  assert.equal(getSchedule(s.id), null);
});

test("dueSchedules returns only enabled schedules due at or before now", () => {
  const now = 10_000;
  createSchedule({ prompt: "due", spec: "@every 1h", nextRunAt: now - 1 });
  createSchedule({ prompt: "future", spec: "@every 1h", nextRunAt: now + 1000 });
  const disabled = createSchedule({
    prompt: "off",
    spec: "@every 1h",
    nextRunAt: now - 1,
  });
  updateSchedule(disabled.id, { enabled: false });

  const due = dueSchedules(now);
  assert.equal(due.length, 1);
  assert.equal(due[0].prompt, "due");
});
