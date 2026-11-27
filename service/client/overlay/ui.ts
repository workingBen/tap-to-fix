import type { Status } from "./api";
import { OVERLAY_CSS } from "./styles";
import type { Mode } from "./mode";
import { PIN_BODY_CX, PIN_BODY_CY, PIN_FLIP_MARGIN, pinPath, type Dir } from "./pin-shape";
import { topRect } from "./locate";

export const STATUS_LABELS: Record<Status, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Fixed — goes live with Ben's next update",
  later: "Saved for later",
  kept: "Kept as is",
};

export const isSettled = (s: Status): boolean => s === "done" || s === "later" || s === "kept";

export type BarState =
  | { kind: "loading" }
  /** saved: the note after a save ("Saved", or "Saved on this phone" when it waits to send). */
  | { kind: "reviewing"; count: number; saved?: "sent" | "phone" | null; line?: LineState | null }
  | { kind: "not_assigned" }
  | { kind: "signed_out" };

/** The status line just above the pill (offline mode), in the spot "Saved" uses. */
export type LineState =
  | { kind: "offline"; waiting: number }
  /** Online, with comments waiting for their next retry. */
  | { kind: "waiting"; waiting: number }
  | { kind: "sending"; done: number; total: number }
  | { kind: "sent"; total: number }
  | { kind: "failed"; count: number };

/** One comment in the "didn't send" sheet. reason: why the service refused it; null: it keeps trying. */
export type FailedView = { id: string; body: string; reason: string | null };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The line's words, as the design review settled them. */
export function lineText(state: LineState): { strong: string; rest: string | null; link: string | null } {
  switch (state.kind) {
    case "offline":
      return { strong: "Offline", rest: state.waiting ? `${state.waiting} waiting to send` : "Comments still save", link: null };
    case "waiting":
      return { strong: `${state.waiting} waiting to send`, rest: null, link: null };
    case "sending":
      return {
        strong: state.total === 1 ? "Sending 1 comment" : `Sending ${Math.min(state.done + 1, state.total)} of ${state.total}`,
        rest: null,
        link: null,
      };
    case "sent":
      return { strong: state.total === 1 ? "1 comment sent" : `All ${state.total} sent`, rest: null, link: null };
    case "failed":
      return { strong: `${state.count} didn't send`, rest: null, link: "See why" };
  }
}

/** A pin in DOCUMENT coordinates. */
/** onBar: anchored to an element inside the site's own top bar, so the bar never covers it. */
/** unsent: still on the phone (offline mode), drawn hollow until the service has it. */
export type PinView = { n: number; x: number; y: number; settled?: boolean; moved?: boolean; draft?: boolean; onBar?: boolean; unsent?: boolean };

/** Far enough to never clip a pin on the sides or bottom of the zero-size pins layer. */
const CLIP_FAR = 100_000;

/** unsent: not sent yet; reason says why the service refused it, null while it keeps trying. */
export type ReadView = { n: number; body: string; status: Status; note: string | null; moved: boolean; unsent?: { reason: string | null } };

const CURSOR_STYLE_ID = "ttf-cursor-style";
const SVG_NS = "http://www.w3.org/2000/svg";

// Monochrome line icon (stroke follows currentColor).
function icon(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}
const ALERT_ICON = ["M12 3l9.5 17h-19z", "M12 10v4", "M12 17.5v.01"];
const PEN_ICON = ["M4 20h4L19 9l-4-4L4 16z", "M13.5 6.5l4 4"];
const POINTER_ICON = ["M5 3l14 7-6.5 2L10 19z"];
const CHECK_ICON = ["M5 12.5l4.5 4.5L19 7.5"];
const OFFLINE_ICON = ["M2 2l20 20", "M5.8 5.8A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.3-.2", "M21.5 16.5A4.5 4.5 0 0 0 17.5 10h-1.8A7 7 0 0 0 10 5.1"];
const SEND_ICON = ["M12 16V4", "M7 9l5-5 5 5", "M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"];
const PHONE_ICON = ["M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z", "M11 18h2"];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...children);
  return e;
}

/** What the compose sheet lets the save flow change while it works. */
export type ComposeHandle = {
  textarea: HTMLTextAreaElement;
  /** Busy: Save shows "Saving…", and Save and Cancel are disabled. */
  setSaving(on: boolean): void;
  /** Shows (or, with null, clears) the warning above the buttons. */
  setError(message: string | null): void;
};

export const countLabel = (n: number): string => `${n} ${n === 1 ? "comment" : "comments"}`;

export class OverlayUI {
  readonly host: HTMLElement;
  private readonly root: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  /** One persistent live region, so screen readers announce "Saved" when its text appears. */
  private readonly savedNote: HTMLSpanElement;
  /** Offline mode's status line, in the same spot; hidden while "Saved" shows. */
  private readonly line: HTMLButtonElement;
  private lineState: LineState | null = null;
  private dashboardHref: string;
  private readonly pinsLayer: HTMLDivElement;
  /** Pins on the site's top bar itself: same coordinates, never clipped. */
  private readonly barPinsLayer: HTMLDivElement;
  /** The bottom edge of the site's fixed or sticky top bar (viewport px), and the bar; null: none. */
  private clipY: number | null = null;
  private topBar: Element | null = null;
  private ringAt: { top: number; onBar: boolean } | null = null;
  private readonly sheet: HTMLDivElement;
  private pins: PinView[] = [];
  private onSheetClose: (() => void) | null = null;
  /** Asked before a user-initiated close (Cancel, Escape); false keeps the sheet open. */
  private mayDismiss: (() => boolean) | null = null;
  onPinTap: (n: number) => void = () => {};
  onModeChange: (m: Mode) => void = () => {};
  onLineTap: (state: LineState) => void = () => {};
  private mode: Mode = "use";
  private readonly cursor: HTMLDivElement;
  private readonly ring: HTMLDivElement;
  /** Documents (this page and same-origin frames) carrying the hide-the-arrow style. */
  private readonly arrowHidden = new Set<Document>();

  constructor(private readonly doc: Document, dashboardUrl: string) {
    this.dashboardHref = dashboardUrl;
    this.host = doc.createElement("tap-to-fix-overlay");
    // Open, not closed: tests need to reach in, and the page can already read the token anyway.
    const shadow = this.host.attachShadow({ mode: "open" });
    const style = el("style");
    style.textContent = OVERLAY_CSS;
    this.bar = el("div", { class: "bar", "data-ttf": "bar", role: "region", "aria-label": "Review bar" });
    this.savedNote = el("span", { class: "saved", role: "status", "data-ttf": "saved" });
    // aria-live, not role=status: "Saved" keeps the one status region; this one speaks up too.
    this.line = el("button", { type: "button", class: "line", "data-ttf": "line", "aria-live": "polite" });
    this.line.hidden = true;
    this.line.addEventListener("click", () => {
      if (this.lineState) this.onLineTap(this.lineState);
    });
    this.bar.append(this.savedNote, this.line);
    this.pinsLayer = el("div", { class: "pins", "data-ttf": "pins" });
    this.barPinsLayer = el("div", { class: "pins", "data-ttf": "bar-pins" });
    this.sheet = el("div", { class: "sheet", "data-ttf": "sheet", role: "dialog", "aria-modal": "false" });
    this.sheet.hidden = true;
    // The Comment-mode cursor and the hover ring live in the shadow root, so a screenshot (which
    // leaves the host out) and the page's own styles never see them.
    this.cursor = el(
      "div",
      { class: "cur", "data-ttf": "cursor", "aria-hidden": "true" },
      el("span", { class: "ripple" }),
      el("span", { class: "ripple r2" }),
      el("span", { class: "cdot" }),
      el("span", { class: "ctag" }, "Comment"),
    );
    this.ring = el("div", { class: "hover-ring", "data-ttf": "ring", "aria-hidden": "true" });
    this.cursor.hidden = true;
    this.ring.hidden = true;
    this.root = el("div", { class: "root", "data-mode": "use" }, this.pinsLayer, this.barPinsLayer, this.ring, this.cursor, this.bar, this.sheet);
    shadow.append(style, this.root);
    // Keystrokes in the comment box reach the page retargeted to this host, so the page's
    // "ignore keys while typing in a field" checks miss them and its shortcuts would fire.
    // Stop them here. (The overlay's own Escape handler listens in the capture phase first.)
    for (const type of ["keydown", "keypress", "keyup", "input", "beforeinput"]) {
      this.host.addEventListener(type, (e) => e.stopPropagation());
    }
    doc.body.append(this.host);
  }

  setBar(state: BarState): void {
    const link = (text: string) => el("a", { href: this.dashboardHref, "data-ttf": "dash-link" }, text);
    const warn = (text: string) => el("span", { class: "msg" }, icon(ALERT_ICON), text);
    let content: Node[];
    switch (state.kind) {
      case "loading":
        content = [el("span", { class: "msg" }, "Opening your review…")];
        break;
      case "reviewing":
        content = [
          el("span", { class: "msg count", "data-ttf": "count" }, el("b", {}, "Reviewing"), ` · ${countLabel(state.count)}`),
          this.modeGroup(),
          el("span", { class: "vr", "aria-hidden": "true" }),
          link("Done"),
        ];
        break;
      case "not_assigned":
        content = [warn("This page isn't on your review list"), link("Back to your list")];
        break;
      case "signed_out":
        content = [warn("This link no longer works. Ask for a new one.")];
        break;
    }
    // Replace everything except the live region and the line, which stay put (both are
    // positioned absolutely above the pill).
    for (const n of [...this.bar.childNodes]) if (n !== this.savedNote && n !== this.line) n.remove();
    this.bar.prepend(...content);
    const saved = state.kind === "reviewing" ? (state.saved ?? null) : null;
    const words = saved === "phone" ? "Saved on this phone" : "Saved";
    if (saved && this.savedNote.textContent !== words) this.savedNote.replaceChildren(icon(CHECK_ICON), words);
    if (!saved) this.savedNote.replaceChildren();
    this.paintLine(state.kind === "reviewing" && !saved ? (state.line ?? null) : null);
  }

  private paintLine(state: LineState | null): void {
    const same = JSON.stringify(state) === JSON.stringify(this.lineState);
    this.lineState = state;
    this.line.hidden = !state;
    if (same) return;
    if (!state) {
      this.line.replaceChildren();
      this.line.removeAttribute("data-kind");
      return;
    }
    const t = lineText(state);
    const ic =
      state.kind === "offline" ? OFFLINE_ICON : state.kind === "sending" ? SEND_ICON : state.kind === "sent" ? CHECK_ICON : state.kind === "failed" ? ALERT_ICON : PHONE_ICON;
    // One run of text with real spaces, so it reads (and is announced) as "Offline · 3 waiting to send".
    const words = el("span", { class: "words" }, el("b", {}, t.strong));
    if (t.rest) words.append(" ", el("span", { class: "sep" }, "·"), " ", t.rest);
    if (t.link) words.append(" ", el("span", { class: "sep" }, "·"), " ", el("span", { class: "u" }, t.link));
    const parts: Node[] = [icon(ic), words];
    if (state.kind === "sending") {
      // The one being sent counts as half done, so the track moves as soon as sending starts.
      const pct = Math.round(((state.done + 0.5) / state.total) * 100);
      parts.push(el("span", { class: "track", "aria-hidden": "true" }, el("i", { style: `width:${pct}%` })));
    }
    this.line.replaceChildren(...parts);
    this.line.setAttribute("data-kind", state.kind);
  }

  /** Where Done goes: the dashboard, with this site's waiting counts (see ../handoff.ts). */
  setDashboardHref(href: string): void {
    this.dashboardHref = href;
    for (const a of this.bar.querySelectorAll("a[data-ttf=dash-link]")) a.setAttribute("href", href);
  }

  /** The Comment / Use the page switch. Built fresh on every bar render, so no listener outlives its button. */
  private modeGroup(): HTMLElement {
    const seg = (m: Mode, paths: string[], label: string) => {
      const b = el("button", { type: "button", "data-mode": m }, icon(paths), el("span", {}, label));
      b.addEventListener("click", () => {
        if (this.mode !== m) this.onModeChange(m);
      });
      return b;
    };
    const group = el(
      "div",
      { class: "seg", role: "group", "aria-label": "Mode", "data-ttf": "mode" },
      seg("comment", PEN_ICON, "Comment"),
      seg("use", POINTER_ICON, "Use the page"),
    );
    this.paintMode(group);
    return group;
  }

  private paintMode(group: ParentNode): void {
    for (const b of group.querySelectorAll("button[data-mode]")) {
      const on = b.getAttribute("data-mode") === this.mode;
      b.setAttribute("aria-pressed", String(on));
      b.classList.toggle("on", on);
    }
  }

  /** Puts the Comment cursor at (x, y), the ring around `target`, and hides the arrow cursor.
   *  (x, y) is in this page's viewport; `target` may be inside a same-origin frame. */
  moveCursor(x: number, y: number, target: Element | null): void {
    this.cursor.hidden = false;
    this.cursor.style.transform = `translate(${x}px, ${y}px)`;
    if (target && target.isConnected) {
      const r = topRect(target, this.doc);
      this.ring.hidden = false;
      this.ring.style.width = `${r.width + 6}px`;
      this.ring.style.height = `${r.height + 6}px`;
      this.ring.style.transform = `translate(${r.left - 3}px, ${r.top - 3}px)`;
      this.ringAt = { top: r.top - 3, onBar: !!this.topBar?.contains(target) };
      this.clipRing();
    } else {
      this.ring.hidden = true;
      this.ringAt = null;
    }
    // Hide the arrow on this page and, when the mouse is over a frame, inside that frame's page.
    this.hideArrow(this.doc);
    if (target && target.ownerDocument !== this.doc) this.hideArrow(target.ownerDocument);
  }

  private hideArrow(d: Document): void {
    if (d.getElementById(CURSOR_STYLE_ID) || !d.head) return;
    const s = d.createElement("style");
    s.id = CURSOR_STYLE_ID;
    s.textContent = "html, html * { cursor: none !important; }";
    d.head.append(s);
    this.arrowHidden.add(d);
  }

  hideCursor(): void {
    this.cursor.hidden = true;
    this.ring.hidden = true;
    this.doc.getElementById(CURSOR_STYLE_ID)?.remove();
    for (const d of this.arrowHidden) d.getElementById(CURSOR_STYLE_ID)?.remove();
    this.arrowHidden.clear();
  }

  /**
   * The site's fixed or sticky top bar ends at `y` (viewport px): pins, the draft pin and the
   * hover ring slide under it like the page's own content. Pins anchored on the bar itself sit in
   * their own layer and stay visible. null: no top bar, nothing is clipped.
   */
  clipTop(y: number | null, bar: Element | null): void {
    this.clipY = y;
    this.topBar = y === null ? null : bar;
    this.clipPins();
    this.clipRing();
  }

  private clipPins(): void {
    if (this.clipY === null) {
      this.pinsLayer.style.removeProperty("clip-path");
      return;
    }
    // The layer is a zero-size box at the page origin, so its own top moves as the page scrolls.
    const t = this.clipY - this.pinsLayer.getBoundingClientRect().top;
    this.pinsLayer.style.clipPath = `inset(${t}px -${CLIP_FAR}px -${CLIP_FAR}px -${CLIP_FAR}px)`;
  }

  private clipRing(): void {
    const t = this.clipY === null || !this.ringAt || this.ringAt.onBar ? 0 : this.clipY - this.ringAt.top;
    if (t > 0) this.ring.style.clipPath = `inset(${t}px 0 0 0)`;
    else this.ring.style.removeProperty("clip-path");
  }

  /** Raises the pill so its bottom edge is `px` above the viewport bottom; null puts it back. */
  liftBar(px: number | null): void {
    if (px === null) this.root.style.removeProperty("--lift");
    else this.root.style.setProperty("--lift", `${px}px`);
  }

  setMode(m: Mode): void {
    this.hideCursor();
    this.mode = m;
    this.root.setAttribute("data-mode", m);
    this.paintMode(this.bar);
  }

  setPins(pins: PinView[]): void {
    this.pins = pins;
    this.layout();
  }

  /** Re-place every pin; the layer's own document offset absorbs positioned/margined bodies. */
  layout(): void {
    const win = this.doc.defaultView ?? window;
    const r = this.pinsLayer.getBoundingClientRect();
    const ox = r.left + win.scrollX;
    const oy = r.top + win.scrollY;
    const nodes = this.pins.map((p): [HTMLButtonElement, boolean] => {
      const flip = p.x - win.scrollX + PIN_FLIP_MARGIN > win.innerWidth;
      const dir: Dir = flip ? -1 : 1;
      const cls = ["pin", flip ? "flip" : "", p.settled ? "settled" : "", p.moved ? "moved" : "", p.draft ? "new" : "", p.unsent ? "unsent" : ""].filter(Boolean);
      const b = el(
        "button",
        { type: "button", class: cls.join(" "), "data-ttf": "pin", "aria-label": p.unsent ? `Comment ${p.n}, not sent yet` : `Comment ${p.n}` },
        el("span", { class: "dot" }, String(p.n)),
      );
      // The hit area surrounds the body; the tail's point (the svg origin, 12/49 px in) is the tap spot.
      const body = pinPath(dir);
      const id = flip ? "ttf-cut-l" : "ttf-cut-r";
      b.insertAdjacentHTML(
        "afterbegin",
        `<svg class="pt" aria-hidden="true" focusable="false"><defs><clipPath id="${id}"><path clip-rule="evenodd" d="M-80-90H80V30H-80Z${body}"/></clipPath></defs>` +
          `<path class="ring" clip-path="url(#${id})" d="${body}"/><path class="body" d="${body}"/>` +
          `<circle class="mv" cx="${dir * PIN_BODY_CX}" cy="${PIN_BODY_CY}" r="19"/></svg>`,
      );
      b.style.left = `${p.x - ox - (flip ? 32 : 12)}px`;
      b.style.top = `${p.y - oy - 49}px`;
      if (p.draft) b.tabIndex = -1;
      else b.addEventListener("click", () => this.onPinTap(p.n));
      return [b, !!p.onBar];
    });
    this.pinsLayer.replaceChildren(...nodes.filter(([, onBar]) => !onBar).map(([b]) => b));
    this.barPinsLayer.replaceChildren(...nodes.filter(([, onBar]) => onBar).map(([b]) => b));
  }

  get sheetOpen(): boolean {
    return !this.sheet.hidden;
  }

  /** The compose sheet. Callbacks carry the outcome; the handle lets the save flow show progress. */
  openCompose(opts: { describe: string; onCancel: () => void; onSave: (text: string) => void }): ComposeHandle {
    const textarea = el("textarea", { rows: "4", "aria-label": "Your comment", autofocus: "" });
    const save = el("button", { type: "button", class: "btn primary", "data-ttf": "save" }, "Save comment");
    const cancel = el("button", { type: "button", class: "btn ghost" }, "Cancel");
    const error = el("p", { class: "save-error", "data-ttf": "save-error", role: "alert" });
    error.hidden = true;
    let saving = false;
    const refresh = () => {
      save.disabled = saving || !textarea.value.trim();
      cancel.disabled = saving;
    };
    textarea.addEventListener("input", refresh);
    save.addEventListener("click", () => {
      if (!save.disabled) opts.onSave(textarea.value);
    });
    cancel.addEventListener("click", () => this.dismissSheet());
    this.show(
      [
        el("h2", { class: "sheet-h", id: "ttf-sheet-h" }, "What should change here?"),
        el("p", { class: "sub", "data-ttf": "sub" }, opts.describe),
        textarea,
        error,
        el("div", { class: "actions" }, save, cancel),
      ],
      opts.onCancel,
    );
    // Typed text is never thrown away without asking; nothing closes the sheet mid-save.
    this.mayDismiss = () => {
      if (saving) return false;
      if (!textarea.value.trim()) return true;
      const win = this.doc.defaultView ?? window;
      return win.confirm("Discard this comment?");
    };
    refresh();
    textarea.focus({ preventScroll: true });
    return {
      textarea,
      setSaving: (on) => {
        saving = on;
        save.textContent = on ? "Saving…" : "Save comment";
        save.setAttribute("aria-busy", String(on));
        refresh();
      },
      setError: (message) => {
        error.hidden = message === null;
        error.replaceChildren(...(message === null ? [] : [icon(ALERT_ICON), el("span", {}, message)]));
      },
    };
  }

  openRead(view: ReadView): void {
    const close = el("button", { type: "button", class: "btn ghost" }, "Close");
    close.addEventListener("click", () => this.closeSheet());
    const badge = el(
      "span",
      {
        class: ["badge", isSettled(view.status) ? "settled" : "", view.moved ? "moved" : "", view.unsent ? "unsent" : ""].filter(Boolean).join(" "),
      },
      el("span", { class: "dot" }, String(view.n)),
    );
    if (view.moved) badge.append(el("span", { class: "moved-label" }, "moved"));
    const details = el("div", {}, el("h2", { class: "sheet-h", id: "ttf-sheet-h" }, "Your comment"), el("p", { class: "body" }, view.body));
    if (view.unsent) {
      // Where the status usually goes: it is still on this phone.
      details.append(
        el("span", { class: "status unsent", "data-ttf": "unsent" }, icon(PHONE_ICON), "Not sent yet"),
        el("p", { class: "note" }, view.unsent.reason ?? "Saved on this phone. It sends when you're back online."),
      );
    } else {
      details.append(el("span", { class: isSettled(view.status) ? "status settled" : "status" }, STATUS_LABELS[view.status] ?? view.status));
    }
    if (!view.unsent && (view.status === "later" || view.status === "kept") && view.note) {
      details.append(el("p", { class: "note" }, view.note));
    }
    this.show([el("div", { class: "read-head" }, badge, details), el("div", { class: "actions" }, close)], null);
    close.focus({ preventScroll: true });
  }

  /** What offline means, from a tap on the "Offline" line. */
  openOffline(): void {
    const ok = el("button", { type: "button", class: "btn primary" }, "OK");
    ok.addEventListener("click", () => this.closeSheet());
    this.show(
      [
        el("h2", { class: "sheet-h", id: "ttf-sheet-h" }, "You're offline"),
        el("p", { class: "lede ink" }, "Keep commenting. Each comment and its screenshot is saved on this phone."),
        el("p", { class: "lede" }, "They send on their own when you're back online with a Tap to Fix page open."),
        el("div", { class: "actions" }, ok),
      ],
      null,
    );
    ok.focus({ preventScroll: true });
  }

  /**
   * The comments that didn't send, from "See why": each one's own words, a promise it is still on
   * the phone, and Try again. One the service refused (retrying won't fix it) says why and gets
   * Copy text, so the words are never stuck, and Remove.
   */
  openFailed(items: FailedView[], opts: { onRetry: () => void; onCopy: (id: string) => Promise<boolean>; onRemove: (id: string) => void }): void {
    const retry = el("button", { type: "button", class: "btn primary", "data-ttf": "retry" }, "Try again now");
    retry.addEventListener("click", () => {
      this.closeSheet();
      opts.onRetry();
    });
    const close = el("button", { type: "button", class: "btn ghost" }, "Close");
    close.addEventListener("click", () => this.closeSheet());
    const blocks = items.map((f) => {
      const block = el("div", { class: "failed", "data-ttf": "failed" }, el("p", { class: "quote body" }, f.body));
      if (f.reason) {
        const copy = el("button", { type: "button", class: "btn line-btn", "data-ttf": "copy" }, "Copy text");
        copy.addEventListener("click", () => {
          void opts.onCopy(f.id).then((ok) => {
            copy.textContent = ok ? "Copied" : "Couldn't copy";
          });
        });
        const remove = el("button", { type: "button", class: "btn ghost", "data-ttf": "remove" }, "Remove");
        remove.addEventListener("click", () => {
          const win = this.doc.defaultView ?? window;
          if (!win.confirm("Remove this comment from this phone? Copy its text first if you still need it.")) return;
          this.closeSheet();
          opts.onRemove(f.id);
        });
        block.append(el("p", { class: "lede reason" }, f.reason), el("div", { class: "pair" }, copy, remove));
      }
      return block;
    });
    const refusedOnly = items.every((f) => f.reason);
    const still = items.length === 1 ? "It's still saved on this phone." : "They're still saved on this phone.";
    this.show(
      [
        el("h2", { class: "sheet-h", id: "ttf-sheet-h" }, `${plural(items.length, "comment", "comments")} didn't send`),
        ...blocks,
        el(
          "p",
          { class: "lede" },
          refusedOnly ? still : `${still} Tap to Fix keeps trying while this page is open.`,
        ),
        el("div", { class: "actions" }, retry, close),
      ],
      null,
    );
    close.focus({ preventScroll: true });
  }

  /** A user asking to close (Cancel, Escape): checks first, so typed text is never lost by accident. */
  dismissSheet(): void {
    if (this.sheet.hidden) return;
    if (this.mayDismiss && !this.mayDismiss()) return;
    this.closeSheet();
  }

  /** Closes the sheet. A compose sheet's onCancel runs (removing its unsaved pin) unless
   *  `canceled` is false, which is how a successful save will close it. */
  closeSheet(canceled = true): void {
    if (this.sheet.hidden) return;
    this.sheet.hidden = true;
    this.root.classList.remove("sheet-open");
    this.sheet.classList.remove("open");
    this.sheet.replaceChildren();
    this.mayDismiss = null;
    const cb = this.onSheetClose;
    this.onSheetClose = null;
    if (canceled) cb?.();
  }

  private show(children: Node[], onClose: (() => void) | null): void {
    this.closeSheet();
    this.sheet.replaceChildren(el("div", { class: "grab", "aria-hidden": "true" }), ...children);
    this.sheet.setAttribute("aria-labelledby", "ttf-sheet-h");
    this.onSheetClose = onClose;
    this.sheet.hidden = false;
    this.hideCursor();
    this.root.classList.add("sheet-open");
    void this.sheet.offsetHeight; // start the slide-up from the closed position
    this.sheet.classList.add("open");
  }
}
