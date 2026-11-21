import { fetchPageComments, postComment, type PageComment } from "./api";
import { describeElement, findPin, locatorFor, type Locator } from "./locate";
import { takeScreenshot } from "./shot";
import { isSettled, OverlayUI, type PinView } from "./ui";

/** How long Save waits for the screenshot before sending the comment without it. */
const SHOT_WAIT_MS = 12_000;
const SAVED_NOTICE_MS = 3_000;
const SAVE_FAILED = "Couldn't save. Check your connection and try again.";

/** The screenshot, or null if it isn't ready in time (it never rejects, but may be slow). */
function shotWithin(shot: Promise<Blob | null>, ms: number): Promise<Blob | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([shot.catch(() => null), late]).finally(() => clearTimeout(timer));
}

export type OverlayConfig = { base: string; site: string; token: string; dashboardUrl: string };

export type Device = "phone" | "tablet" | "desktop";
export const deviceFor = (width: number): Device => (width < 768 ? "phone" : width < 1024 ? "tablet" : "desktop");

/** An unsaved comment: where it is, and the screenshot already being taken. */
export type Draft = {
  n: number;
  locator: Locator;
  shot: Promise<Blob | null>;
  viewport_w: number;
  viewport_h: number;
  device: Device;
};

export async function start(config: OverlayConfig): Promise<void> {
  const doc = document;
  const win = window;
  if (doc.querySelector("tap-to-fix-overlay")) return; // already running
  const ui = new OverlayUI(doc, config.dashboardUrl);
  ui.setBar({ kind: "loading" });

  const path = win.location.pathname;
  const result = await fetchPageComments(config, path);
  if (result.kind !== "ok") {
    // Not assigned, signed out or offline: say so, and let every tap through to the page.
    ui.setBar(result);
    return;
  }

  const comments: PageComment[] = result.comments;
  let draft: Draft | null = null;
  let placed: (PinView & { comment: PageComment })[] = [];

  const render = () => {
    placed = [];
    comments.forEach((c, i) => {
      const at = findPin(doc, c);
      if (at) placed.push({ n: i + 1, x: at.x, y: at.y, moved: at.moved, settled: isSettled(c.status), comment: c });
    });
    const pins: PinView[] = [...placed];
    if (draft) pins.push({ n: draft.n, x: draft.locator.page_x, y: draft.locator.page_y, draft: true });
    ui.setPins(pins);
  };
  let savedUntil = 0;
  let savedTimer: ReturnType<typeof setTimeout> | undefined;
  const updateBar = () => ui.setBar({ kind: "reviewing", count: comments.length, saved: Date.now() < savedUntil });
  const flashSaved = () => {
    savedUntil = Date.now() + SAVED_NOTICE_MS;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(updateBar, SAVED_NOTICE_MS);
    updateBar();
  };

  ui.onPinTap = (n) => {
    if (draft) return; // never throw away text being typed
    const p = placed.find((x) => x.n === n);
    if (!p) return;
    ui.openRead({ n, body: p.comment.body, status: p.comment.status, note: p.comment.note, moved: !!p.moved });
  };

  const cancelDraft = () => {
    draft = null;
    render();
  };

  const onClick = (e: MouseEvent) => {
    if (e.composedPath().includes(ui.host)) return;
    // Reviewing: a tap on the page marks a spot; it never follows a link or submits a form.
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (draft) return; // finish or cancel the open comment first
    const first = e.composedPath()[0];
    const target = first instanceof Element ? first : e.target instanceof Element ? e.target : doc.body;
    let { clientX, clientY } = e;
    if (e.detail === 0 && clientX === 0 && clientY === 0) {
      // Keyboard "click": use the middle of the element.
      const r = target.getBoundingClientRect();
      clientX = r.left + r.width / 2;
      clientY = r.top + r.height / 2;
    }
    const n = comments.length + 1;
    draft = {
      n,
      locator: locatorFor(target, clientX, clientY),
      shot: takeScreenshot({ x: clientX, y: clientY, n }, ui.host),
      viewport_w: win.innerWidth,
      viewport_h: win.innerHeight,
      device: deviceFor(win.innerWidth),
    };
    render();
    // Keep the pin above the sheet: if it is in the lower 55%, bring it to the top third.
    if (clientY > win.innerHeight * 0.45) win.scrollBy(0, clientY - win.innerHeight / 3);
    const mine = draft;
    let saving = false;
    const sheet = ui.openCompose({
      describe: describeElement(target),
      onCancel: cancelDraft,
      onSave: async (text) => {
        const body = text.trim();
        if (saving || !body || draft !== mine) return;
        saving = true;
        sheet.setError(null);
        sheet.setSaving(true);
        const shot = await shotWithin(mine.shot, SHOT_WAIT_MS);
        const result = await postComment(
          config,
          {
            site: config.site,
            path,
            body,
            ...mine.locator,
            viewport_w: mine.viewport_w,
            viewport_h: mine.viewport_h,
            device: mine.device,
          },
          shot,
        );
        saving = false;
        if (!result.ok) {
          // Never lose a comment: the sheet stays open with the text, ready to try again.
          sheet.setSaving(false);
          sheet.setError(SAVE_FAILED);
          return;
        }
        comments.push({
          id: result.id,
          body,
          status: "open",
          note: null,
          pr_url: null,
          ...mine.locator,
          created_at: new Date().toISOString(),
        });
        draft = null;
        ui.closeSheet(false);
        render();
        flashSaved();
      },
    });
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && ui.sheetOpen) ui.dismissSheet();
  };

  updateBar();
  render();
  doc.addEventListener("click", onClick, true);
  doc.addEventListener("keydown", onKey, true);
  // Coalesce bursts (resize, lazy images reflowing the page) into one layout per frame.
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      render();
    });
  };
  win.addEventListener("resize", schedule);
  if (doc.readyState !== "complete") win.addEventListener("load", schedule, { once: true });
  doc.fonts?.ready.then(schedule, () => {});
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(schedule).observe(doc.body);
}
