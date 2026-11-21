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

export function locatorFor(el: Element, clientX: number, clientY: number): Locator {
  const r = el.getBoundingClientRect();
  const sx = el.ownerDocument.defaultView?.scrollX ?? 0;
  const sy = el.ownerDocument.defaultView?.scrollY ?? 0;
  return {
    selector: buildSelector(el),
    element_text: collapse(el.textContent).slice(0, 200),
    element_x: r.width > 0 ? clamp01((clientX - r.left) / r.width) : 0,
    element_y: r.height > 0 ? clamp01((clientY - r.top) / r.height) : 0,
    page_x: clientX + sx,
    page_y: clientY + sy,
  };
}

function pointIn(doc: Document, el: Element, c: StoredLocator): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  const sx = doc.defaultView?.scrollX ?? 0;
  const sy = doc.defaultView?.scrollY ?? 0;
  return {
    x: r.left + sx + clamp01(c.element_x ?? 0.5) * r.width,
    y: r.top + sy + clamp01(c.element_y ?? 0.5) * r.height,
  };
}

export function findPin(doc: Document, c: StoredLocator): { x: number; y: number; moved: boolean } | null {
  const text = c.element_text === null ? null : collapse(c.element_text);
  if (c.selector) {
    let el: Element | null = null;
    try {
      el = doc.querySelector(c.selector);
    } catch {
      el = null;
    }
    if (el && (text === null || collapse(el.textContent).startsWith(text.slice(0, 40)))) {
      return { ...pointIn(doc, el, c), moved: false };
    }
  }
  if (text) {
    let n = 0;
    for (const el of Array.from(doc.querySelectorAll("body *"))) {
      if (++n > 2000) break;
      if (collapse(el.textContent) === text) return { ...pointIn(doc, el, c), moved: false };
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
