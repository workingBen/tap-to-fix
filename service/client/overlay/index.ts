import { fetchPageComments, postComment, type PageComment } from "./api";
import { describeElement, findPin, locatorFor, type Locator } from "./locate";
import { takeScreenshot } from "./shot";
import { readMode, saveMode, type Mode } from "./mode";
import { isSettled, OverlayUI, type PinView } from "./ui";

/** How long Save waits for the screenshot before sending the comment without it. */
const SHOT_WAIT_MS = 12_000;
const SAVED_NOTICE_MS = 3_000;
const SAVE_FAILED = "Couldn't save. Check your connection and try again.";
/** Refusals that no retry will fix get their own words (the text is still kept). */
const SAVE_REFUSED: Record<number, string> = {
  401: "This link no longer works. Ask for a new one.",
  403: "This page isn't on your review list.",
};
/** A tap: the finger lifts within this distance and time of where it went down. */
const TAP_SLOP_PX = 10;
const TAP_MS = 600;
/** A click this soon after a pointerup belongs to that pointer, so it never starts a pin itself. */
const CLICK_AFTER_POINTER_MS = 1_000;

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

type Session = { path: string; host: HTMLElement; stop(): void };

/**
 * Runs the overlay for this page, and again for each page the site swaps in without a reload
 * (Turbo Drive replaces <body> and never re-runs t.js; other routers push state).
 */
export async function start(config: OverlayConfig): Promise<void> {
  const doc = document;
  const win = window;
  if ((win as { __ttfRunning?: boolean }).__ttfRunning || doc.querySelector("tap-to-fix-overlay")) return;
  (win as { __ttfRunning?: boolean }).__ttfRunning = true;
  let current: Session | null = null;
  const restart = () => {
    if (current && current.path === win.location.pathname && current.host.isConnected) return;
    current?.stop();
    current = session(config, doc, win);
  };
  doc.addEventListener("turbo:load", restart);
  win.addEventListener("popstate", restart);
  win.addEventListener("pageshow", restart);
  restart();
}

function session(config: OverlayConfig, doc: Document, win: Window): Session {
  // A Turbo snapshot can carry a copy of an old host (without its shadow root); drop it.
  for (const old of doc.querySelectorAll("tap-to-fix-overlay")) old.remove();
  const ui = new OverlayUI(doc, config.dashboardUrl);
  const path = win.location.pathname;
  const cleanup: (() => void)[] = [() => ui.host.remove()];
  let alive = true;
  const listen = (target: EventTarget, type: string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
    target.addEventListener(type, fn as EventListener, opts);
    cleanup.push(() => target.removeEventListener(type, fn as EventListener, opts));
  };
  const self: Session = {
    path,
    host: ui.host,
    stop: () => {
      alive = false;
      for (const fn of cleanup.splice(0)) fn();
    },
  };
  ui.setBar({ kind: "loading" });
  void fetchPageComments(config, path).then((result) => {
    if (!alive) return; // the site moved on while this was loading
    if (result.kind !== "ok") {
      // Not assigned, signed out or offline: say so, and let every tap through to the page.
      ui.setBar(result);
      return;
    }
    review(result.comments);
  });
  return self;

  function review(comments: PageComment[]): void {
    let draft: Draft | null = null;
    let mode: Mode = readMode(win);
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
    cleanup.push(() => clearTimeout(savedTimer));
    const updateBar = () => ui.setBar({ kind: "reviewing", count: comments.length, saved: Date.now() < savedUntil });
    const flashSaved = () => {
      savedUntil = Date.now() + SAVED_NOTICE_MS;
      clearTimeout(savedTimer);
      savedTimer = setTimeout(updateBar, SAVED_NOTICE_MS);
      updateBar();
    };

    ui.setMode(mode);
    ui.onModeChange = (m) => {
      mode = m;
      saveMode(win, m);
      ui.setMode(m);
      down = null;
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

    /** Marks a spot: a pin, a screenshot under way, and the compose sheet. */
    const tap = (target: Element, clientX: number, clientY: number) => {
      if (draft) return; // finish or cancel the open comment first
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
          let saved = false;
          let failure = SAVE_FAILED;
          try {
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
            if (!result.ok) {
              failure = (result.status && SAVE_REFUSED[result.status]) || SAVE_FAILED;
              return;
            }
            saved = true;
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
          } finally {
            saving = false;
            if (!saved) {
              // Never lose a comment: the sheet stays open with the text, ready to try again.
              sheet.setSaving(false);
              sheet.setError(failure);
            }
          }
        },
      });
    };

    const inOverlay = (e: Event) => e.composedPath().includes(ui.host);
    const targetOf = (e: Event): Element => {
      const first = e.composedPath()[0];
      return first instanceof Element ? first : e.target instanceof Element ? e.target : doc.body;
    };
    const hide = (e: Event) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    };

    // The tap is decided from pointer events: on iOS a tap on plain text or a photo may never
    // become a click, and a page's touchend preventDefault cancels the click outright.
    let down: { id: number; x: number; y: number; t: number; target: Element } | null = null;
    let lastPointerUp = -Infinity;
    const onPointerDown = (e: PointerEvent) => {
      if (mode === "use" || inOverlay(e)) return;
      hide(e); // never preventDefault here: the page must still scroll
      down = e.isPrimary && e.button <= 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, target: targetOf(e) } : null;
    };
    const onPointerUp = (e: PointerEvent) => {
      if (mode === "use" || inOverlay(e)) return;
      hide(e);
      lastPointerUp = e.timeStamp;
      const d = down;
      down = null;
      if (!d || d.id !== e.pointerId) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP_PX || e.timeStamp - d.t > TAP_MS) return;
      tap(d.target, d.x, d.y);
    };
    const onPointerCancel = () => {
      down = null; // the browser took the gesture over (a scroll or zoom)
    };
    const onClick = (e: MouseEvent) => {
      if (mode === "use" || inOverlay(e)) return;
      // Reviewing: a tap on the page marks a spot; it never follows a link or submits a form.
      e.preventDefault();
      hide(e);
      if (e.timeStamp - lastPointerUp < CLICK_AFTER_POINTER_MS) return; // the pointer already decided
      // A click with no pointer behind it: keyboard activation, or a script's click().
      const target = targetOf(e);
      let { clientX, clientY } = e;
      if (e.detail === 0 && clientX === 0 && clientY === 0) {
        const r = target.getBoundingClientRect();
        clientX = r.left + r.width / 2;
        clientY = r.top + r.height / 2;
      }
      tap(target, clientX, clientY);
    };
    const onOtherInput = (e: Event) => {
      if (mode === "use" || inOverlay(e)) return;
      hide(e); // page handlers never see a review tap
      // A touch's compatibility mousedown arrives after the tap opened the sheet; its default
      // action would move focus off the comment box. (touchstart is never prevented: scrolling.)
      if (e.type === "mousedown" && draft) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && ui.sheetOpen) ui.dismissSheet();
    };

    updateBar();
    render();
    const capture = { capture: true };
    listen(doc, "pointerdown", onPointerDown, capture);
    listen(doc, "pointerup", onPointerUp, capture);
    listen(doc, "pointercancel", onPointerCancel, capture);
    listen(doc, "click", onClick, capture);
    for (const type of ["touchstart", "touchend"]) listen(doc, type, onOtherInput, { capture: true, passive: true });
    for (const type of ["mousedown", "mouseup"]) listen(doc, type, onOtherInput, capture);
    listen(doc, "keydown", onKey, capture);
    // Coalesce bursts (resize, lazy images reflowing the page) into one layout per frame.
    let queued = false;
    const schedule = () => {
      if (queued || !alive) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (alive) render();
      });
    };
    listen(win, "resize", schedule);
    if (doc.readyState !== "complete") listen(win, "load", schedule, { once: true });
    doc.fonts?.ready.then(schedule, () => {});
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(schedule);
      ro.observe(doc.body);
      cleanup.push(() => ro.disconnect());
    }
  }
}
