// Helpers shared by the reviewer (/r/) and owner (/o/) dashboards.

/** `error` is the service's own `{ "error": "..." }` message, when it sent one; `code` its machine-readable reason. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error?: string; code?: string };

/** Hash first (and remember it), then storage. All storage access is guarded. */
export function readToken(win: Window, hashKey: "ttf" | "owner", storageKey: string): string | null {
  const m = new RegExp("(?:^#|&)" + hashKey + "=([^&]*)").exec(win.location.hash);
  let fromHash: string | null = null;
  if (m) {
    try {
      fromHash = decodeURIComponent(m[1]) || null;
    } catch {
      fromHash = m[1] || null;
    }
  }
  if (fromHash) {
    try {
      win.localStorage.setItem(storageKey, fromHash);
    } catch {
      /* storage blocked: the hash token still works for this visit */
    }
    return fromHash;
  }
  try {
    return win.localStorage.getItem(storageKey) || null;
  } catch {
    return null;
  }
}

/** Same-origin call with a Bearer token. Network failure resolves to status 0. */
export async function api<T>(
  token: string,
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<ApiResult<T>> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("Authorization", "Bearer " + token);
  let body = rest.body;
  if (json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }
  try {
    const res = await fetch(path, { ...rest, headers, body });
    if (!res.ok) {
      let error: unknown;
      let code: unknown;
      try {
        const body = (await res.json()) as { error?: unknown; code?: unknown } | null;
        error = body?.error;
        code = body?.code;
      } catch {
        /* not JSON */
      }
      return {
        ok: false,
        status: res.status,
        ...(typeof error === "string" && error ? { error } : {}),
        ...(typeof code === "string" && code ? { code } : {}),
      };
    }
    const text = await res.text();
    return { ok: true, data: (text ? JSON.parse(text) : null) as T };
  } catch {
    return { ok: false, status: 0 };
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Monochrome SVG ring: track in --line, arc in --acc. */
export function progressRing(fraction: number, size = 36): string {
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  const pct = Math.round(f * 100);
  const sw = 4;
  const r = (size - sw) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  let arc = "";
  if (f >= 1) {
    arc = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--acc)" stroke-width="${sw}"/>`;
  } else if (f > 0) {
    arc =
      `<path d="M ${c} ${sw / 2} A ${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ` +
      `${(c + r * Math.sin(2 * Math.PI * f)).toFixed(3)} ${(c - r * Math.cos(2 * Math.PI * f)).toFixed(3)}" ` +
      `fill="none" stroke="var(--acc)" stroke-width="${sw}" stroke-linecap="round" data-len="${circ.toFixed(1)}"/>`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${pct}% settled">` +
    `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${sw}"/>` +
    arc +
    `</svg>`
  );
}
