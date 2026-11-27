import type { OverlayConfig } from "./index";

export type Status = "open" | "in_progress" | "done" | "later" | "kept";

/** One row of plan 1's GET /api/me/pages/comments. */
export type PageComment = {
  id: string;
  body: string;
  status: Status;
  note: string | null;
  pr_url: string | null;
  selector: string | null;
  element_text: string | null;
  element_x: number | null;
  element_y: number | null;
  page_x: number | null;
  page_y: number | null;
  created_at: string;
  /** The id the comment layer gave it on the phone (offline mode); null for older comments. */
  client_id?: string | null;
};

export type PageCommentsResult =
  | { kind: "ok"; assignment_id: string; comments: PageComment[] }
  | { kind: "not_assigned" }
  | { kind: "signed_out" }
  /** No answer, or the service failed: offline mode carries on from what the phone kept. */
  | { kind: "offline" };

const auth = (cfg: OverlayConfig) => ({ Authorization: `Bearer ${cfg.token}` });

export async function fetchPageComments(cfg: OverlayConfig, path: string): Promise<PageCommentsResult> {
  const q = new URLSearchParams({ site: cfg.site, path });
  try {
    const res = await fetch(`${cfg.base}/api/me/pages/comments?${q}`, { headers: auth(cfg), credentials: "omit" });
    if (res.status === 404) return { kind: "not_assigned" };
    if (res.status === 401) return { kind: "signed_out" };
    if (!res.ok) return { kind: "offline" };
    const json = (await res.json()) as { assignment_id: string; comments: PageComment[] };
    return { kind: "ok", assignment_id: json.assignment_id, comments: Array.isArray(json.comments) ? json.comments : [] };
  } catch {
    return { kind: "offline" };
  }
}

/** A save that hasn't answered by now counts as failed, so the reviewer is never stuck on "Saving…". */
export const SAVE_TIMEOUT_MS = 30_000;

export async function postComment(
  cfg: OverlayConfig,
  data: object,
  shot: Blob | null,
): Promise<{ ok: true; id: string } | { ok: false; status?: number }> {
  // A plain timer (not AbortSignal.timeout) so the abort follows the page clock.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), SAVE_TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append("data", JSON.stringify(data));
    if (shot) form.append("screenshot", shot, shot.type === "image/webp" ? "shot.webp" : "shot.jpg");
    const res = await fetch(`${cfg.base}/api/me/comments`, {
      method: "POST",
      headers: auth(cfg),
      body: form,
      credentials: "omit",
      signal: abort.signal,
    });
    if (!res.ok) return { ok: false, status: res.status };
    const json = (await res.json()) as { id?: unknown };
    return typeof json.id === "string" ? { ok: true, id: json.id } : { ok: false };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}
