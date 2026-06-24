/**
 * Telegram bot for Agent Hive — dispatch and track tasks from your phone.
 *
 * Zero dependencies: raw Telegram Bot API over long-polling (getUpdates) and
 * the global WebSocket (Node 22+) to follow task milestones. It talks to the
 * Hive REST API like any other client (HIVE_URL + HIVE_TOKEN).
 *
 * Security: only chat ids listed in TELEGRAM_ALLOWED_CHATS may drive the bot.
 * With no allowlist, the bot refuses commands and tells you your chat id so you
 * can add it — a public bot token must not be an open door to your VPS.
 */

import { fileURLToPath } from "node:url";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const HIVE_URL = process.env.HIVE_URL;
const HIVE_TOKEN = process.env.HIVE_TOKEN;
const ALLOWED = (process.env.TELEGRAM_ALLOWED_CHATS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const MILESTONES = new Set([
  "cloned",
  "branch",
  "review",
  "pr",
  "no_changes",
  "pr_error",
  "error",
  "status",
]);

const REPO_RE = /^([\w.-]+\/[\w.-]+|https?:\/\/\S+|git@\S+)$/;

/** Parse a /new command body into an optional repo + the prompt. */
export function parseNewCommand(
  text: string
): { repo?: string; prompt: string } | null {
  const body = text.replace(/^\/new(@\w+)?\s*/i, "").trim();
  if (!body) return null;
  const [first, ...rest] = body.split(/\s+/);
  if (REPO_RE.test(first) && rest.length > 0) {
    return { repo: first, prompt: rest.join(" ") };
  }
  return { prompt: body };
}

/** Format a task event as a milestone message, or null to skip it. */
export function formatMilestone(event: {
  type?: string;
  payload?: any;
}): string | null {
  if (!event || typeof event.type !== "string") return null;
  const p = event.payload || {};
  switch (event.type) {
    case "cloned":
      return `📥 Cloned ${p.repo || ""}`.trim();
    case "branch":
      return `🌿 Branch ${p.branch || ""}`.trim();
    case "review":
      return `🔍 Review cycle`;
    case "pr":
      return `✅ PR opened: ${p.url}`;
    case "no_changes":
      return `ℹ️ No changes to propose`;
    case "pr_error":
      return `⚠️ PR failed: ${p.message || "unknown"}`;
    case "error":
      return `❌ Task failed: ${p.message || "unknown"}`;
    case "status":
      if (p.status === "running") return `▶️ Running`;
      if (p.status === "done") return `🏁 Done`;
      if (p.status === "aborted") return `🛑 Aborted`;
      return null;
    default:
      return null;
  }
}

// ---- Runtime (skipped under test via the import guard below) ----

async function tg(method: string, params: Record<string, unknown>): Promise<any> {
  const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }
  );
  return res.json();
}

async function hive<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${HIVE_URL}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${HIVE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Hive ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

function allowed(chatId: number): boolean {
  return ALLOWED.length > 0 && ALLOWED.includes(String(chatId));
}

/** Follow a task's milestones over WebSocket and push them to the chat. */
function watchTask(taskId: string, chatId: number): void {
  const wsUrl =
    HIVE_URL!.replace(/^http/, "ws") +
    `/api/tasks/${taskId}/stream?token=${encodeURIComponent(HIVE_TOKEN!)}`;
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl);
  } catch {
    return;
  }
  let seenHistory = false;
  const startedAt = Date.now();
  ws.onmessage = (ev: any) => {
    // Skip the replayed history burst that arrives immediately on connect.
    if (!seenHistory && Date.now() - startedAt < 400) return;
    seenHistory = true;
    let event: any;
    try {
      event = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    if (!MILESTONES.has(event.type)) return;
    const msg = formatMilestone(event);
    if (msg) void tg("sendMessage", { chat_id: chatId, text: msg });
    if (event.type === "status" && ["done", "aborted"].includes(event.payload?.status)) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
  };
  ws.onerror = () => {};
}

const HELP = [
  "🐝 Agent Hive",
  "",
  "/new <prompt> — dispatch a task",
  "/new owner/repo <prompt> — dispatch against a repo",
  "/list — recent tasks",
  "/status <id> — task status + PR",
  "/abort <id> — abort a running task",
].join("\n");

async function handle(msg: any): Promise<void> {
  const chatId = msg.chat?.id as number;
  const text = (msg.text || "").trim();
  if (!chatId || !text.startsWith("/")) return;

  if (!allowed(chatId)) {
    await tg("sendMessage", {
      chat_id: chatId,
      text:
        `Unauthorized. Add this chat id to TELEGRAM_ALLOWED_CHATS:\n${chatId}`,
    });
    return;
  }

  const cmd = text.split(/\s+/)[0].replace(/@\w+$/, "").toLowerCase();

  if (cmd === "/start" || cmd === "/help") {
    await tg("sendMessage", { chat_id: chatId, text: HELP });
    return;
  }

  if (cmd === "/new") {
    const parsed = parseNewCommand(text);
    if (!parsed) {
      await tg("sendMessage", { chat_id: chatId, text: "Usage: /new [owner/repo] <prompt>" });
      return;
    }
    try {
      const task = await hive<{ id: string }>("/api/tasks", parsed);
      await tg("sendMessage", {
        chat_id: chatId,
        text: `🐝 Dispatched ${task.id.slice(0, 8)}`,
      });
      watchTask(task.id, chatId);
    } catch (e: any) {
      await tg("sendMessage", { chat_id: chatId, text: `Error: ${e.message}` });
    }
    return;
  }

  if (cmd === "/list") {
    const { tasks } = await hive<{ tasks: any[] }>("/api/tasks?limit=10");
    const lines = tasks.length
      ? tasks
          .map(
            (t) =>
              `${t.id.slice(0, 8)} · ${t.status} · ${t.repo || "no repo"}`
          )
          .join("\n")
      : "No tasks yet.";
    await tg("sendMessage", { chat_id: chatId, text: lines });
    return;
  }

  if (cmd === "/status" || cmd === "/abort") {
    const id = text.split(/\s+/)[1];
    if (!id) {
      await tg("sendMessage", { chat_id: chatId, text: `Usage: ${cmd} <id>` });
      return;
    }
    if (cmd === "/abort") {
      await hive(`/api/tasks/${id}/abort`, {});
      await tg("sendMessage", { chat_id: chatId, text: `🛑 Abort requested for ${id.slice(0, 8)}` });
      return;
    }
    try {
      const t = await hive<any>(`/api/tasks/${id}`);
      const parts = [
        `${t.id.slice(0, 8)} · ${t.status}`,
        t.repo ? `repo: ${t.repo}` : null,
        t.prUrl ? `PR: ${t.prUrl}` : null,
        t.error ? `error: ${t.error}` : null,
      ].filter(Boolean);
      await tg("sendMessage", { chat_id: chatId, text: parts.join("\n") });
    } catch (e: any) {
      await tg("sendMessage", { chat_id: chatId, text: `Error: ${e.message}` });
    }
  }
}

async function main(): Promise<void> {
  if (!BOT_TOKEN || !HIVE_URL || !HIVE_TOKEN) {
    console.error(
      "FATAL: TELEGRAM_BOT_TOKEN, HIVE_URL and HIVE_TOKEN must be set"
    );
    process.exit(1);
  }
  if (ALLOWED.length === 0) {
    console.error(
      "WARNING: TELEGRAM_ALLOWED_CHATS is empty — the bot will refuse all commands until you add your chat id."
    );
  }
  console.error("Agent Hive Telegram bot started");

  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await tg("getUpdates", { offset, timeout: 30 });
      for (const update of res.result || []) {
        offset = update.update_id + 1;
        if (update.message) await handle(update.message);
      }
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// Only run the long-poll loop when executed directly, not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
