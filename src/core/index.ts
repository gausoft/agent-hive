/**
 * Public entry point for the embeddable Agent Hive core.
 *
 * This module has NO HTTP/Fastify dependency: it is the store, runner, git,
 * scheduler and provider resolution that the server, CLI, MCP and Telegram
 * surfaces all build on. Embed it in any app:
 *
 *   import { initStore, createTask, runTask, subscribeTask } from "agent-hive/core";
 *
 *   initStore();
 *   const task = createTask({ repo: "owner/repo", prompt: "fix the bug" });
 *   const unsubscribe = subscribeTask(task.id, (event) => console.log(event.type));
 *   await runTask(task.id);
 */

export * from "./types.js";
export * from "./store.js";
export * from "./runner.js";
export * from "./git.js";
export * from "./scheduler.js";
export * from "./providers.js";
