/**
 * Agent Hive UI — Main entry point
 *
 * Custom chat UI with streaming via WebSocket + REST API.
 * GitHub panel for repo browsing.
 * Token-based auth.
 */

import { HiveAgentProxy } from "./hive-agent.js";
import { GitHubPanel } from "./github-panel.js";
import { BoardPanel } from "./board.js";
import { registerComponents } from "./components.js";
import { icons } from "./icons.js";

registerComponents();

const STORAGE_KEY = "hive_token";

// ---- Helpers ----
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const serverUrl = window.location.origin;
let token = localStorage.getItem(STORAGE_KEY) || "";
let user: { name: string } | null = null;
let agent: HiveAgentProxy | null = null;
let ghPanel: GitHubPanel | null = null;
let boardPanel: BoardPanel | null = null;
let currentTab = "chat";

function api(path: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(`${serverUrl}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...opts.headers },
  });
}

// ---- Auth ----
async function validateToken(): Promise<boolean> {
  try { return (await fetch(`${serverUrl}/health`)).ok; } catch { return false; }
}

async function loadUser() {
  try { const r = await api("/api/user"); if (r.ok) user = await r.json(); } catch { user = null; }
}

async function doLogin() {
  const t = ($("tokenInput") as HTMLInputElement).value.trim();
  if (!t) return;
  token = t;
  if (!(await validateToken())) { $("tokenError").classList.add("visible"); return; }
  localStorage.setItem(STORAGE_KEY, token);
  await loadUser();
  renderApp();
}

function doLogout() { localStorage.removeItem(STORAGE_KEY); location.reload(); }

// ---- Chat ----
let streamingEl: HTMLElement | null = null;
let streamingBuffer = "";

function addMessage(role: string, text: string, cls = "") {
  const area = $("chatMessages");
  const div = document.createElement("div");
  div.className = `msg ${role} ${cls}`;
  div.innerHTML = formatContent(text);
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
  return div;
}

function formatContent(text: string): string {
  // Escape HTML first
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Code blocks
  return escaped
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br>");
}

async function sendChat() {
  const input = $("chatInput") as HTMLTextAreaElement;
  const btn = $("sendBtn") as HTMLButtonElement;
  const text = input.value.trim();
  if (!text || !agent) return;

  input.value = "";
  input.style.height = "42px";
  btn.disabled = true;

  addMessage("user", text);

  // Create streaming placeholder
  const area = $("chatMessages");
  streamingEl = document.createElement("div");
  streamingEl.className = "msg assistant streaming";
  area.appendChild(streamingEl);
  streamingBuffer = "";

  let done = false;
  const unsub = agent.subscribe((event: any) => {
    if (done) return;
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      streamingBuffer += event.assistantMessageEvent.delta;
      if (streamingEl) streamingEl.innerHTML = formatContent(streamingBuffer);
      area.scrollTop = area.scrollHeight;
    }
    if (event.type === "agent_end" || event.type === "turn_end" || event.type === "error") {
      done = true;
      if (streamingEl) {
        streamingEl.classList.remove("streaming");
        if (!streamingBuffer) streamingEl.innerHTML = formatContent(event.error || "No response");
      }
      streamingEl = null;
      btn.disabled = false;
      unsub();
    }
  });

  try {
    await agent.prompt(text);
  } catch (e: any) {
    if (!done) {
      if (streamingEl) streamingEl.innerHTML = `<span class="error">Error: ${e.message}</span>`;
      streamingEl = null;
      btn.disabled = false;
      unsub();
    }
  }
}

function handleChatKey(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
  const ta = e.target as HTMLTextAreaElement;
  ta.style.height = "42px";
  ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
}

// ---- Tabs ----
function switchTab(tab: string) {
  currentTab = tab;
  document.querySelectorAll(".rail-btn").forEach(b => b.classList.toggle("active", (b as HTMLElement).dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", (p as HTMLElement).dataset.tab === tab));
  if (tab === "github" && ghPanel) { ghPanel.refresh(); }
  if (boardPanel) { tab === "board" ? boardPanel.start() : boardPanel.stop(); }
}

// ---- Token Gate ----
function renderTokenGate() {
  ($("app")!).innerHTML = `
    <div class="token-gate">
      <div class="token-gate-inner">
        <div class="hero">
          <hive-orb size="120"></hive-orb>
          <h2>Agent Hive</h2>
        </div>
        <div class="token-gate-form">
          <input type="password" id="tokenInput" placeholder="hive_token_…" autofocus
                 onkeydown="if(event.key==='Enter')window._login()">
          <hive-button variant="solid" full onclick="window._login()">Connect</hive-button>
          <div class="token-error" id="tokenError">Invalid token</div>
        </div>
      </div>
    </div>`;
  (window as any)._login = doLogin;
}

// ---- Render ----
async function renderApp() {
  if (!token) { renderTokenGate(); return; }
  if (!(await validateToken())) { localStorage.removeItem(STORAGE_KEY); token = ""; renderTokenGate(); return; }
  await loadUser();

  agent = new HiveAgentProxy({ serverUrl, token });
  ghPanel = new GitHubPanel(token, serverUrl);
  boardPanel = new BoardPanel(token, serverUrl);
  (window as any)._ghPanel = ghPanel;
  (window as any)._switchTab = switchTab;
  (window as any)._logout = doLogout;

  const app = $("app")!;
  const initial = (user?.name || "U").trim().slice(0, 1).toUpperCase();
  app.innerHTML = `
    <div class="shell">
      <nav class="rail">
        <div class="rail-brand" title="Agent Hive"></div>
        <button class="rail-btn active" data-tab="chat" title="Chat" onclick="_switchTab('chat')">${icons.chat(20)}</button>
        <button class="rail-btn" data-tab="github" title="GitHub" onclick="_switchTab('github')">${icons.github(20)}</button>
        <button class="rail-btn" data-tab="board" title="Board" onclick="_switchTab('board')">${icons.board(20)}</button>
        <div class="rail-spacer"></div>
        <div class="rail-avatar" title="${user?.name || "User"}">${initial}</div>
        <button class="rail-logout" title="Logout" onclick="_logout()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg></button>
      </nav>
      <div class="workarea">
      <div class="main">
      <!-- Chat Tab -->
      <div class="tab-panel active" data-tab="chat" id="chatPanel">
        <div class="chat-area">
          <div class="chat-empty"><hive-orb size="76"></hive-orb><p>Ask anything, or dispatch an agent to a repo.</p></div>
          <div id="chatMessages"></div>
        </div>
        <div class="chat-input-bar">
          <div class="chat-controls">
            <hive-select id="modelSelect">
              <option value="">Model: Default</option>
              <option value="deepseek-chat">DeepSeek Chat</option>
              <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
              <option value="claude-sonnet-4-5-20250929">Claude Sonnet 4</option>
            </hive-select>
            <hive-select id="thinkingSelect">
              <option value="">Thinking: Auto</option>
              <option value="off">Off</option>
              <option value="minimal">Minimal</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
            </hive-select>
          </div>
          <div class="chat-input-row">
            <textarea id="chatInput" placeholder="Send a message... (Enter to send, Shift+Enter for new line)"
                      onkeydown="window._chatKey(event)" rows="1"></textarea>
            <hive-button variant="solid" id="sendBtn" onclick="_sendChat()"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg> Send</hive-button>
          </div>
        </div>
      </div>

      <!-- Board Tab -->
      <div class="tab-panel" data-tab="board">
        <div class="board-root" id="boardRoot"></div>
      </div>

      <!-- GitHub Tab -->
      <div class="tab-panel" data-tab="github">
        <div class="gh-layout">
          <div class="gh-sidebar">
            <div class="gh-sidebar-header">
              <div class="gh-mode-toggle">
                <button class="gh-mode-btn active" id="modeMine" onclick="_ghPanel.setMode('mine')">My Repos</button>
                <button class="gh-mode-btn" id="modeSearch" onclick="_ghPanel.setMode('search')">Search</button>
              </div>
              <input type="text" id="repoFilter" placeholder="Filter repos..." oninput="_ghPanel.onFilterInput()">
            </div>
            <div class="gh-repo-list" id="repoList"></div>
            <div class="gh-actions" id="ghActions">
              <button onclick="_ghPanel.refresh()">${icons.refresh(14)} Refresh</button>
            </div>
          </div>
          <div class="gh-main">
            <div class="gh-toolbar">
              <strong id="ghRepoName">Select a repo</strong>
              <span class="branch" id="ghBranch"></span>
              <span class="status" id="ghStatus"></span>
            </div>
            <div id="ghEmpty" class="gh-empty">Select a repository from the sidebar</div>
            <div id="ghContent" style="display:none;flex-direction:column;flex:1;overflow:hidden;">
              <div class="gh-files" id="ghFiles"></div>
            </div>
            <div class="gh-log" id="ghLog" style="display:none;"></div>
          </div>
        </div>
        <!-- Commit Modal -->
        <div class="modal-overlay" id="commitModal">
          <div class="modal">
            <h3>Commit & Push</h3>
            <input type="text" id="commitMsg" placeholder="Commit message" maxlength="200">
            <div class="modal-btns">
              <button class="cancel" onclick="_ghPanel.closeCommitModal()">Cancel</button>
              <button class="confirm" onclick="_ghPanel.confirmPush()">Push</button>
            </div>
          </div>
        </div>
      </div>
        </div>
      </div>
    </div>`;

  (window as any)._chatKey = handleChatKey;
  (window as any)._sendChat = sendChat;
  ghPanel.refresh();
  boardPanel.mount($("boardRoot"));

  // Focus chat input
  setTimeout(() => ($("chatInput") as HTMLTextAreaElement)?.focus(), 100);
}

renderApp();
