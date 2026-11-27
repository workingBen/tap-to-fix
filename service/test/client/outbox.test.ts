import { describe, expect, it } from "vitest";
import {
  asComment,
  memoryStore,
  newClientId,
  offlineStore,
  Outbox,
  outcomeOf,
  RETRY_MS,
  STUCK_AFTER,
  type OfflineStore,
  type Queued,
  type SendResult,
} from "../../client/overlay/outbox";

let seq = 0;
function item(over: Partial<Queued> = {}): Queued {
  const client_id = over.client_id ?? `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  return {
    client_id,
    token: "tok",
    site: "fixture",
    path: "/index.html",
    data: {
      site: "fixture",
      path: "/index.html",
      body: `comment ${seq}`,
      client_id,
      selector: "h1",
      element_text: "Welcome",
      element_x: 0.5,
      element_y: 0.5,
      page_x: 40,
      page_y: 60,
      viewport_w: 390,
      viewport_h: 844,
      device: "phone",
    },
    shot: null,
    created_at: new Date(Date.UTC(2026, 10, 27, 12, 0, seq)).toISOString(),
    ...over,
  };
}

/** An outbox over the in-memory store, with a scripted service and a hand-run timer. */
function harness(answers: ((q: Queued) => SendResult)[] = [], store: OfflineStore = memoryStore()) {
  const sent: string[] = [];
  const allSent: number[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  let online = true;
  const box = new Outbox({
    store,
    token: "tok",
    site: "fixture",
    send: async (q) => {
      const answer = answers.shift() ?? (() => ({ ok: true, id: `srv-${q.client_id}` }));
      const r = answer(q);
      if (r.ok) sent.push(q.client_id);
      return r;
    },
    online: () => online,
    onChange: () => {},
    onSent: () => {},
    onAllSent: (n) => allSent.push(n),
    setTimer: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      const i = timers.indexOf(t as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  return {
    box,
    store,
    sent,
    allSent,
    timers,
    setOnline: (v: boolean) => (online = v),
    /** Runs the next retry timer and waits for its batch. */
    async tick() {
      const t = timers.shift();
      if (!t) throw new Error("no retry scheduled");
      t.fn();
      await box.flush();
    },
  };
}

const offline = (): SendResult => ({ ok: false });
const refuse = (status: number) => (): SendResult => ({ ok: false, status });

describe("outcomeOf", () => {
  it("sorts answers into what happens next", () => {
    expect(outcomeOf({ ok: true, id: "x" })).toBe("sent");
    expect(outcomeOf({ ok: false })).toBe("offline");
    for (const s of [408, 429, 500, 503]) expect(outcomeOf({ ok: false, status: s })).toBe("later");
    for (const s of [400, 401, 403, 413]) expect(outcomeOf({ ok: false, status: s })).toBe("refused");
  });
});

describe("Outbox", () => {
  it("keeps a comment on the phone until the service confirms it, then removes it", async () => {
    const h = harness([offline]);
    const q = item();
    await h.box.add(q);
    expect(await h.store.queued()).toHaveLength(1);
    expect((await h.box.sendOne(q)).outcome).toBe("offline");
    expect(h.box.view().offline).toBe(true);
    expect(await h.store.queued()).toHaveLength(1); // a failed send keeps it
    expect(h.timers.map((t) => t.ms)).toEqual([RETRY_MS[0]]);
    await h.tick();
    expect(h.sent).toEqual([q.client_id]);
    expect(await h.store.queued()).toEqual([]);
    expect(h.box.view()).toMatchObject({ waiting: [], offline: false, failed: [] });
    expect(h.allSent).toEqual([1]);
  });

  it("sends oldest first and counts progress through the batch", async () => {
    const seen: (string | null)[] = [];
    const store = memoryStore();
    const a = item();
    const b = item();
    const c = item();
    for (const q of [c, a, b]) await store.put(q);
    let box!: Outbox;
    box = new Outbox({
      store,
      token: "tok",
      site: "fixture",
      send: async (q) => {
        const p = box.view().sending;
        seen.push(p ? `${q.client_id.slice(-1)}:${p.done}/${p.total}` : null);
        return { ok: true, id: "x" };
      },
      online: () => true,
      onChange: () => {},
      onSent: () => {},
      onAllSent: () => {},
    });
    await box.load();
    expect(box.view().waiting.map((q) => q.client_id)).toEqual([a, b, c].map((q) => q.client_id));
    await box.flush();
    expect(seen).toEqual([`${a.client_id.slice(-1)}:0/3`, `${b.client_id.slice(-1)}:1/3`, `${c.client_id.slice(-1)}:2/3`]);
    expect(box.view().sending).toBeNull();
  });

  it("stops at the first network failure (the rest would fail too) and retries with backoff", async () => {
    const h = harness([() => ({ ok: true, id: "1" }), offline, offline, offline]);
    for (let i = 0; i < 3; i++) await h.box.add(item());
    await h.box.flush();
    expect(h.sent).toHaveLength(1);
    expect(h.box.view().waiting).toHaveLength(2);
    expect(h.box.view().offline).toBe(true);
    expect(h.box.view().failed).toEqual([]); // offline is not a failure
    expect(h.allSent).toEqual([]);
    await h.tick();
    await h.tick();
    expect(h.timers.map((t) => t.ms)).toEqual([RETRY_MS[2]]);
    await h.tick();
    expect(h.sent).toHaveLength(3);
    expect(h.timers).toEqual([]);
  });

  it("a refusal no retry fixes is kept, marked, and does not hold up the others", async () => {
    const h = harness([refuse(403)]);
    const bad = item();
    const good = item();
    await h.box.add(bad);
    await h.box.add(good);
    await h.box.flush();
    expect(h.sent).toEqual([good.client_id]);
    const v = h.box.view();
    expect(v.waiting.map((q) => q.client_id)).toEqual([bad.client_id]);
    expect(v.failed.map((q) => q.refused)).toEqual([403]);
    expect((await h.store.queued())[0].refused).toBe(403); // remembered across reloads
    expect(h.timers).toEqual([]); // nothing left that retrying would help
    // Automatic sends skip it; "Try again now" includes it.
    await h.box.flush();
    expect(h.sent).toEqual([good.client_id]);
    await h.box.retryNow();
    expect(h.sent).toEqual([good.client_id, bad.client_id]);
    expect(h.box.view().failed).toEqual([]);
  });

  it("repeated service errors turn into a failure the reviewer is told about", async () => {
    const h = harness(Array.from({ length: STUCK_AFTER }, () => refuse(503)));
    await h.box.add(item());
    await h.box.flush();
    expect(h.box.view().failed).toEqual([]);
    for (let i = 1; i < STUCK_AFTER; i++) await h.tick();
    expect(h.box.view().failed).toHaveLength(1);
    expect(h.box.view().offline).toBe(false);
    await h.tick(); // still retrying on its own
    expect(h.box.view().failed).toEqual([]);
    expect(h.box.view().waiting).toEqual([]);
  });

  it("429 waits a minute and is not counted as a fault", async () => {
    const h = harness(Array.from({ length: 5 }, () => refuse(429)));
    await h.box.add(item());
    await h.box.flush();
    expect(h.timers.map((t) => t.ms)).toEqual([60_000]);
    for (let i = 0; i < 4; i++) await h.tick();
    expect(h.box.view().failed).toEqual([]);
  });

  it("never sends the same comment twice at once (the save flow and a batch)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const store = memoryStore();
    const box = new Outbox({
      store,
      token: "tok",
      site: "fixture",
      send: async () => {
        calls++;
        await gate;
        return { ok: true, id: "x" };
      },
      online: () => true,
      onChange: () => {},
      onSent: () => {},
      onAllSent: () => {},
    });
    const q = item();
    await box.add(q);
    const one = box.sendOne(q);
    const batch = box.flush();
    release();
    await Promise.all([one, batch]);
    expect(calls).toBe(1);
  });

  it("only this reviewer's comments on this site, and reconcile drops what the service has", async () => {
    const store = memoryStore();
    const mine = item();
    const other = item({ token: "someone-else" });
    const elsewhere = item({ site: "other-site" });
    const otherPath = item({ path: "/other.html" });
    for (const q of [mine, other, elsewhere, otherPath]) await store.put(q);
    const h = harness([], store);
    await h.box.load();
    expect(h.box.view().waiting.map((q) => q.client_id)).toEqual([mine.client_id, otherPath.client_id]);
    expect(h.box.waitingByPath()).toEqual({ "/index.html": 1, "/other.html": 1 });
    await h.box.reconcile(new Set([mine.client_id]));
    expect(h.box.view().waiting.map((q) => q.client_id)).toEqual([otherPath.client_id]);
    expect((await store.queued()).map((q) => q.client_id)).not.toContain(mine.client_id);
  });

  it("navigator.onLine is a hint: offline shows at once, and a real answer decides", async () => {
    const h = harness();
    h.setOnline(false);
    expect(h.box.view().offline).toBe(true);
    h.setOnline(true);
    h.box.noteReached(false);
    expect(h.box.view().offline).toBe(true); // the phone says online, the service did not answer
    h.box.noteReached(true);
    expect(h.box.view().offline).toBe(false);
  });

  it("drop forgets a comment for good", async () => {
    const h = harness([refuse(401)]);
    const q = item();
    await h.box.add(q);
    await h.box.flush();
    await h.box.drop(q.client_id);
    expect(h.box.view().waiting).toEqual([]);
    expect(await h.store.queued()).toEqual([]);
  });

  it("stop cancels the retry timer", async () => {
    const h = harness([offline]);
    await h.box.add(item());
    await h.box.flush();
    expect(h.timers).toHaveLength(1);
    h.box.stop();
    expect(h.timers).toHaveLength(0);
  });
});

describe("storage", () => {
  it("falls back to memory when IndexedDB is missing or throws", async () => {
    for (const win of [{} as Window, Object.defineProperty({}, "indexedDB", { get: () => { throw new Error("blocked"); } }) as Window]) {
      const store = offlineStore(win);
      const q = item();
      await store.put(q);
      expect((await store.queued()).map((x) => x.client_id)).toEqual([q.client_id]);
      await store.writeList("fixture\n/index.html", { token: "tok", comments: [] });
      expect(await store.readList("fixture\n/index.html")).toEqual({ token: "tok", comments: [] });
      expect(await store.readList("nope")).toBeNull();
      await store.remove(q.client_id);
      expect(await store.queued()).toEqual([]);
    }
  });

  it("a queued comment draws like a saved, open one", () => {
    const q = item();
    expect(asComment(q)).toMatchObject({ id: `local:${q.client_id}`, client_id: q.client_id, body: q.data.body, status: "open", page_x: 40 });
  });
});

describe("newClientId", () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  it("uses randomUUID when there is one", () => {
    expect(newClientId({ randomUUID: () => "11111111-2222-4333-8444-555555555555" } as unknown as Crypto)).toBe(
      "11111111-2222-4333-8444-555555555555",
    );
  });
  it("builds a version 4 UUID on older iOS (getRandomValues only, or nothing)", () => {
    const old = { getRandomValues: (b: Uint8Array) => b.fill(0xff) } as unknown as Crypto;
    expect(newClientId(old)).toMatch(uuid);
    expect(newClientId(undefined)).toMatch(uuid);
    expect(new Set(Array.from({ length: 50 }, () => newClientId(undefined))).size).toBe(50);
  });
});
