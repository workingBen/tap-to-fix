import type { OverlayConfig } from "./overlay/index";

type Overlay = { start(c: OverlayConfig): void | Promise<void> };
const KEY = "ttf:token";

export function boot(doc: Document, win: Window, load: (url: string) => Promise<Overlay>): boolean {
  const el = (doc.currentScript as HTMLScriptElement | null) ?? doc.querySelector<HTMLScriptElement>('script[src$="/t.js"][data-site]');
  const site = el?.getAttribute("data-site");
  if (!el || !site) return false;
  const store = (): Storage | null => {
    try {
      return win.sessionStorage;
    } catch {
      return null;
    }
  };
  const loc = win.location;
  const params = new URLSearchParams(loc.search);
  let token = params.get("ttf");
  if (token) {
    try {
      store()?.setItem(KEY, token);
    } catch {}
    params.delete("ttf");
    const q = params.toString();
    win.history.replaceState(win.history.state, "", loc.pathname + (q ? "?" + q : "") + loc.hash);
  } else {
    try {
      token = store()?.getItem(KEY) ?? null;
    } catch {}
  }
  if (!token) return false;
  const base = new URL(el.src, loc.href).origin;
  const config: OverlayConfig = { base, site, token, dashboardUrl: base + "/r/#ttf=" + token };
  load(base + "/overlay.js").then((m) => m.start(config), () => {});
  return true;
}
