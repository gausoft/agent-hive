/**
 * Board panel: a kanban view over /api/tasks.
 *
 * - List view: four columns (Queued / Running / Review / Done) plus a
 *   "new task" form.
 * - Detail view: live timeline streamed over WebSocket
 *   (/api/tasks/:id/stream), the captured diff, and the PR link.
 */

interface Task {
  id: string;
  repo: string | null;
  branch: string | null;
  prompt: string;
  model: string | null;
  provider: string | null;
  status: string;
  diff: string | null;
  prUrl: string | null;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

const COLUMNS: { key: string; label: string; statuses: string[] }[] = [
  { key: "queued", label: "Queued", statuses: ["queued"] },
  { key: "running", label: "Running", statuses: ["running"] },
  { key: "review", label: "Review", statuses: ["review"] },
  { key: "done", label: "Done", statuses: ["done", "failed", "aborted"] },
];

const MILESTONES = new Set([
  "status",
  "cloned",
  "branch",
  "session",
  "review",
  "pr",
  "no_changes",
  "pr_error",
  "error",
]);

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export class BoardPanel {
  private token: string;
  private serverUrl: string;
  private root: HTMLElement | null = null;
  private ws: WebSocket | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private openTaskId: string | null = null;
  private liveText = "";

  constructor(token: string, serverUrl: string) {
    this.token = token;
    this.serverUrl = serverUrl;
  }

  private api(path: string, opts: RequestInit = {}): Promise<Response> {
    return fetch(`${this.serverUrl}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
    });
  }

  mount(root: HTMLElement): void {
    this.root = root;
    root.innerHTML = `
      <div class="board-new">
        <input id="bdRepo" placeholder="owner/repo or git URL (optional)" />
        <input id="bdModel" placeholder="model (optional)" />
        <input id="bdPrompt" placeholder="What should the agent do?" />
        <button id="bdCreate">Dispatch</button>
      </div>
      <div class="board-list" id="boardList"></div>
      <div class="board-detail" id="boardDetail" style="display:none;"></div>`;

    (root.querySelector("#bdCreate") as HTMLButtonElement).onclick = () =>
      this.create();
    (root.querySelector("#bdPrompt") as HTMLInputElement).onkeydown = (e) => {
      if ((e as KeyboardEvent).key === "Enter") this.create();
    };

    this.refresh();
  }

  start(): void {
    this.stop();
    this.pollTimer = setInterval(() => {
      if (!this.openTaskId) this.refresh();
    }, 3000);
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.closeStream();
  }

  private async create(): Promise<void> {
    if (!this.root) return;
    const repo = (this.root.querySelector("#bdRepo") as HTMLInputElement).value.trim();
    const model = (this.root.querySelector("#bdModel") as HTMLInputElement).value.trim();
    const promptEl = this.root.querySelector("#bdPrompt") as HTMLInputElement;
    const prompt = promptEl.value.trim();
    if (!prompt) return;

    const body: Record<string, unknown> = { prompt };
    if (repo) body.repo = repo;
    if (model) body.model = model;

    const r = await this.api("/api/tasks", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (r.ok) {
      promptEl.value = "";
      this.refresh();
    }
  }

  async refresh(): Promise<void> {
    const r = await this.api("/api/tasks?limit=100");
    if (!r.ok) return;
    const { tasks } = (await r.json()) as { tasks: Task[] };
    this.renderColumns(tasks);
  }

  private renderColumns(tasks: Task[]): void {
    const list = this.root?.querySelector("#boardList") as HTMLElement;
    if (!list) return;
    list.innerHTML = COLUMNS.map((col) => {
      const items = tasks.filter((t) => col.statuses.includes(t.status));
      const cards = items.map((t) => this.card(t)).join("");
      return `
        <div class="board-col">
          <div class="board-col-head">${col.label} <span>${items.length}</span></div>
          <div class="board-col-body">${cards}</div>
        </div>`;
    }).join("");

    list.querySelectorAll<HTMLElement>(".board-card").forEach((el) => {
      el.onclick = () => this.openTask(el.dataset.id!);
    });
  }

  private card(t: Task): string {
    const title = t.repo ? esc(t.repo) : "no repo";
    const pr = t.prUrl ? ' <span class="pill pr">PR</span>' : "";
    return `
      <div class="board-card status-${t.status}" data-id="${t.id}">
        <div class="board-card-top">
          <span class="mono">${t.id.slice(0, 8)}</span>
          <span class="pill">${t.status}</span>${pr}
        </div>
        <div class="board-card-repo">${title}</div>
        <div class="board-card-prompt">${esc(t.prompt.slice(0, 100))}</div>
      </div>`;
  }

  private async openTask(id: string): Promise<void> {
    this.openTaskId = id;
    this.liveText = "";
    const r = await this.api(`/api/tasks/${id}`);
    if (!r.ok) return;
    const t = (await r.json()) as Task;

    const list = this.root?.querySelector("#boardList") as HTMLElement;
    const detail = this.root?.querySelector("#boardDetail") as HTMLElement;
    list.style.display = "none";
    detail.style.display = "block";

    const canAbort = t.status === "running" || t.status === "review";
    detail.innerHTML = `
      <div class="bd-head">
        <button id="bdBack">&larr; Board</button>
        <span class="pill">${t.status}</span>
        ${t.prUrl ? `<a class="bd-pr" href="${t.prUrl}" target="_blank" rel="noreferrer">Open PR &nearr;</a>` : ""}
        ${canAbort ? `<button id="bdAbort" class="bd-abort">Abort</button>` : ""}
      </div>
      <div class="bd-meta">
        <span class="mono">${t.id}</span>
        ${t.repo ? `&middot; ${esc(t.repo)}` : ""}
        ${t.model ? `&middot; ${esc(t.model)}` : ""}
      </div>
      <div class="bd-prompt">${esc(t.prompt)}</div>
      <div class="bd-cols">
        <div class="bd-timeline" id="bdTimeline"></div>
        <div class="bd-live"><pre id="bdLive"></pre></div>
      </div>
      ${t.diff ? `<details class="bd-diff"><summary>Diff</summary><pre>${esc(t.diff)}</pre></details>` : ""}
      ${t.error ? `<div class="bd-error">${esc(t.error)}</div>` : ""}`;

    (detail.querySelector("#bdBack") as HTMLButtonElement).onclick = () =>
      this.backToList();
    const abortBtn = detail.querySelector("#bdAbort") as HTMLButtonElement | null;
    if (abortBtn) {
      abortBtn.onclick = async () => {
        abortBtn.disabled = true;
        await this.api(`/api/tasks/${id}/abort`, { method: "POST" });
      };
    }

    this.openStream(id);
  }

  private backToList(): void {
    this.openTaskId = null;
    this.closeStream();
    const list = this.root?.querySelector("#boardList") as HTMLElement;
    const detail = this.root?.querySelector("#boardDetail") as HTMLElement;
    if (detail) detail.style.display = "none";
    if (list) list.style.display = "grid";
    this.refresh();
  }

  private openStream(id: string): void {
    this.closeStream();
    const wsUrl =
      this.serverUrl.replace(/^http/, "ws") +
      `/api/tasks/${id}/stream?token=${encodeURIComponent(this.token)}`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;
    ws.onmessage = (ev) => {
      try {
        this.onStreamEvent(JSON.parse(ev.data));
      } catch {
        // ignore malformed frames
      }
    };
  }

  private closeStream(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  private onStreamEvent(event: any): void {
    // Live streaming text from the agent.
    if (
      event?.type === "message_update" &&
      event.assistantMessageEvent?.type === "text_delta"
    ) {
      this.liveText += event.assistantMessageEvent.delta;
      const live = this.root?.querySelector("#bdLive") as HTMLElement | null;
      if (live) {
        live.textContent = this.liveText;
        live.scrollTop = live.scrollHeight;
      }
      return;
    }

    // Persisted milestone events (shape: { type, payload, ts }).
    if (typeof event?.type === "string" && MILESTONES.has(event.type)) {
      const tl = this.root?.querySelector("#bdTimeline") as HTMLElement | null;
      if (!tl) return;
      const line = document.createElement("div");
      line.className = "bd-event";
      const detail =
        event.payload && typeof event.payload === "object"
          ? esc(JSON.stringify(event.payload))
          : "";
      line.innerHTML = `<span class="bd-event-type">${esc(event.type)}</span> ${detail}`;
      tl.appendChild(line);
      tl.scrollTop = tl.scrollHeight;

      // A terminal status closes the live stream and refreshes meta.
      if (
        event.type === "status" &&
        ["done", "aborted"].includes(event.payload?.status)
      ) {
        this.closeStream();
      }
    }
  }
}
