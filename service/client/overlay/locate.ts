export type Locator = {
  selector: string;
  element_text: string;
  element_x: number;
  element_y: number;
  page_x: number;
  page_y: number;
};

export type StoredLocator = {
  selector: string | null;
  element_text: string | null;
  element_x: number | null;
  element_y: number | null;
  page_x: number | null;
  page_y: number | null;
};

const collapse = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();
const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

function usableId(el: Element): boolean {
  const id = el.id;
  if (!id || id.length > 40 || /\d{4,}/.test(id)) return false;
  const esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id;
  return el.ownerDocument.querySelectorAll("#" + esc).length === 1;
}

function idSelector(el: Element): string {
  const id = el.id;
  return "#" + (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id);
}

export function buildSelector(el: Element): string {
  if (usableId(el)) return idSelector(el);
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur) {
    if (cur !== el && usableId(cur)) {
      parts.unshift(idSelector(cur));
      break;
    }
    const tag = cur.tagName.toLowerCase();
    if (cur === cur.ownerDocument.body || cur === cur.ownerDocument.documentElement) {
      parts.unshift(tag);
      break;
    }
    const parent: Element | null = cur.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const same = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
    parts.unshift(`${tag}:nth-of-type(${same.indexOf(cur) + 1})`);
    cur = parent;
  }
  return parts.join(" > ");
}

function quote(text: string): string {
  const t = collapse(text);
  return "“" + (t.length > 40 ? t.slice(0, 40).trimEnd() + "…" : t) + "”";
}

export function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const text = el.textContent ?? "";
  if (/^h[1-6]$/.test(tag)) return `the heading ${quote(text)}`;
  if (tag === "a") return `the link ${quote(text)}`;
  if (tag === "button") return `the button ${quote(text)}`;
  if (tag === "img") return `the image ${quote(el.getAttribute("alt") ?? "")}`;
  if (tag === "p") return `the paragraph ${quote(text)}`;
  if (tag === "li") return `the list item ${quote(text)}`;
  return "this spot";
}

/** Joins the selectors of a frame path: the iframe in its parent page, then the spot inside it. */
export const FRAME_SEP = " >>> ";

const isElement = (n: unknown): n is Element => !!n && (n as Node).nodeType === 1;

/** The document inside a same-origin <iframe> or <frame>; null for anything else, or cross-origin. */
export function frameDoc(el: Element): Document | null {
  const tag = el.tagName;
  if (tag !== "IFRAME" && tag !== "FRAME") return null;
  try {
    const d = (el as HTMLIFrameElement).contentDocument;
    // Reading the document of a cross-origin frame throws or gives null; probe it too.
    return d && d.documentElement ? d : null;
  } catch {
    return null;
  }
}

/** Every same-origin frame document inside `doc`, nested ones included, outermost first. */
export function frameDocs(doc: Document, limit = 50): Document[] {
  const out: Document[] = [];
  const walk = (d: Document) => {
    for (const f of Array.from(d.querySelectorAll("iframe, frame"))) {
      if (out.length >= limit) return;
      const inner = frameDoc(f);
      if (inner && !out.includes(inner)) {
        out.push(inner);
        walk(inner);
      }
    }
  };
  walk(doc);
  return out;
}

/**
 * Where (0, 0) of `inner`'s viewport is in `top`'s viewport: the sum, over every frame between
 * them, of the frame's box plus its border and padding. (0, 0) when `inner` is `top`, or when
 * the chain breaks (a cross-origin frame in between).
 */
export function frameOffset(inner: Document, top: Document): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let d: Document = inner;
  for (let depth = 0; d !== top && depth < 20; depth++) {
    let fe: Element | null = null;
    try {
      fe = d.defaultView?.frameElement ?? null;
    } catch {
      fe = null;
    }
    if (!fe) return { x: 0, y: 0 };
    const r = fe.getBoundingClientRect();
    const cs = fe.ownerDocument.defaultView?.getComputedStyle(fe);
    x += r.left + fe.clientLeft + (parseFloat(cs?.paddingLeft ?? "") || 0);
    y += r.top + fe.clientTop + (parseFloat(cs?.paddingTop ?? "") || 0);
    d = fe.ownerDocument;
  }
  return d === top ? { x, y } : { x: 0, y: 0 };
}

/** A point in the viewport of `from` (an event's clientX/Y inside a frame), in `top`'s viewport. */
export function toTopPoint(from: Document, top: Document, x: number, y: number): { x: number; y: number } {
  const o = frameOffset(from, top);
  return { x: x + o.x, y: y + o.y };
}

/** The element's box in `top`'s viewport, wherever the element lives. */
export type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };

export function topRect(el: Element, top: Document): Box {
  const r = el.getBoundingClientRect();
  const o = frameOffset(el.ownerDocument, top);
  const left = r.left + o.x;
  const t = r.top + o.y;
  return { left, top: t, right: left + r.width, bottom: t + r.height, width: r.width, height: r.height };
}

/** The innermost element at a point of `top`'s viewport, looking inside same-origin frames. */
export function deepElementFromPoint(top: Document, x: number, y: number): Element | null {
  let d = top;
  let px = x;
  let py = y;
  let hit = d.elementFromPoint(px, py);
  for (let depth = 0; hit && depth < 20; depth++) {
    const inner = frameDoc(hit);
    if (!inner) break;
    const o = frameOffset(inner, d);
    px -= o.x;
    py -= o.y;
    d = inner;
    const next = d.elementFromPoint(px, py);
    if (!next) break;
    hit = next;
  }
  return hit;
}

/** buildSelector, plus the frames the element sits in: `iframe selector >>> selector inside it`. */
export function framedSelector(el: Element, top: Document): string {
  const parts = [buildSelector(el)];
  let d = el.ownerDocument;
  for (let depth = 0; d !== top && depth < 20; depth++) {
    let fe: Element | null = null;
    try {
      fe = d.defaultView?.frameElement ?? null;
    } catch {
      fe = null;
    }
    if (!fe) break;
    parts.unshift(buildSelector(fe));
    d = fe.ownerDocument;
  }
  return parts.join(FRAME_SEP);
}

/** The element a stored selector names, following ` >>> ` into same-origin frames. */
export function resolveSelector(doc: Document, selector: string): Element | null {
  const parts = selector.split(FRAME_SEP);
  let d: Document = doc;
  try {
    for (let i = 0; i < parts.length - 1; i++) {
      const f = d.querySelector(parts[i]!);
      const inner = f ? frameDoc(f) : null;
      if (!inner) return null;
      d = inner;
    }
    return d.querySelector(parts[parts.length - 1]!);
  } catch {
    return null;
  }
}

/**
 * Where a tap at (clientX, clientY) lands. The point is in `top`'s viewport (the page the
 * overlay runs on) even when `el` is inside a same-origin frame; page_x/page_y are `top`'s
 * page coordinates, element_x/element_y are fractions of the element's own box.
 */
export function locatorFor(el: Element, clientX: number, clientY: number, top: Document = el.ownerDocument): Locator {
  const r = topRect(el, top);
  const sx = top.defaultView?.scrollX ?? 0;
  const sy = top.defaultView?.scrollY ?? 0;
  return {
    selector: framedSelector(el, top),
    element_text: collapse(el.textContent).slice(0, 200),
    element_x: r.width > 0 ? clamp01((clientX - r.left) / r.width) : 0,
    element_y: r.height > 0 ? clamp01((clientY - r.top) / r.height) : 0,
    page_x: clientX + sx,
    page_y: clientY + sy,
  };
}

function pointIn(doc: Document, el: Element, c: StoredLocator): { x: number; y: number } {
  const r = topRect(el, doc);
  const sx = doc.defaultView?.scrollX ?? 0;
  const sy = doc.defaultView?.scrollY ?? 0;
  return {
    x: r.left + sx + clamp01(c.element_x ?? 0.5) * r.width,
    y: r.top + sy + clamp01(c.element_y ?? 0.5) * r.height,
  };
}

/** The pin for a stored comment, in `doc`'s page coordinates (frames included). */
export function findPin(doc: Document, c: StoredLocator): { x: number; y: number; moved: boolean } | null {
  const text = c.element_text === null ? null : collapse(c.element_text);
  if (c.selector) {
    const el = resolveSelector(doc, c.selector);
    if (el && (text === null || collapse(el.textContent).startsWith(text.slice(0, 40)))) {
      return { ...pointIn(doc, el, c), moved: false };
    }
  }
  if (text) {
    let n = 0;
    for (const d of [doc, ...frameDocs(doc)]) {
      for (const el of Array.from(d.querySelectorAll("body *"))) {
        if (++n > 2000) break;
        if (isElement(el) && collapse(el.textContent) === text) return { ...pointIn(doc, el, c), moved: false };
      }
    }
  }
  if (c.page_x !== null && c.page_y !== null) return { x: c.page_x, y: c.page_y, moved: true };
  return null;
}

export async function shrinkToFit(
  encode: (scale: number, quality: number) => Promise<Blob | null>,
  maxBytes: number,
): Promise<Blob | null> {
  try {
    for (const scale of [1, 0.8, 0.64, 0.51]) {
      for (const quality of [0.85, 0.7, 0.55, 0.4]) {
        const blob = await encode(scale, quality);
        if (blob && blob.size <= maxBytes) return blob;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function targetSize(w: number, h: number, maxWidth = 1200): { w: number; h: number } {
  if (w <= maxWidth) return { w, h };
  return { w: maxWidth, h: Math.round((h * maxWidth) / w) };
}
