import type { Status } from "./api";
import { OVERLAY_CSS } from "./styles";

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
  | { kind: "reviewing"; count: number }
  | { kind: "not_assigned" }
  | { kind: "signed_out" }
  | { kind: "offline" };

/** A pin in DOCUMENT coordinates. */
export type PinView = { n: number; x: number; y: number; settled?: boolean; moved?: boolean; draft?: boolean };

export type ReadView = { n: number; body: string; status: Status; note: string | null; moved: boolean };

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

export const countLabel = (n: number): string => `${n} ${n === 1 ? "comment" : "comments"}`;

export class OverlayUI {
  readonly host: HTMLElement;
  private readonly root: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private readonly pinsLayer: HTMLDivElement;
  private readonly sheet: HTMLDivElement;
  private pins: PinView[] = [];
  private onSheetClose: (() => void) | null = null;
  onPinTap: (n: number) => void = () => {};

  constructor(private readonly doc: Document, private readonly dashboardUrl: string) {
    this.host = doc.createElement("tap-to-fix-overlay");
    // Open, not closed: tests need to reach in, and the page can already read the token anyway.
    const shadow = this.host.attachShadow({ mode: "open" });
    const style = el("style");
    style.textContent = OVERLAY_CSS;
    this.bar = el("div", { class: "bar", "data-ttf": "bar", role: "region", "aria-label": "Review bar" });
    this.pinsLayer = el("div", { class: "pins", "data-ttf": "pins" });
    this.sheet = el("div", { class: "sheet", "data-ttf": "sheet", role: "dialog", "aria-modal": "false" });
    this.sheet.hidden = true;
    this.root = el("div", { class: "root" }, this.pinsLayer, this.bar, this.sheet);
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
    const link = (text: string) => el("a", { href: this.dashboardUrl }, text);
    const warn = (text: string) => el("span", { class: "msg" }, icon(ALERT_ICON), text);
    let content: Node[];
    switch (state.kind) {
      case "loading":
        content = [el("span", { class: "msg" }, "Opening your review…")];
        break;
      case "reviewing":
        content = [el("span", { class: "msg" }, el("b", {}, "Reviewing"), ` · ${countLabel(state.count)}`), link("Done")];
        break;
      case "not_assigned":
        content = [warn("This page isn't on your review list"), link("Back to your list")];
        break;
      case "signed_out":
        content = [warn("This link no longer works. Ask for a new one.")];
        break;
      case "offline":
        content = [warn("Can't reach the review service right now.")];
        break;
    }
    this.bar.replaceChildren(...content);
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
    const nodes = this.pins.map((p) => {
      const cls = ["pin", p.settled ? "settled" : "", p.moved ? "moved" : "", p.draft ? "new" : ""].filter(Boolean);
      const b = el(
        "button",
        { type: "button", class: cls.join(" "), "data-ttf": "pin", "aria-label": `Comment ${p.n}` },
        el("span", { class: "dot" }, String(p.n)),
      );
      b.style.left = `${p.x - ox - 22}px`;
      b.style.top = `${p.y - oy - 22}px`;
      if (p.draft) b.tabIndex = -1;
      else b.addEventListener("click", () => this.onPinTap(p.n));
      return b;
    });
    this.pinsLayer.replaceChildren(...nodes);
  }

  get sheetOpen(): boolean {
    return !this.sheet.hidden;
  }

  /** The compose sheet. Resolves nothing; callbacks carry the outcome. */
  openCompose(opts: { describe: string; onCancel: () => void; onSave: (text: string) => void }): HTMLTextAreaElement {
    const textarea = el("textarea", { rows: "4", "aria-label": "Your comment", autofocus: "" });
    const save = el("button", { type: "button", class: "btn primary", "data-ttf": "save" }, "Save comment");
    const cancel = el("button", { type: "button", class: "btn ghost" }, "Cancel");
    save.addEventListener("click", () => opts.onSave(textarea.value));
    cancel.addEventListener("click", () => this.closeSheet());
    this.show(
      [
        el("h2", { class: "sheet-h", id: "ttf-sheet-h" }, "What should change here?"),
        el("p", { class: "sub", "data-ttf": "sub" }, opts.describe),
        textarea,
        el("div", { class: "actions" }, save, cancel),
      ],
      opts.onCancel,
    );
    textarea.focus({ preventScroll: true });
    return textarea;
  }

  openRead(view: ReadView): void {
    const close = el("button", { type: "button", class: "btn ghost" }, "Close");
    close.addEventListener("click", () => this.closeSheet());
    const badge = el(
      "span",
      { class: ["badge", isSettled(view.status) ? "settled" : "", view.moved ? "moved" : ""].filter(Boolean).join(" ") },
      el("span", { class: "dot" }, String(view.n)),
    );
    if (view.moved) badge.append(el("span", { class: "moved-label" }, "moved"));
    const details = el(
      "div",
      {},
      el("h2", { class: "sheet-h", id: "ttf-sheet-h" }, "Your comment"),
      el("p", { class: "body" }, view.body),
      el("span", { class: isSettled(view.status) ? "status settled" : "status" }, STATUS_LABELS[view.status] ?? view.status),
    );
    if ((view.status === "later" || view.status === "kept") && view.note) {
      details.append(el("p", { class: "note" }, view.note));
    }
    this.show([el("div", { class: "read-head" }, badge, details), el("div", { class: "actions" }, close)], null);
    close.focus({ preventScroll: true });
  }

  /** Closes the sheet. A compose sheet's onCancel runs (removing its unsaved pin) unless
   *  `canceled` is false, which is how a successful save will close it. */
  closeSheet(canceled = true): void {
    if (this.sheet.hidden) return;
    this.sheet.hidden = true;
    this.sheet.classList.remove("open");
    this.sheet.replaceChildren();
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
    void this.sheet.offsetHeight; // start the slide-up from the closed position
    this.sheet.classList.add("open");
  }

}
