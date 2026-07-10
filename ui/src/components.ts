/**
 * Native Web Component primitives for Agent Hive UI.
 *
 * Zero dependencies — pure Custom Elements + Shadow DOM. Theme tokens
 * (--accent, --bg3, …) inherit through the shadow boundary, so components
 * stay in sync with the global design system in index.html.
 *
 * Primitives: <hive-orb> <hive-button> <hive-pill> <hive-card> <hive-tabs>
 */

const css = (s: string) => s;

/* ---------------------------------------------------------------- Orb ---- */
class HiveOrb extends HTMLElement {
  static observedAttributes = ["size", "active"];
  attributeChangedCallback() { if (this.shadowRoot) this.render(); }
  connectedCallback() { this.render(); }

  private render() {
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    const size = this.getAttribute("size") || "120";
    const active = this.hasAttribute("active") ? "active" : "";
    root.innerHTML = `
      <style>
        :host { display: inline-grid; place-items: center; }
        .orb { position: relative; width: ${size}px; height: ${size}px; display: grid; place-items: center; }
        .orb > * { position: absolute; border-radius: 50%; inset: 0; }
        .core {
          background: radial-gradient(circle at 36% 30%, #bfdbfe 0%, #3b82f6 40%, #1d4ed8 72%, #0b2a6b 100%);
          box-shadow: 0 0 42px rgba(59,130,246,.4), inset 0 0 30px rgba(191,219,254,.45);
          animation: breathe 5.5s cubic-bezier(.22,1,.36,1) infinite;
        }
        .ring {
          inset: -9%;
          background: conic-gradient(from 0deg, rgba(96,165,250,.55), rgba(167,139,250,.4), rgba(59,130,246,.55), rgba(96,165,250,.55));
          -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px));
          mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px));
          opacity: .65; animation: spin 16s linear infinite;
        }
        .ring2 { inset: -18%; opacity: .35; animation-duration: 26s; animation-direction: reverse; }
        .spark { inset: 20%; background: radial-gradient(circle at 40% 34%, rgba(255,255,255,.7), transparent 46%); mix-blend-mode: screen; animation: breathe 5.5s cubic-bezier(.22,1,.36,1) infinite; }
        .active .core { animation: pulse 1.5s cubic-bezier(.22,1,.36,1) infinite; }
        .active .ring { animation-duration: 7s; opacity: .9; }
        @keyframes breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.045); } }
        @keyframes pulse { 0%,100% { transform: scale(1); filter: brightness(1); } 50% { transform: scale(1.09); filter: brightness(1.16); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
      </style>
      <div class="orb ${active}">
        <div class="ring ring2"></div><div class="ring"></div><div class="core"></div><div class="spark"></div>
      </div>`;
  }
}

/* ------------------------------------------------------------- Button ---- */
class HiveButton extends HTMLElement {
  static observedAttributes = ["variant", "disabled", "full"];
  get disabled() { return this.hasAttribute("disabled"); }
  set disabled(v: boolean) { v ? this.setAttribute("disabled", "") : this.removeAttribute("disabled"); }
  attributeChangedCallback() { if (this.shadowRoot) this.render(); }
  connectedCallback() { this.render(); }

  private render() {
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    const variant = this.getAttribute("variant") || "solid";
    root.innerHTML = `
      <style>
        :host { display: inline-flex; }
        :host([full]) { display: flex; width: 100%; }
        :host([disabled]) { pointer-events: none; opacity: .45; }
        button {
          display: inline-flex; align-items: center; justify-content: center; gap: 7px;
          width: 100%; border: none; border-radius: var(--r-pill, 999px);
          padding: 11px 20px; font: inherit; font-size: 14px; font-weight: 500;
          cursor: pointer; white-space: nowrap;
          transition: all .16s cubic-bezier(.22,1,.36,1);
        }
        .solid { background: var(--accent, #3b82f6); color: #fff; }
        .solid:hover { background: var(--accent-hover, #5295f7); }
        .ghost { background: var(--surface, rgba(255,255,255,.04)); color: var(--text2, #8b99b0); }
        .ghost:hover { background: var(--surface-2, rgba(255,255,255,.07)); color: var(--text, #e7ecf3); }
        .subtle { background: var(--bg3, #161f33); color: var(--text, #e7ecf3); }
        .subtle:hover { background: var(--bg4, #1f2a40); }
        ::slotted(svg) { flex-shrink: 0; }
      </style>
      <button class="${variant}"><slot></slot></button>`;
  }
}

/* --------------------------------------------------------------- Pill ---- */
class HivePill extends HTMLElement {
  static observedAttributes = ["tone"];
  attributeChangedCallback() { if (this.shadowRoot) this.render(); }
  connectedCallback() { this.render(); }

  private render() {
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    const tone = this.getAttribute("tone") || "neutral";
    const tones: Record<string, string> = {
      neutral: "background:var(--surface,rgba(255,255,255,.04));color:var(--text2,#8b99b0);",
      accent: "background:var(--accent-soft,rgba(59,130,246,.13));color:var(--accent2,#60a5fa);",
      green: "background:rgba(52,211,153,.16);color:var(--green,#34d399);",
      red: "background:rgba(248,113,113,.14);color:var(--red,#f87171);",
      amber: "background:rgba(251,191,36,.16);color:var(--orange,#fbbf24);",
      purple: "background:rgba(167,139,250,.16);color:var(--purple,#a78bfa);",
    };
    root.innerHTML = `
      <style>
        :host { display: inline-flex; }
        .pill {
          display: inline-flex; align-items: center; gap: 5px;
          border-radius: var(--r-pill, 999px); padding: 2px 9px;
          font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: .04em;
          ${tones[tone] || tones.neutral}
        }
      </style>
      <span class="pill"><slot></slot></span>`;
  }
}

/* --------------------------------------------------------------- Card ---- */
class HiveCard extends HTMLElement {
  connectedCallback() {
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { display: block; }
        .card {
          background: var(--bg3, #161f33); border-radius: var(--r-lg, 16px);
          padding: 16px;
          transition: background .15s cubic-bezier(.22,1,.36,1);
        }
        :host([interactive]) .card { cursor: pointer; }
        :host([interactive]) .card:hover { background: var(--bg4, #1f2a40); }
      </style>
      <div class="card"><slot></slot></div>`;
  }
}

/* --------------------------------------------------------------- Tabs ---- */
/**
 * <hive-tabs active="chat">
 *   <button value="chat">Chat</button> …
 * </hive-tabs>
 * Emits a `change` CustomEvent({ detail: value }) on click.
 */
class HiveTabs extends HTMLElement {
  static observedAttributes = ["active"];
  attributeChangedCallback() { this.sync(); }
  connectedCallback() {
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { display: inline-flex; }
        .wrap { display: flex; gap: 3px; background: var(--surface, rgba(255,255,255,.04)); border-radius: var(--r-pill, 999px); padding: 4px; }
        ::slotted(button) {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 7px 16px; border-radius: var(--r-pill, 999px); border: none; background: transparent;
          color: var(--text2, #8b99b0); cursor: pointer; font: inherit; font-size: 13px; font-weight: 450;
          transition: all .16s cubic-bezier(.22,1,.36,1);
        }
        ::slotted(button:hover) { color: var(--text, #e7ecf3); }
        ::slotted(button[aria-selected="true"]) { background: var(--bg4, #1f2a40); color: var(--text, #e7ecf3); }
      </style>
      <div class="wrap"><slot></slot></div>`;
    this.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest("button");
      if (!btn) return;
      const value = btn.getAttribute("value");
      if (value) { this.setAttribute("active", value); this.dispatchEvent(new CustomEvent("change", { detail: value })); }
    });
    this.sync();
  }
  private sync() {
    const active = this.getAttribute("active");
    this.querySelectorAll("button").forEach((b) =>
      b.setAttribute("aria-selected", String(b.getAttribute("value") === active)));
  }
}

/* ------------------------------------------------------------- Select ---- */
/**
 * <hive-select value="">
 *   <option value="">Model: Default</option> …
 * </hive-select>
 * Custom dropdown replacing the native <select>. Exposes `.value`, emits
 * `change`. Closes on outside-click / Escape.
 */
class HiveSelect extends HTMLElement {
  private open = false;
  private opts: { value: string; label: string }[] = [];
  get value() { return this.getAttribute("value") || ""; }
  set value(v: string) { this.setAttribute("value", v); this.renderState(); }

  connectedCallback() {
    this.opts = Array.from(this.querySelectorAll("option")).map((o) => ({
      value: o.getAttribute("value") || "",
      label: o.textContent || "",
    }));
    if (!this.hasAttribute("value") && this.opts[0]) this.setAttribute("value", this.opts[0].value);
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { display: inline-flex; position: relative; }
        .trigger {
          display: inline-flex; align-items: center; gap: 8px;
          background: var(--surface, rgba(255,255,255,.04)); border: none;
          border-radius: var(--r-pill, 999px); color: var(--text2, #8b99b0);
          padding: 6px 12px; font: inherit; font-size: 12px; cursor: pointer;
          transition: all .16s cubic-bezier(.22,1,.36,1);
        }
        .trigger:hover { background: var(--surface-2, rgba(255,255,255,.07)); color: var(--text, #e7ecf3); }
        .trigger.open { outline: 2px solid var(--accent2, #60a5fa); outline-offset: 2px; color: var(--text, #e7ecf3); }
        .caret { width: 13px; height: 13px; transition: transform .16s; }
        .trigger.open .caret { transform: rotate(180deg); }
        .menu {
          position: absolute; bottom: calc(100% + 6px); left: 0; min-width: 100%;
          background: var(--bg4, #1f2a40); border-radius: var(--r, 12px);
          outline: 1px solid var(--hairline, rgba(148,178,224,.10)); padding: 5px;
          display: none; flex-direction: column; gap: 2px; z-index: 50; white-space: nowrap;
        }
        .menu.open { display: flex; animation: pop .16s cubic-bezier(.22,1,.36,1); }
        @keyframes pop { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
        .opt {
          text-align: left; background: transparent; border: none; color: var(--text2, #8b99b0);
          padding: 8px 12px; border-radius: var(--r-sm, 8px); font: inherit; font-size: 13px; cursor: pointer;
          transition: background .12s;
        }
        .opt:hover { background: var(--surface, rgba(255,255,255,.05)); color: var(--text, #e7ecf3); }
        .opt[aria-selected="true"] { color: var(--accent2, #60a5fa); }
      </style>
      <button class="trigger" type="button">
        <span class="label"></span>
        <svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <div class="menu">${this.opts.map((o) => `<button class="opt" data-v="${o.value}">${o.label}</button>`).join("")}</div>`;

    const trigger = root.querySelector(".trigger") as HTMLElement;
    trigger.addEventListener("click", (e) => { e.stopPropagation(); this.toggle(); });
    root.querySelectorAll(".opt").forEach((el) =>
      el.addEventListener("click", () => {
        this.value = (el as HTMLElement).dataset.v || "";
        this.close();
        this.dispatchEvent(new CustomEvent("change", { detail: this.value }));
      }));
    document.addEventListener("click", () => this.close());
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") this.close(); });
    this.renderState();
  }

  private toggle() { this.open ? this.close() : this.openMenu(); }
  private openMenu() {
    this.open = true;
    this.shadowRoot!.querySelector(".trigger")!.classList.add("open");
    this.shadowRoot!.querySelector(".menu")!.classList.add("open");
  }
  private close() {
    if (!this.open) return;
    this.open = false;
    this.shadowRoot?.querySelector(".trigger")?.classList.remove("open");
    this.shadowRoot?.querySelector(".menu")?.classList.remove("open");
  }
  private renderState() {
    if (!this.shadowRoot) return;
    const cur = this.opts.find((o) => o.value === this.value) || this.opts[0];
    const label = this.shadowRoot.querySelector(".label");
    if (label && cur) label.textContent = cur.label;
    this.shadowRoot.querySelectorAll(".opt").forEach((el) =>
      el.setAttribute("aria-selected", String((el as HTMLElement).dataset.v === this.value)));
  }
}

export function registerComponents(): void {
  if (customElements.get("hive-orb")) return;
  customElements.define("hive-orb", HiveOrb);
  customElements.define("hive-button", HiveButton);
  customElements.define("hive-pill", HivePill);
  customElements.define("hive-card", HiveCard);
  customElements.define("hive-tabs", HiveTabs);
  customElements.define("hive-select", HiveSelect);
}
