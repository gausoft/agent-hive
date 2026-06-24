import type { FastifyInstance } from "fastify";
import {
  createTask,
  getTask,
  listTasks,
  getEvents,
} from "../core/store.js";
import { runTask, abortTask, subscribeTask } from "../core/runner.js";
import { validateToken } from "../auth.js";
import type { TaskStatus } from "../core/types.js";

interface CreateTaskBody {
  prompt?: string;
  repo?: string;
  branch?: string;
  model?: string;
  provider?: string;
  thinkingLevel?: string;
  reviewCycles?: number;
  reviewModel?: string;
  systemPromptOverride?: string;
}

export default async function tasksRoute(app: FastifyInstance) {
  // Create a task and start it (fire-and-forget; progress is persisted).
  app.post("/api/tasks", async (req, reply) => {
    const body = (req.body || {}) as CreateTaskBody;
    if (!body.prompt) {
      return reply.code(400).send({ error: "prompt is required" });
    }

    const task = createTask({
      prompt: body.prompt,
      repo: body.repo ?? null,
      branch: body.branch ?? null,
      model: body.model ?? null,
      provider: body.provider ?? null,
    });

    void runTask(task.id, {
      thinkingLevel: body.thinkingLevel,
      reviewCycles: body.reviewCycles,
      reviewModel: body.reviewModel,
      systemPromptOverride: body.systemPromptOverride,
    });

    return reply.code(201).send(task);
  });

  // List tasks for the board, optionally filtered by status.
  app.get("/api/tasks", async (req) => {
    const q = req.query as { status?: string; limit?: string };
    const limit = q.limit ? parseInt(q.limit, 10) : undefined;
    return {
      tasks: listTasks({
        status: q.status as TaskStatus | undefined,
        limit,
      }),
    };
  });

  // A single task.
  app.get("/api/tasks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = getTask(id);
    if (!task) return reply.code(404).send({ error: "Task not found" });
    return task;
  });

  // The task's event timeline (poll; pass afterId for incremental reads).
  app.get("/api/tasks/:id/events", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getTask(id)) return reply.code(404).send({ error: "Task not found" });
    const q = req.query as { afterId?: string; limit?: string };
    return {
      events: getEvents(id, {
        afterId: q.afterId ? parseInt(q.afterId, 10) : undefined,
        limit: q.limit ? parseInt(q.limit, 10) : undefined,
      }),
    };
  });

  // Abort a running task.
  app.post("/api/tasks/:id/abort", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getTask(id)) return reply.code(404).send({ error: "Task not found" });
    const aborted = await abortTask(id);
    return { id, aborted };
  });

  // Live event stream: replay persisted history, then follow live (poll-free).
  app.get(
    "/api/tasks/:id/stream",
    { websocket: true },
    (socket, req) => {
      const token = (req.query as Record<string, string>).token;
      if (!validateToken(token)) {
        socket.close(4001, "Unauthorized");
        return;
      }
      const { id } = (req.params || {}) as { id: string };
      if (!getTask(id)) {
        socket.close(4004, "Task not found");
        return;
      }

      for (const event of getEvents(id)) {
        if (socket.readyState === 1) socket.send(JSON.stringify(event));
      }

      const unsubscribe = subscribeTask(id, (event) => {
        if (socket.readyState === 1) {
          try {
            socket.send(JSON.stringify(event));
          } catch {
            // client disconnected
          }
        }
      });

      socket.on("close", () => unsubscribe());
    }
  );
}
