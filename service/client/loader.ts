import type { OverlayConfig } from "./overlay/index";

type Overlay = { start(c: OverlayConfig): void | Promise<void> };
const KEY = "ttf:token";

/** Splits "ttf=…" out of a "?a&b" or "#a&b" string. Other parts are kept byte for byte. */
function pull(s: string): { token: string | null; rest: string } {
  let token: string | null = null;
  const rest = s
    .slice(1)
    .split("&")
    .filter((p) => (p.slice(0, 4) === "ttf=" ? ((token = p.slice(4)), false) : p !== ""));
  return { token, rest: rest.join("&") };
}

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
  // The fragment is preferred: browsers never send it to the host's server, logs or Referer.
  const hash = pull(loc.hash);
  const query = pull(loc.search);
  let token = hash.token || query.token;
  if (hash.token !== null || query.token !== null) {
    win.history.replaceState(
      win.history.state,
      "",
      loc.pathname + (query.rest ? "?" + query.rest : "") + (hash.rest ? "#" + hash.rest : ""),
    );
  }
  if (token) {
    try {
      store()?.setItem(KEY, token);
    } catch {}
  } else {
    // No ttf=, or an empty one: use the token saved earlier in this visit, if any.
    token = null;
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
