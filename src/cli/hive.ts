#!/usr/bin/env node
/**
 * hive — a thin CLI over the Agent Hive REST API.
 *
 * Zero dependencies: fetch + the global WebSocket (Node 22+). It is a shell
 * surface onto the same core every other client uses. Configure with:
 *   HIVE_URL   (default http://localhost:8080)
 *   HIVE_TOKEN (a token from API_TOKEN / API_TOKENS)
 *
 * Usage:
 *   hive new [--repo owner/repo] [--branch b] [--model m] [--provider p] <prompt...>
 *   hive list [--status queued|running|review|done|failed|aborted]
 *   hive status <id>
 *   hive events <id>
 *   hive diff <id>
 *   hive abort <id>
 *   hive watch <id>      follow a task live until it finishes
 */

import { fileURLToPath } from "node:url";

const HIVE_URL = process.env.HIVE_URL || "http://localhost:8080";
const HIVE_TOKEN = process.env.HIVE_TOKEN || "";

const FLAG_KEYS = ["repo", "branch", "model", "provider"] as const;

/** Parse `new` arguments into typed flags + the free-text prompt. */
export function parseNewArgs(args: string[]): {
  flags: Record<string, string>;
  prompt: string;
} {
  const flags: Record<string, string> = {};
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      flags[key] = args[++i] ?? "";
    } else {
      words.push(a);
    }
  }
  return { flags, prompt: words.join(" ") };
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

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

async function cmdNew(args: string[]): Promise<void> {
  const { flags, prompt } = parseNewArgs(args);
  if (!prompt) die("Usage: hive new [--repo owner/repo] <prompt...>");
  const body: Record<string, string> = { prompt };
  for (const k of FLAG_KEYS) if (flags[k]) body[k] = flags[k];
  const task = await hive<{ id: string; status: string }>("/api/tasks", body);
  console.log(`${task.id}  ${task.status}`);
}

async function cmdList(args: string[]): Promise<void> {
  const { flags } = parseNewArgs(args);
  const qs = flags.status ? `?status=${flags.status}` : "";
  const { tasks } = await hive<{ tasks: any[] }>(`/api/tasks${qs}`);
  if (!tasks.length) {
    console.log("No tasks.");
    return;
  }
  for (const t of tasks) {
    console.log(
      `${t.id.slice(0, 8)}  ${t.status.padEnd(8)}  ${t.repo || "-"}  ${t.prompt.slice(0, 60)}`
    );
  }
}

async function cmdStatus(id: string): Promise<void> {
  const t = await hive<any>(`/api/tasks/${id}`);
  console.log(`id:      ${t.id}`);
  console.log(`status:  ${t.status}`);
  if (t.repo) console.log(`repo:    ${t.repo}`);
  if (t.model) console.log(`model:   ${t.model}`);
  if (t.prUrl) console.log(`pr:      ${t.prUrl}`);
  if (t.error) console.log(`error:   ${t.error}`);
}

async function cmdEvents(id: string): Promise<void> {
  const { events } = await hive<{ events: any[] }>(`/api/tasks/${id}/events`);
  for (const e of events) {
    const payload = e.payload ? JSON.stringify(e.payload) : "";
    console.log(`${e.type}\t${payload}`);
  }
}

async function cmdDiff(id: string): Promise<void> {
  const t = await hive<{ diff?: string }>(`/api/tasks/${id}`);
  process.stdout.write(t.diff || "(no diff captured)\n");
}

async function cmdAbort(id: string): Promise<void> {
  const r = await hive<{ aborted: boolean }>(`/api/tasks/${id}/abort`, {});
  console.log(r.aborted ? "Abort requested." : "Task is not running.");
}

function cmdWatch(id: string): void {
  const wsUrl =
    HIVE_URL.replace(/^http/, "ws") +
    `/api/tasks/${id}/stream?token=${encodeURIComponent(HIVE_TOKEN)}`;
  const ws = new WebSocket(wsUrl);
  ws.onmessage = (ev: any) => {
    let e: any;
    try {
      e = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    if (
      e.type === "message_update" &&
      e.assistantMessageEvent?.type === "text_delta"
    ) {
      process.stdout.write(e.assistantMessageEvent.delta);
      return;
    }
    if (typeof e.type === "string") {
      const payload = e.payload ? " " + JSON.stringify(e.payload) : "";
      process.stdout.write(`\n[${e.type}]${payload}\n`);
      if (
        e.type === "status" &&
        ["done", "aborted"].includes(e.payload?.status)
      ) {
        ws.close();
        process.exit(0);
      }
      if (e.type === "error") {
        ws.close();
        process.exit(1);
      }
    }
  };
  ws.onerror = () => die("WebSocket error");
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "new":
      return cmdNew(rest);
    case "list":
      return cmdList(rest);
    case "status":
      return rest[0] ? cmdStatus(rest[0]) : die("Usage: hive status <id>");
    case "events":
      return rest[0] ? cmdEvents(rest[0]) : die("Usage: hive events <id>");
    case "diff":
      return rest[0] ? cmdDiff(rest[0]) : die("Usage: hive diff <id>");
    case "abort":
      return rest[0] ? cmdAbort(rest[0]) : die("Usage: hive abort <id>");
    case "watch":
      return rest[0] ? cmdWatch(rest[0]) : die("Usage: hive watch <id>");
    default:
      console.log(
        "Commands: new, list, status, events, diff, abort, watch\n" +
          "Env: HIVE_URL (default http://localhost:8080), HIVE_TOKEN"
      );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => die(e.message));
}
