// Offline mode: every comment is written to the phone first, then sent. A comment leaves the
// phone only after the service confirms it (POST /api/me/comments answers with its id); each
// one carries its own client id, so a retry or a second tab can never save it twice.
//
// Storage is this site's IndexedDB (the overlay runs in the site's page, so it is the site's
// origin), behind a small interface so tests use the in-memory one. Safari can clear a site's
// storage after 7 days of using Safari without visiting it; the words on screen say "saved on
// this phone", never "saved for good".
import type { PageComment } from "./api";

/** One comment waiting on the phone. `data` is the POST body as the save flow built it. */
export type Queued = {
  client_id: string;
  /** The reviewer link it was written with; another reviewer on the same phone never sends it. */
  token: string;
  site: string;
  path: string;
  data: QueuedData;
  shot: Blob | null;
  created_at: string;
  /** An HTTP refusal no retry will fix (401, 403, 413…). The comment stays until the reviewer removes it. */
  refused?: number;
};

export type QueuedData = {
  site: string;
  path: string;
  body: string;
  client_id: string;
  selector: string | null;
  element_text: string | null;
  element_x: number | null;
  element_y: number | null;
  page_x: number | null;
  page_y: number | null;
  viewport_w: number;
  viewport_h: number;
  device: string;
};

/** The last comment list a page loaded, or that the page is not on this reviewer's list. */
export type CachedList = { token: string; comments: PageComment[] } | { token: string; not_assigned: true };

export interface OfflineStore {
  queued(): Promise<Queued[]>;
  put(q: Queued): Promise<void>;
  remove(clientId: string): Promise<void>;
  readList(key: string): Promise<CachedList | null>;
  writeList(key: string, list: CachedList): Promise<void>;
}

export function memoryStore(): OfflineStore {
  const queue = new Map<string, Queued>();
  const lists = new Map<string, CachedList>();
  return {
    queued: async () => [...queue.values()],
    put: async (q) => void queue.set(q.client_id, q),
    remove: async (id) => void queue.delete(id),
    readList: async (key) => lists.get(key) ?? null,
    writeList: async (key, list) => void lists.set(key, list),
  };
}

const DB_NAME = "tap-to-fix";
const QUEUE = "outbox";
const LISTS = "lists";

const done = (req: IDBRequest): Promise<unknown> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/**
 * The site's IndexedDB, or memory when it can't be opened (some private windows, storage
 * turned off). Memory still keeps comments for as long as the page stays open.
 */
export function offlineStore(win: Window): OfflineStore {
  const memory = memoryStore();
  let factory: IDBFactory | null = null;
  try {
    factory = win.indexedDB ?? null;
  } catch {
    factory = null;
  }
  let opened: Promise<IDBDatabase | null> | null = null;
  const db = (): Promise<IDBDatabase | null> =>
    (opened ??= new Promise<IDBDatabase | null>((resolve) => {
      if (!factory) return resolve(null);
      try {
        const req = factory.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(QUEUE, { keyPath: "client_id" });
          req.result.createObjectStore(LISTS);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    }));
  const run = async <T>(name: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest, fallback: () => Promise<T>): Promise<T> => {
    const d = await db();
    if (!d) return fallback();
    try {
      const tx = d.transaction(name, mode);
      // A write counts once its transaction has committed, not when the request succeeds.
      const committed = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
      const value = (await done(fn(tx.objectStore(name)))) as T;
      if (mode === "readwrite") await committed;
      else committed.catch(() => {});
      return value;
    } catch {
      return fallback();
    }
  };
  return {
    queued: () => run<Queued[]>(QUEUE, "readonly", (s) => s.getAll(), memory.queued),
    put: async (q) => {
      // Memory too: a write that fails on disk is still sent while this page is open.
      await memory.put(q);
      await run(QUEUE, "readwrite", (s) => s.put(q), async () => undefined);
    },
    remove: async (id) => {
      await memory.remove(id);
      await run(QUEUE, "readwrite", (s) => s.delete(id), async () => undefined);
    },
    readList: (key) => run<CachedList | null | undefined>(LISTS, "readonly", (s) => s.get(key), () => memory.readList(key)).then((v) => v ?? null),
    writeList: async (key, list) => {
      await memory.writeList(key, list);
      await run(LISTS, "readwrite", (s) => s.put(list, key), async () => undefined);
    },
  };
}

/** A UUID; older iOS Safari (before 15.4) has no crypto.randomUUID. */
export function newClientId(cr: Crypto | undefined = globalThis.crypto): string {
  if (cr && typeof cr.randomUUID === "function") return cr.randomUUID();
  const b = new Uint8Array(16);
  if (cr && typeof cr.getRandomValues === "function") cr.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A queued comment drawn like a saved one (its pin, its read sheet). */
export const asComment = (q: Queued): PageComment => ({
  id: `local:${q.client_id}`,
  client_id: q.client_id,
  body: q.data.body,
  status: "open",
  note: null,
  pr_url: null,
  selector: q.data.selector,
  element_text: q.data.element_text,
  element_x: q.data.element_x,
  element_y: q.data.element_y,
  page_x: q.data.page_x,
  page_y: q.data.page_y,
  created_at: q.created_at,
});

export type SendResult = { ok: true; id: string } | { ok: false; status?: number };

/** What a send's answer means for the comment. */
export type Outcome = "sent" | "offline" | "later" | "refused";
export function outcomeOf(r: SendResult): Outcome {
  if (r.ok) return "sent";
  if (r.status === undefined) return "offline"; // no answer at all: a network error or a timeout
  if (r.status === 408 || r.status === 429 || r.status >= 500) return "later";
  return "refused";
}

/** Waits between automatic retries while the page stays open; the last one repeats. */
export const RETRY_MS = [5_000, 15_000, 30_000, 60_000];
/** The service asked us to slow down (429): wait this long. */
const SLOW_DOWN_MS = 60_000;
/** Service errors (5xx) in a row before the reviewer is told a comment didn't send. */
export const STUCK_AFTER = 3;

export type OutboxView = {
  /** This reviewer's unsent comments on this site, oldest first (refused ones included). */
  waiting: Queued[];
  /** A batch under way: `done` of `total` sent so far. */
  sending: { done: number; total: number } | null;
  /** The phone says it's offline, or the last request never reached the service. */
  offline: boolean;
  /** Comments to tell the reviewer about: refused, or stuck behind repeated service errors. */
  failed: Queued[];
};

export type OutboxOptions = {
  store: OfflineStore;
  token: string;
  site: string;
  send: (q: Queued) => Promise<SendResult>;
  /** navigator.onLine: only a hint. A real request decides. */
  online: () => boolean;
  onChange: () => void;
  onSent: (q: Queued, id: string) => void;
  /** A batch finished with every comment in it sent. */
  onAllSent: (total: number) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
};

export class Outbox {
  private items: Queued[] = [];
  private readonly inFlight = new Set<string>();
  private flushing: Promise<void> | null = null;
  private progress: { done: number; total: number } | null = null;
  private unreachable = false;
  private serviceErrors = 0;
  private attempt = 0;
  private timer: unknown = null;
  private lastStatus: number | undefined;
  private stopped = false;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (t: unknown) => void;

  constructor(private readonly o: OutboxOptions) {
    this.setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  }

  /** Reads what is already waiting on the phone for this reviewer and site. */
  async load(): Promise<void> {
    const all = await this.o.store.queued().catch(() => [] as Queued[]);
    const known = new Set(this.items.map((q) => q.client_id));
    for (const q of all) if (q.token === this.o.token && q.site === this.o.site && !known.has(q.client_id)) this.items.push(q);
    this.sort();
    this.o.onChange();
  }

  view(): OutboxView {
    const stuck = this.serviceErrors >= STUCK_AFTER;
    return {
      waiting: [...this.items],
      sending: this.progress ? { ...this.progress } : null,
      offline: this.unreachable || !this.o.online(),
      failed: this.items.filter((q) => q.refused !== undefined || (stuck && !this.inFlight.has(q.client_id))),
    };
  }

  /** Unsent comments' client ids per page path, for the dashboard hand-off. */
  waitingByPath(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const q of this.items) (out[q.path] ??= []).push(q.client_id);
    return out;
  }

  /** A request did (or did not) reach the service, for the offline line. */
  noteReached(reached: boolean): void {
    if (this.unreachable === !reached) return;
    this.unreachable = !reached;
    this.o.onChange();
  }

  /** Writes a new comment to the phone. Nothing is sent yet. */
  async add(q: Queued): Promise<void> {
    this.items.push(q);
    this.sort();
    await this.o.store.put(q).catch(() => {});
    this.o.onChange();
  }

  /** Forgets a comment without sending it (the reviewer removed it, or the save sheet kept it). */
  async drop(clientId: string): Promise<void> {
    this.items = this.items.filter((q) => q.client_id !== clientId);
    await this.o.store.remove(clientId).catch(() => {});
    this.o.onChange();
  }

  /** The service already has these (its list carries their client ids): stop sending them. */
  async reconcile(onServer: Set<string>): Promise<void> {
    const gone = this.items.filter((q) => onServer.has(q.client_id) && !this.inFlight.has(q.client_id));
    if (!gone.length) return;
    this.items = this.items.filter((q) => !gone.includes(q));
    for (const q of gone) await this.o.store.remove(q.client_id).catch(() => {});
    this.o.onChange();
  }

  /** Sends one comment now (the save flow's own try): what happened, and the HTTP status if any. */
  async sendOne(q: Queued): Promise<{ outcome: Outcome; status?: number }> {
    if (this.inFlight.has(q.client_id)) return { outcome: "later" };
    const outcome = await this.deliver(q);
    if (outcome === "offline") this.schedule();
    return { outcome, status: this.lastStatus };
  }

  /** Sends everything waiting, oldest first. Refused comments wait for "Try again now". */
  flush(opts: { includeRefused?: boolean } = {}): Promise<void> {
    if (this.flushing) return this.flushing;
    this.cancelTimer();
    this.flushing = this.runBatch(!!opts.includeRefused).finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  /** "Try again now": every comment, refused ones too, right away. */
  async retryNow(): Promise<void> {
    if (this.flushing) await this.flushing;
    this.serviceErrors = 0;
    this.attempt = 0;
    await this.flush({ includeRefused: true });
  }

  stop(): void {
    this.stopped = true;
    this.cancelTimer();
  }

  private async runBatch(includeRefused: boolean): Promise<void> {
    const batch = this.items.filter((q) => !this.inFlight.has(q.client_id) && (includeRefused || q.refused === undefined));
    if (!batch.length || this.stopped) return;
    this.progress = { done: 0, total: batch.length };
    this.o.onChange();
    let all = true;
    for (const q of batch) {
      if (this.stopped) return;
      if (!this.items.includes(q)) {
        this.progress.done++; // sent meanwhile (another tab's list, or the save flow)
        continue;
      }
      const outcome = await this.deliver(q);
      if (outcome === "sent") {
        this.progress.done++;
        this.o.onChange();
        continue;
      }
      all = false;
      if (outcome === "refused") continue; // the next one may still go
      break; // offline or the service is struggling: the rest would fail the same way
    }
    const total = this.progress.total;
    this.progress = null;
    if (all) this.o.onAllSent(total);
    this.o.onChange();
    if (this.items.some((q) => q.refused === undefined)) this.schedule();
  }

  private async deliver(q: Queued): Promise<Outcome> {
    this.inFlight.add(q.client_id);
    let result: SendResult;
    try {
      result = await this.o.send(q);
    } catch {
      result = { ok: false };
    } finally {
      this.inFlight.delete(q.client_id);
    }
    const outcome = outcomeOf(result);
    this.unreachable = outcome === "offline";
    if (outcome === "sent" && result.ok) {
      this.serviceErrors = 0;
      this.attempt = 0;
      this.items = this.items.filter((x) => x.client_id !== q.client_id);
      await this.o.store.remove(q.client_id).catch(() => {});
      this.o.onSent(q, result.id);
    } else if (outcome === "refused" && !result.ok) {
      q.refused = result.status;
      await this.o.store.put(q).catch(() => {});
    } else if (outcome === "later" && !result.ok) {
      if (result.status !== 429) this.serviceErrors++; // slowing down is not a fault
    }
    this.lastStatus = result.ok ? undefined : result.status;
    this.o.onChange();
    return outcome;
  }

  private schedule(): void {
    if (this.stopped || this.timer !== null) return;
    const ms = this.lastStatus === 429 ? SLOW_DOWN_MS : RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)];
    this.attempt++;
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private sort(): void {
    this.items.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  }
}
