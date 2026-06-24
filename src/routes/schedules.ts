import type { FastifyInstance } from "fastify";
import {
  createSchedule,
  listSchedules,
  getSchedule,
  updateSchedule,
  deleteSchedule,
  createTask,
} from "../core/store.js";
import { nextRun } from "../core/scheduler.js";
import { runTask } from "../core/runner.js";

interface CreateScheduleBody {
  prompt?: string;
  spec?: string;
  repo?: string;
  branch?: string;
  model?: string;
  provider?: string;
  enabled?: boolean;
}

export default async function schedulesRoute(app: FastifyInstance) {
  // Create a recurring schedule.
  app.post("/api/schedules", async (req, reply) => {
    const body = (req.body || {}) as CreateScheduleBody;
    if (!body.prompt) return reply.code(400).send({ error: "prompt is required" });
    if (!body.spec) return reply.code(400).send({ error: "spec is required" });

    const next = nextRun(body.spec, new Date());
    if (!next) {
      return reply.code(400).send({
        error: "invalid spec; use '@every <n>(s|m|h|d)' or '@daily HH:MM'",
      });
    }

    const schedule = createSchedule({
      prompt: body.prompt,
      spec: body.spec,
      repo: body.repo ?? null,
      branch: body.branch ?? null,
      model: body.model ?? null,
      provider: body.provider ?? null,
      enabled: body.enabled ?? true,
      nextRunAt: next.getTime(),
    });
    return reply.code(201).send(schedule);
  });

  // List schedules.
  app.get("/api/schedules", async () => {
    return { schedules: listSchedules() };
  });

  // A single schedule.
  app.get("/api/schedules/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const schedule = getSchedule(id);
    if (!schedule) return reply.code(404).send({ error: "Schedule not found" });
    return schedule;
  });

  // Update a schedule (enable/disable, change spec or prompt).
  app.patch("/api/schedules/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getSchedule(id)) return reply.code(404).send({ error: "Schedule not found" });
    const body = (req.body || {}) as CreateScheduleBody;

    const patch: Record<string, unknown> = {};
    for (const k of ["prompt", "repo", "branch", "model", "provider", "enabled"] as const) {
      if (k in body) patch[k] = body[k];
    }
    // Changing the spec recomputes the next run time.
    if (body.spec) {
      const next = nextRun(body.spec, new Date());
      if (!next) return reply.code(400).send({ error: "invalid spec" });
      patch.spec = body.spec;
      patch.nextRunAt = next.getTime();
    }
    return updateSchedule(id, patch);
  });

  // Delete a schedule.
  app.delete("/api/schedules/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const removed = deleteSchedule(id);
    if (!removed) return reply.code(404).send({ error: "Schedule not found" });
    return { id, deleted: true };
  });

  // Run a schedule's task once, now, without touching its recurrence.
  app.post("/api/schedules/:id/run", async (req, reply) => {
    const { id } = req.params as { id: string };
    const schedule = getSchedule(id);
    if (!schedule) return reply.code(404).send({ error: "Schedule not found" });
    const task = createTask({
      prompt: schedule.prompt,
      repo: schedule.repo,
      branch: schedule.branch,
      model: schedule.model,
      provider: schedule.provider,
    });
    void runTask(task.id);
    return reply.code(201).send(task);
  });
}
