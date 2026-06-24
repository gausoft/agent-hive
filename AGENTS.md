# Agent Hive — AGENTS.md

## What This Is

A self-hosted coding-agent server built on the [pi.dev](https://pi.dev) SDK. It
turns a prompt into a pull request: clone a repo, run an agent, capture the
diff, open a PR. Tasks are durable (SQLite) and driven from four surfaces (board
/REST, CLI, MCP, Telegram) that all share one HTTP-free core.

## Architecture

```
                 ┌──────────────── core (no HTTP) ────────────────┐
  surfaces  ───► │ store (SQLite) · runner · git · scheduler ·    │
                 │ providers                                       │
                 └────────────────────────────────────────────────┘
  REST+WS (board) · MCP stdio · CLI · Telegram  all call the core
```

| Path | Role |
|------|------|
| `src/core/store.ts` | SQLite store (`tasks`, `task_events`, `schedules`) + CRUD |
| `src/core/runner.ts` | Task lifecycle: clone → branch → agent → review → diff → PR |
| `src/core/git.ts` | Branch, commit, push, `gh pr create` helpers |
| `src/core/scheduler.ts` | Recurrence parser (`nextRun`) + minute-resolution loop |
| `src/core/providers.ts` | Provider config + model resolution (BYOK) |
| `src/core/index.ts` | Public barrel → published as `agent-hive/core` |
| `src/auth.ts` | Shared token validation (`API_TOKEN` + `API_TOKENS` map) |
| `src/index.ts` | Fastify server, auth hook, store + scheduler boot, routes |
| `src/routes/tasks.ts` | Board REST API + live WS stream |
| `src/routes/schedules.ts` | Schedule REST API |
| `src/routes/prompt.ts`, `github.ts`, … | Legacy session + GitHub helper routes |
| `src/sessions/manager.ts` | pi session lifecycle (in-memory), provider registration |
| `src/loops/review.ts` | Diff-based code review cycle |
| `src/mcp/server.ts` | MCP stdio tools (board + legacy session tools) |
| `src/telegram/bot.ts` | Telegram bot (zero-dep, long-polling) |
| `src/cli/hive.ts` | Thin CLI over the REST API |
| `ui/` | Vanilla TS + Vite SPA (chat, GitHub panel, board) — no framework |

## Task Lifecycle (runner.ts)

`queued → running → [review] → done | failed | aborted`

The diff (`git diff <baseSha>`) and all milestone events are persisted **before**
the workspace is removed, so nothing is lost on cleanup. A per-task event bus
(`subscribeTask`) powers live streaming without polling. With `HIVE_OPEN_PR=1`
(default) the work is isolated on `hive/task-<id>` and a PR is opened; PR
failures are recorded, never fatal.

## Conventions (follow these)

- **All code, comments, identifiers, commit messages, and docs in English.**
- **Tests** for every non-trivial brick using `node:test` (no extra framework).
  Run `npm test` (it builds first). Keep pure logic testable (see `nextRun`,
  `parseNewArgs`, `extractPrUrl`).
- **Atomic, conventional commits** (`feat(scope): …`, `fix(scope): …`). One
  concern per commit.
- **Never commit secrets.** `.env` is gitignored; only `.env.example` is
  tracked. No `data/`, `dist/`, `node_modules/`, or `*.db` in git.
- **Keep the README current** when usage changes.
- **Lazy/minimal first** — prefer the standard library and existing patterns
  over new dependencies and abstractions. Add sandboxing/Docker only when
  multi-user or untrusted repos make it necessary.

## Adding Things

- **A board field**: add the column in `store.ts` SCHEMA + `UPDATABLE`, the
  field in `types.ts`, and surface it where needed. Mind same-millisecond
  ordering (`ORDER BY created_at DESC, rowid DESC`).
- **A new surface**: call the core (`createTask` + `runTask` + `subscribeTask`)
  — do not duplicate lifecycle logic in routes.
- **A milestone event**: `record(taskId, type, payload)` in the runner; add the
  type to the milestone sets in `board.ts`, `telegram/bot.ts` if it should
  surface there.

## Environment

See `.env.example` for the full list. Server needs `API_TOKEN` (or `API_TOKENS`)
and at least one provider key. Client processes (CLI/MCP/Telegram) use
`HIVE_URL` + `HIVE_TOKEN`. Git identity is configurable via `GIT_AUTHOR_NAME` /
`GIT_AUTHOR_EMAIL`; private-repo access is via `gh` auth or SSH deploy keys on
the host.
