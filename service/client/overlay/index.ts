import { fetchPageComments, postComment, type PageComment } from "./api";
import {
  deepElementFromPoint,
  describeElement,
  FRAME_SEP,
  frameDoc,
  locatePin,
  locatorFor,
  toTopPoint,
  topRect,
  type Locator,
} from "./locate";
import { edgeBar } from "./edges";
import { takeScreenshot } from "./shot";
import { readMode, saveMode, type Mode } from "./mode";
import { isSettled, OverlayUI, type LineState, type PinView } from "./ui";
import { asComment, newClientId, offlineStore, Outbox, type OfflineStore, type Queued, type QueuedData } from "./outbox";
import { encodeWaiting } from "../handoff";

/** How long Save waits for the screenshot before sending the comment without it. */
const SHOT_WAIT_MS = 12_000;
const SAVED_NOTICE_MS = 3_000;
const SAVE_FAILED = "Couldn't save. Check your connection and try again.";
/** Refusals get their own words (the text is still kept). 401, 403 and 413 are ones no retry will fix. */
const SAVE_REFUSED: Record<number, string> = {
  401: "This link no longer works. Ask for a new one.",
  403: "This page isn't on your review list.",
  413: "This comment is too long to save. Shorten it and try again.",
  429: "That's a lot of comments at once. Wait a minute and try again.",
};
/** A refusal with no words of its own (a 400, say): offline mode still keeps the text. */
const SEND_REFUSED = "The review service didn't accept this comment.";
/** How long "All 3 sent" stays, the same as "Saved". */
const SENT_NOTICE_MS = 3_000;
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
  const store = offlineStore(win);
  // Pins for a page opened (or restored) offline come from the last list this page loaded.
  const listKey = `${config.site}\n${path}`;
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
  void fetchPageComments(config, path).then(async (result) => {
    if (!alive) return; // the site moved on while this was loading
    if (result.kind === "ok") {
      void store.writeList(listKey, { token: config.token, comments: result.comments }).catch(() => {});
      review(result.comments, true);
      return;
    }
    if (result.kind === "not_assigned") void store.writeList(listKey, { token: config.token, not_assigned: true }).catch(() => {});
    if (result.kind !== "offline") {
      // Not assigned or signed out: say so, and let every tap through to the page.
      ui.setBar(result);
      return;
    }
    // Offline (or the service failed): carry on from what this phone kept. A page that never
    // loaded its comments here starts empty; new comments still save, and earlier ones show
    // once the service answers.
    const cached = await store.readList(listKey).catch(() => null);
    if (!alive) return;
    if (cached && cached.token === config.token && "not_assigned" in cached) {
      ui.setBar({ kind: "not_assigned" });
      return;
    }
    review(cached && cached.token === config.token && "comments" in cached ? cached.comments : [], false);
  });
  return self;

  /** fresh: the comments came from the service just now (not from the phone's copy). */
  function review(comments: PageComment[], fresh: boolean): void {
    let draft: Draft | null = null;
    let mode: Mode = readMode(win);
    let placed: (PinView & { comment: PageComment; queued: Queued | null })[] = [];
    /** The site's own fixed or sticky bar along the top edge, if any (see placeBar). */
    let topBar: Element | null = null;
    let draftTarget: Element | null = null;
    const onBar = (el: Element | null) => !!topBar && !!el && topBar.contains(el);

    let outbox: Outbox; // set below; render only runs once it is
    /** The comment being saved from the open sheet: its draft pin shows, not a second one. */
    let holding: string | null = null;
    /** Saved comments and this page's unsent ones, in the order they were made: pin numbers. */
    const entries = (): { comment: PageComment; queued: Queued | null }[] => {
      const local = outbox.view().waiting.filter((q) => q.path === path && q.client_id !== holding);
      return [...comments.map((c) => ({ comment: c, queued: null })), ...local.map((q) => ({ comment: asComment(q), queued: q }))].sort(
        (a, b) => (a.comment.created_at < b.comment.created_at ? -1 : a.comment.created_at > b.comment.created_at ? 1 : 0),
      );
    };
    const render = () => {
      placed = [];
      entries().forEach(({ comment: c, queued }, i) => {
        const at = locatePin(doc, c);
        if (at)
          placed.push({
            n: i + 1,
            x: at.x,
            y: at.y,
            moved: at.moved,
            settled: isSettled(c.status),
            onBar: onBar(at.el),
            unsent: !!queued,
            comment: c,
            queued,
          });
      });
      const pins: PinView[] = [...placed];
      if (draft) pins.push({ n: draft.n, x: draft.locator.page_x, y: draft.locator.page_y, draft: true, onBar: onBar(draftTarget) });
      ui.setPins(pins);
    };
    let savedUntil = 0;
    let savedKind: "sent" | "phone" = "sent";
    let savedTimer: ReturnType<typeof setTimeout> | undefined;
    let sentUntil = 0;
    let sentTotal = 0;
    let sentTimer: ReturnType<typeof setTimeout> | undefined;
    cleanup.push(() => clearTimeout(savedTimer), () => clearTimeout(sentTimer));
    const line = (): LineState | null => {
      const v = outbox.view();
      if (v.sending) return { kind: "sending", ...v.sending };
      if (Date.now() < sentUntil) return { kind: "sent", total: sentTotal };
      if (v.failed.length) return { kind: "failed", count: v.failed.length };
      if (v.offline) return { kind: "offline", waiting: v.waiting.length };
      if (v.waiting.length) return { kind: "waiting", waiting: v.waiting.length };
      return null;
    };
    const updateBar = () => {
      if (!alive) return;
      const saved = Date.now() < savedUntil ? savedKind : null;
      ui.setBar({ kind: "reviewing", count: entries().length, saved, line: line() });
      // Done tells the dashboard what is still waiting here (it can't read this site's storage).
      ui.setDashboardHref(config.dashboardUrl + "&" + encodeWaiting(config.site, outbox.waitingByPath()));
    };
    const flashSaved = (kind: "sent" | "phone") => {
      savedKind = kind;
      savedUntil = Date.now() + SAVED_NOTICE_MS;
      clearTimeout(savedTimer);
      savedTimer = setTimeout(updateBar, SAVED_NOTICE_MS);
      updateBar();
    };
    /** The list came from the phone's copy; fetch the real one once the service answers. */
    let stale = !fresh;
    /** Keeps the phone's copy of this page's list current, for the next time it opens offline. */
    const keepList = () => void store.writeList(listKey, { token: config.token, comments }).catch(() => {});
    /** A sent comment joins the saved ones, so its pin fills in where it was. */
    const landed = (q: Queued, id: string) => {
      if (q.path !== path || comments.some((c) => c.id === id)) return;
      comments.push({ ...asComment(q), id });
      keepList();
    };
    outbox = new Outbox({
      store,
      token: config.token,
      site: config.site,
      send: (q) => postComment({ ...config, token: q.token }, q.data, q.shot),
      online: () => win.navigator.onLine !== false,
      onChange: () => {
        if (!alive) return;
        render();
        updateBar();
      },
      onSent: landed,
      onAllSent: (total) => {
        sentTotal = total;
        sentUntil = Date.now() + SENT_NOTICE_MS;
        clearTimeout(sentTimer);
        sentTimer = setTimeout(updateBar, SENT_NOTICE_MS);
        if (stale) void refreshList();
      },
    });
    cleanup.push(() => outbox.stop());
    if (!fresh) outbox.noteReached(false); // the list didn't load: the line says offline until something does
    const refreshList = async () => {
      const result = await fetchPageComments(config, path);
      if (!alive) return;
      outbox.noteReached(result.kind !== "offline");
      if (result.kind !== "ok") return;
      stale = false;
      comments = result.comments;
      keepList();
      await outbox.reconcile(new Set(comments.flatMap((c) => (c.client_id ? [c.client_id] : []))));
      render();
      updateBar();
    };
    /** Back online, or back on this tab: send what is waiting, and catch up on the list. */
    const wake = () => {
      if (!alive) return;
      if (stale) void refreshList().then(() => outbox.flush());
      else void outbox.flush();
    };

    ui.setMode(mode);
    ui.onModeChange = (m) => {
      mode = m;
      saveMode(win, m);
      ui.setMode(m);
      down = null;
    };

    const reasonFor = (q: Queued): string | null => (q.refused === undefined ? null : (SAVE_REFUSED[q.refused] ?? SEND_REFUSED));
    ui.onPinTap = (n) => {
      if (draft) return; // never throw away text being typed
      const p = placed.find((x) => x.n === n);
      if (!p) return;
      ui.openRead({
        n,
        body: p.comment.body,
        status: p.comment.status,
        note: p.comment.note,
        moved: !!p.moved,
        unsent: p.queued ? { reason: reasonFor(p.queued) } : undefined,
      });
    };

    const copyText = async (text: string): Promise<boolean> => {
      try {
        await win.navigator.clipboard.writeText(text);
        return true;
      } catch {
        // No clipboard API (or not allowed): the old select-and-copy way.
        const t = doc.createElement("textarea");
        t.value = text;
        t.setAttribute("readonly", "");
        t.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
        doc.body.append(t);
        t.select();
        let ok = false;
        try {
          ok = doc.execCommand("copy");
        } catch {
          ok = false;
        }
        t.remove();
        return ok;
      }
    };
    ui.onLineTap = (state) => {
      if (draft) return;
      if (state.kind === "offline") ui.openOffline();
      else if (state.kind === "failed")
        ui.openFailed(
          outbox.view().failed.map((q) => ({ id: q.client_id, body: q.data.body, reason: reasonFor(q) })),
          {
            onRetry: () => void outbox.retryNow(),
            onCopy: (id) => {
              const q = outbox.view().waiting.find((x) => x.client_id === id);
              return q ? copyText(q.data.body) : Promise.resolve(false);
            },
            onRemove: (id) => void outbox.drop(id),
          },
        );
      else if (state.kind === "waiting") void outbox.retryNow();
    };

    const cancelDraft = () => {
      draft = null;
      render();
    };

    /** Marks a spot: a pin, a screenshot under way, and the compose sheet. */
    const tap = (target: Element, clientX: number, clientY: number) => {
      if (draft) return; // finish or cancel the open comment first
      const n = entries().length + 1;
      draftTarget = target;
      draft = {
        n,
        locator: locatorFor(target, clientX, clientY, doc),
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
            const client_id = newClientId();
            const data: QueuedData = {
              site: config.site,
              path,
              body,
              client_id,
              ...mine.locator,
              viewport_w: mine.viewport_w,
              viewport_h: mine.viewport_h,
              device: mine.device,
            };
            // On the phone first, then sent: a comment is never only in the open sheet.
            const item: Queued = { client_id, token: config.token, site: config.site, path, data, shot, created_at: new Date().toISOString() };
            holding = client_id; // the draft pin stands for it until the sheet closes
            await outbox.add(item);
            const { outcome, status } = await outbox.sendOne(item);
            if (outcome === "refused" || outcome === "later") {
              // The service answered, and said no: say why in the sheet, which still holds the
              // text, and take it back off the phone (the sheet is where it lives now).
              failure = (status && SAVE_REFUSED[status]) || SAVE_FAILED;
              await outbox.drop(client_id);
              return;
            }
            saved = true;
            draft = null;
            holding = null;
            ui.closeSheet(false);
            render();
            // Sent: today's "Saved". No answer (offline): it waits on the phone, hollow.
            flashSaved(outcome === "sent" ? "sent" : "phone");
            if (outcome === "sent") void outbox.flush(); // the service is reachable: send any others
          } finally {
            saving = false;
            if (!saved) {
              holding = null;
              // Never lose a comment: the sheet stays open with the text, ready to try again.
              sheet.setSaving(false);
              sheet.setError(failure);
            }
          }
        },
      });
    };

    const inOverlay = (e: Event) => e.composedPath().includes(ui.host);
    // nodeType, not instanceof: a node inside a frame belongs to the frame's window, whose
    // Element is a different constructor from this window's.
    const isEl = (n: unknown): n is Element => !!n && (n as Node).nodeType === 1;
    const targetOf = (e: Event): Element => {
      const first = e.composedPath()[0];
      return isEl(first) ? first : isEl(e.target) ? e.target : doc.body;
    };
    /** The document an event happened in: this page, or a same-origin frame's page. */
    const docOf = (e: Event): Document => {
      const n = (e.composedPath()[0] ?? e.target) as Node | null;
      if (!n) return doc;
      return n.nodeType === 9 ? (n as Document) : (n.ownerDocument ?? doc);
    };
    /** The event's point in this page's viewport (a frame's clientX/Y are relative to the frame). */
    const pointOf = (e: MouseEvent): { x: number; y: number } => toTopPoint(docOf(e), doc, e.clientX, e.clientY);
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
      const at = pointOf(e);
      down = e.isPrimary && e.button <= 0 ? { id: e.pointerId, x: at.x, y: at.y, t: e.timeStamp, target: targetOf(e) } : null;
    };
    const onPointerUp = (e: PointerEvent) => {
      if (mode === "use" || inOverlay(e)) return;
      hide(e);
      lastPointerUp = e.timeStamp;
      const d = down;
      down = null;
      if (!d || d.id !== e.pointerId) return;
      const at = pointOf(e);
      if (Math.hypot(at.x - d.x, at.y - d.y) > TAP_SLOP_PX || e.timeStamp - d.t > TAP_MS) return;
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
      let { x: clientX, y: clientY } = pointOf(e);
      if (e.detail === 0 && e.clientX === 0 && e.clientY === 0) {
        const r = topRect(target, doc);
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

    // The Comment cursor: fine pointers only, Comment mode only, never over the overlay or a sheet.
    // Position comes from pointermove (one update per frame); the ring follows its target on scroll.
    const fine = () => win.matchMedia("(hover: hover) and (pointer: fine)").matches;
    let moveAt: { x: number; y: number; target: Element | null } | null = null;
    let moveQueued = false;
    let rehit = false;
    // The page itself is never worth outlining; a margin hit means "nothing in particular".
    // A frame's own body counts as the page too.
    const ringable = (t: Element | null): Element | null =>
      t && t !== t.ownerDocument.body && t !== t.ownerDocument.documentElement ? t : null;
    const paintCursor = () => {
      moveQueued = false;
      if (!alive || !moveAt) return;
      if (rehit) {
        // The page scrolled under a still mouse: whatever is under the pointer now gets the ring.
        rehit = false;
        const hit = deepElementFromPoint(doc, moveAt.x, moveAt.y);
        moveAt.target = hit && hit !== ui.host && !ui.host.contains(hit) ? hit : null;
      }
      if (mode !== "comment" || ui.sheetOpen) ui.hideCursor();
      else ui.moveCursor(moveAt.x, moveAt.y, ringable(moveAt.target));
    };
    const queueCursor = () => {
      if (moveQueued) return;
      moveQueued = true;
      requestAnimationFrame(paintCursor);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || mode !== "comment" || !fine() || ui.sheetOpen || inOverlay(e)) {
        moveAt = null;
        ui.hideCursor();
        return;
      }
      const at = pointOf(e);
      moveAt = { x: at.x, y: at.y, target: targetOf(e) };
      queueCursor();
    };
    const onPointerLeave = () => {
      moveAt = null;
      ui.hideCursor();
    };
    cleanup.push(() => ui.hideCursor());

    updateBar();
    render();
    // What earlier visits left on this phone shows (hollow) and starts sending right away.
    void outbox.load().then(() => {
      if (!alive) return;
      if (fresh) void outbox.reconcile(new Set(comments.flatMap((c) => (c.client_id ? [c.client_id] : []))));
      void outbox.flush();
    });
    listen(win, "online", wake);
    listen(win, "pageshow", wake); // back from the back/forward cache
    listen(win, "offline", updateBar); // only a hint, but airplane mode says so at once
    listen(doc, "visibilitychange", () => {
      if (doc.visibilityState === "visible") wake();
    });
    const capture = { capture: true };
    const onScroll = () => {
      if (!moveAt) return;
      rehit = true;
      queueCursor();
    };
    /** The same capture-phase listeners on this page and on every same-origin frame's page. */
    const inputOn = (d: Document) => {
      listen(d, "pointerdown", onPointerDown, capture);
      listen(d, "pointerup", onPointerUp, capture);
      listen(d, "pointercancel", onPointerCancel, capture);
      listen(d, "click", onClick, capture);
      for (const type of ["touchstart", "touchend"]) listen(d, type, onOtherInput, { capture: true, passive: true });
      for (const type of ["mousedown", "mouseup"]) listen(d, type, onOtherInput, capture);
      listen(d, "keydown", onKey, capture);
      listen(d, "pointermove", onPointerMove, { capture: true, passive: true });
      listen(d.documentElement, "pointerleave", onPointerLeave);
      const w = d.defaultView;
      if (w) listen(w, "scroll", onScroll, { capture: true, passive: true });
    };
    inputOn(doc);
    // Sites with a fixed or sticky bar along the bottom edge (a cookie banner): sit above it.
    // A fixed or sticky header along the top edge: pins slide under it, as the page's content does.
    const placeBar = () => {
      if (!alive) return;
      const bottom = edgeBar(doc, win, ui.host, "bottom");
      ui.liftBar(bottom ? win.innerHeight - bottom.rect.top + 12 : null);
      const top = edgeBar(doc, win, ui.host, "top");
      const bar = top?.el ?? null;
      if (bar !== topBar) {
        topBar = bar;
        render(); // a pin on the bar itself moves to the layer the bar never covers
      }
      ui.clipTop(top ? top.rect.bottom : null, bar);
    };
    let liftQueued = false;
    const scheduleLift = () => {
      if (liftQueued || !alive) return;
      liftQueued = true;
      requestAnimationFrame(() => {
        liftQueued = false;
        placeBar();
      });
    };
    placeBar();
    // Coalesce bursts (resize, lazy images reflowing the page) into one layout per frame.
    let queued = false;
    const schedule = () => {
      if (queued || !alive) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (alive) {
          render();
          placeBar();
        }
      });
    };
    listen(win, "resize", schedule);
    // The pins layer moves with the page, and a sticky header can stick or unstick: re-clip.
    listen(win, "scroll", scheduleLift, { capture: true, passive: true });
    if (doc.readyState !== "complete") listen(win, "load", schedule, { once: true });
    doc.fonts?.ready.then(schedule, () => {});
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(schedule);
      ro.observe(doc.body);
      cleanup.push(() => ro.disconnect());
    }
    // Same-origin frames (an article shown in <iframe srcdoc>) get the same listeners. A frame's
    // load replaces its document, so each load attaches to the new one; cross-origin frames are
    // skipped (frameDoc gives null).
    const framesSeen = new WeakSet<Element>();
    const docsSeen = new WeakSet<Document>();
    const attachDoc = (d: Document) => {
      if (docsSeen.has(d) || !alive) return;
      docsSeen.add(d);
      try {
        inputOn(d);
      } catch {
        return; // the frame went away or turned cross-origin under us
      }
      if (d.body) {
        const inner = new MutationObserver(() => watchFramesIn(d));
        inner.observe(d.body, { childList: true, subtree: true });
        cleanup.push(() => inner.disconnect());
      }
      watchFramesIn(d);
    };
    // A pin that sits in a frame, or that could not be found yet, may land once a frame loads.
    const mayNeedFrame = () =>
      comments.some((c) => c.selector?.includes(FRAME_SEP)) || placed.some((p) => p.moved) || placed.length < comments.length;
    const watchFrame = (f: Element) => {
      // The screenshot library adds its own hidden frame while it captures; leave it alone.
      if (f.id.startsWith("__SANDBOX__")) return;
      if (!framesSeen.has(f)) {
        framesSeen.add(f);
        listen(f, "load", () => {
          const d = frameDoc(f);
          if (d) attachDoc(d);
          if (mayNeedFrame()) schedule();
        });
      }
      const d = frameDoc(f);
      if (d) attachDoc(d);
    };
    const watchFramesIn = (d: Document) => {
      for (const f of Array.from(d.querySelectorAll("iframe, frame"))) watchFrame(f);
    };
    watchFramesIn(doc);
    // A banner that appears or hides later changes the page, not the window; a frame added
    // later needs its listeners.
    const mo = new MutationObserver(() => {
      scheduleLift();
      watchFramesIn(doc);
    });
    mo.observe(doc.body, { childList: true, attributes: true, subtree: true });
    cleanup.push(() => mo.disconnect());
  }
}
