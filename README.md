# Agent Hive

**Self-hosted coding agents that open pull requests.** Dispatch a task from a
kanban board, your terminal, an MCP client, or Telegram — Agent Hive clones the
repo on your own server, runs a [pi.dev](https://pi.dev) coding agent, captures
the diff, and opens a PR. Every task is persisted, so progress survives
restarts and the same state feeds every surface.

Powered by the [pi.dev](https://pi.dev) SDK (BSD 3-Clause). Fork of
[stansz/agent-hive](https://github.com/stansz/agent-hive).

---

## Quick Start

```bash
git clone https://github.com/gausoft/agent-hive.git
cd agent-hive
cp .env.example .env
# Edit .env: set API_TOKEN and at least one LLM provider key
npm install
npm run build
npm start
```

Open the board at `http://localhost:8080/ui/` and log in with your `API_TOKEN`.

## Surfaces

One core, four ways to drive it — all reading the same durable store:

| Surface | How | Best for |
|---------|-----|----------|
| **Board (Web + REST)** | `http://localhost:8080/ui/`, `/api/tasks` | Watch tasks live, review diffs, open PRs |
| **CLI** | `hive new …`, `hive watch …` | Dispatching and following from a terminal |
| **MCP** | `npm run mcp` (stdio) | Driving Hive from Claude Code, Cursor, etc. |
| **Telegram** | `npm run telegram` | Dispatching and milestone alerts from your phone |
| **Embeddable core** | `import … from "agent-hive/core"` | Building Hive into your own app |

## The Task Lifecycle

```
queued ──→ running ──→ [review] ──→ done
                  └──────────────→ failed | aborted
```

1. A task is created (repo + prompt) and persisted as `queued`.
2. Hive clones the repo, snapshots the base commit, and (by default) creates a
   work branch `hive/task-<id>`.
3. The agent reads `AGENTS.md`, edits files, and commits.
4. Optional self-review cycles diff the work and apply fixes in-repo.
5. The diff is captured to the store **before** the workspace is cleaned up.
6. The branch is pushed and a PR is opened (`gh pr create --fill`); the PR URL
   is stored on the task.

Set `HIVE_OPEN_PR=0` to skip branch/PR and let the agent push freely.
Set `HIVE_KEEP_WORKSPACE=1` to keep the clone on disk for inspection.

## Preview URLs

Hive doesn't host previews — it **delegates to your deploy platform's PR
previews**, so it stays agnostic to where you deploy. Since Hive already opens a
PR, any platform (Coolify, Vercel, Netlify, Railway, Render, Fly…) builds a
preview environment for it and publishes the URL through the standard GitHub
signal (`deployment_status` with `state=success`, URL in `environment_url`;
Netlify uses the commit `status`). Hive reads it and surfaces it on the task
(`previewUrl`), the board, and Telegram (`🔗 Preview ready: …`).

Two triggers funnel through one core:

- **Webhook (instant, recommended).** Point a repo or GitHub-App webhook at
  `POST /api/github/webhook` (content type `application/json`, events
  *Deployment statuses* + *Statuses*) and set `GITHUB_WEBHOOK_SECRET`. The route
  is public but authenticated by HMAC (`X-Hub-Signature-256`).
- **Polling fallback (zero-config, on by default).** After the PR, Hive polls
  the Deployments / commit-status API via `gh` until the URL appears (or
  `HIVE_PREVIEW_TIMEOUT_MS`). Set `HIVE_PREVIEW=0` to disable.

Prereq: the platform must have PR previews enabled for the repo.

## Board REST API

All endpoints except `/health` require `Authorization: Bearer <token>`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/tasks` | Create + start a task |
| GET | `/api/tasks?status=&limit=` | List tasks (board) |
| GET | `/api/tasks/:id` | Task detail (status, diff, PR url) |
| GET | `/api/tasks/:id/events?afterId=` | Event timeline (polling) |
| POST | `/api/tasks/:id/abort` | Abort a running task |
| WS | `/api/tasks/:id/stream?token=` | Replay history, then follow live |

```bash
curl -X POST http://localhost:8080/api/tasks \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{ "repo": "owner/repo", "prompt": "add a healthcheck endpoint" }'
```

Task fields: `prompt` (required), `repo`, `branch` (base), `model`, `provider`,
`thinkingLevel`, `reviewCycles`, `reviewModel`, `systemPromptOverride`.

The legacy session API (`/prompt`, `/status/:id`, `/messages/:id`, `/abort/:id`,
`/snippet`, `WS /events/:id`) and the GitHub helper routes (`/api/github/*`)
remain for the chat UI and back-compat.

## CLI

```bash
export HIVE_URL=http://localhost:8080 HIVE_TOKEN=your-token

hive new --repo owner/repo "add a healthcheck endpoint"
hive list --status running
hive status <id>
hive watch <id>     # live agent output + milestones until the task finishes
hive diff <id>
hive abort <id>
```

## MCP Tools

```bash
export HIVE_URL=http://localhost:8080 HIVE_TOKEN=your-token
npm run mcp
```

Board tools: `hive_dispatch`, `hive_tasks`, `hive_task`, `hive_task_diff`,
`hive_task_events`, `hive_task_abort`. Legacy session tools
(`hive_prompt`, `hive_status`, `hive_abort`, `hive_snippet`, …) are also exposed.

## Telegram

```bash
export HIVE_URL=http://localhost:8080 HIVE_TOKEN=your-token
export TELEGRAM_BOT_TOKEN=123456:ABC...
export TELEGRAM_ALLOWED_CHATS=<your-chat-id>
npm run telegram
```

Commands: `/new [owner/repo] <prompt>`, `/list`, `/status <id>`, `/abort <id>`.
Milestones (clone, branch, review, PR, done/failed) are pushed to the chat. Only
chat ids in `TELEGRAM_ALLOWED_CHATS` may drive the bot; others are refused and
told their chat id so it can be added.

## Scheduler (recurring tasks)

A schedule dispatches a normal task on a recurrence — same store, same PR flow.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/schedules` | Create (`prompt`, `spec`, optional `repo`/`model`) |
| GET | `/api/schedules` | List schedules |
| PATCH | `/api/schedules/:id` | Enable/disable, change spec or prompt |
| DELETE | `/api/schedules/:id` | Delete |
| POST | `/api/schedules/:id/run` | Run once now |

Recurrence `spec` is a tiny subset, not full cron:
`@every <n>(s|m|h|d)` (e.g. `@every 6h`) or `@daily HH:MM` (local time).

## Embeddable Core

The core has no HTTP dependency. Import it into any app:

```ts
import { initStore, createTask, runTask, subscribeTask } from "agent-hive/core";

initStore();
const task = createTask({ repo: "owner/repo", prompt: "fix the bug" });
const unsubscribe = subscribeTask(task.id, (event) => console.log(event.type));
await runTask(task.id);
```

Exposes the store, runner, git helpers, scheduler, and provider resolution.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `API_TOKEN` | (required) | Bearer token for all API calls |
| `API_TOKENS` | — | JSON map `{ "token": { "name": "...", "role": "..." } }` for multiple tokens |
| `PORT` | `8080` | Server port |
| `WORKSPACE` | `/tmp/hive-workspace` | Repo clone directory |
| `HIVE_DB_PATH` | `data/hive.db` | SQLite store location |
| `HIVE_OPEN_PR` | `1` | Open a PR with the work (`0` = agent pushes freely) |
| `HIVE_KEEP_WORKSPACE` | `0` | Keep the clone after a task finishes |
| `GITHUB_WEBHOOK_SECRET` | — | HMAC secret for `POST /api/github/webhook` (preview URLs) |
| `HIVE_PREVIEW` | `1` | Poll for the platform's preview URL after a PR (`0` = off) |
| `HIVE_PREVIEW_INTERVAL_MS` / `HIVE_PREVIEW_TIMEOUT_MS` | `15000` / `600000` | Preview poll cadence / give-up |
| `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` | gh defaults | Commit identity |
| `GH_BIN` | `gh` | Path to the GitHub CLI |
| `DEFAULT_PROVIDER` | auto | LLM provider (auto-detected from keys) |
| `DEFAULT_MODEL` | — | Default model |
| `DEEPSEEK_API_KEY` / `OPENROUTER_API_KEY` / `ZAI_CODE` / `ANTHROPIC_API_KEY` | — | Provider keys (BYOK) |
| `MAX_CONCURRENT_SESSIONS` | `3` | Max parallel sessions |
| `PI_TELEMETRY` | `0` | Disable pi telemetry |

Client processes (CLI, MCP, Telegram) use `HIVE_URL` + `HIVE_TOKEN`.

## Deployment (systemd)

```ini
[Unit]
Description=Agent Hive
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/home/youruser/agent-hive
ExecStart=/usr/bin/node /home/youruser/agent-hive/dist/index.js
Restart=always
RestartSec=5
EnvironmentFile=/home/youruser/agent-hive/.env

[Install]
WantedBy=multi-user.target
```

For private repos, authenticate `gh` on the server (`gh auth login`) or install
per-repo SSH deploy keys; Hive converts HTTPS repo URLs to SSH automatically.

## AGENTS.md Auto-Discovery

Hive sets the agent's `cwd` to the cloned repo, so pi.dev's built-in `AGENTS.md`
discovery loads it automatically. Put project context (stack, conventions,
build/test commands, gotchas) in your repo's `AGENTS.md`.

## Development

```bash
npm run build     # tsc
npm test          # build + node:test suite
npm run dev       # watch mode
```

## License

BSD 3-Clause
