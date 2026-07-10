// Lightweight styled replacements for native alert/confirm/prompt.
// Zero deps, reuse the .modal / .modal-overlay CSS already in index.html.

export function toast(message: string, type: "error" | "info" = "info", ms = 4000): void {
  let host = document.getElementById("toastHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "toastHost";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 220);
  }, ms);
}

function overlay(html: string): { root: HTMLElement; close: () => void } {
  const root = document.createElement("div");
  root.className = "modal-overlay active";
  root.innerHTML = `<div class="modal">${html}</div>`;
  document.body.appendChild(root);
  const close = () => root.remove();
  root.addEventListener("mousedown", (e) => { if (e.target === root) close(); });
  return { root, close };
}

export function confirmDialog(message: string, confirmLabel = "Confirm"): Promise<boolean> {
  return new Promise((resolve) => {
    const { root, close } = overlay(`
      <h3>${message}</h3>
      <div class="modal-btns">
        <button class="cancel" data-act="cancel">Cancel</button>
        <button class="confirm" data-act="ok">${confirmLabel}</button>
      </div>`);
    const done = (v: boolean) => { close(); resolve(v); };
    root.querySelector('[data-act="cancel"]')!.addEventListener("click", () => done(false));
    root.querySelector('[data-act="ok"]')!.addEventListener("click", () => done(true));
    root.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Escape") done(false); });
  });
}

export function promptDialog(title: string, placeholder = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const { root, close } = overlay(`
      <h3>${title}</h3>
      <input type="text" id="__promptInput" placeholder="${placeholder}">
      <div class="modal-btns">
        <button class="cancel" data-act="cancel">Cancel</button>
        <button class="confirm" data-act="ok">OK</button>
      </div>`);
    const input = root.querySelector("#__promptInput") as HTMLInputElement;
    input.focus();
    const ok = () => { close(); resolve(input.value.trim() || null); };
    const cancel = () => { close(); resolve(null); };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") ok();
      if (e.key === "Escape") cancel();
    });
    root.querySelector('[data-act="cancel"]')!.addEventListener("click", cancel);
    root.querySelector('[data-act="ok"]')!.addEventListener("click", ok);
  });
}
