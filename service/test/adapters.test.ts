import { describe, expect, it } from "vitest";
import { createD1 } from "../src/node/d1-sqlite";
import { createR2 } from "../src/node/r2-memory";

describe("d1-sqlite", () => {
  const setup = async () => {
    const db = createD1();
    await db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
    return db;
  };

  it("binds, runs, and reads with first/all/raw", async () => {
    const db = await setup();
    const r = await db.prepare("INSERT INTO t (name) VALUES (?)").bind("a").run();
    expect(r.success).toBe(true);
    expect(r.meta.changes).toBe(1);
    expect(r.meta.last_row_id).toBe(1);
    await db.prepare("INSERT INTO t (name) VALUES (?)").bind("b").run();
    expect(await db.prepare("SELECT name FROM t WHERE id = ?").bind(2).first("name")).toBe("b");
    expect(await db.prepare("SELECT * FROM t WHERE id = ?").bind(9).first()).toBeNull();
    const all = await db.prepare("SELECT name FROM t ORDER BY id").all<{ name: string }>();
    expect(all.results).toEqual([{ name: "a" }, { name: "b" }]);
    expect(await db.prepare("SELECT id, name FROM t ORDER BY id").raw()).toEqual([[1, "a"], [2, "b"]]);
  });

  it("rolls a batch back on error", async () => {
    const db = await setup();
    await expect(
      db.batch([
        db.prepare("INSERT INTO t (name) VALUES (?)").bind("ok"),
        db.prepare("INSERT INTO t (name) VALUES (?)").bind(null),
      ]),
    ).rejects.toThrow();
    const row = await db.prepare("SELECT COUNT(*) AS n FROM t").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("enforces foreign keys", async () => {
    const db = createD1();
    await db.exec("CREATE TABLE p (id INTEGER PRIMARY KEY); CREATE TABLE c (pid INTEGER REFERENCES p(id))");
    await expect(db.prepare("INSERT INTO c (pid) VALUES (1)").run()).rejects.toThrow();
  });
});

describe("r2-memory", () => {
  it("round-trips put/get/head/delete", async () => {
    const r2 = createR2();
    await r2.put("k", new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: "image/png" } });
    const obj = await r2.get("k");
    expect(obj?.size).toBe(3);
    expect(obj?.httpMetadata?.contentType).toBe("image/png");
    expect(new Uint8Array(await obj!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect((await (await r2.get("k"))!.body.getReader().read()).value).toEqual(new Uint8Array([1, 2, 3]));
    expect((await r2.head("k"))?.size).toBe(3);
    await r2.delete(["k"]);
    expect(await r2.get("k")).toBeNull();
    expect(await r2.head("k")).toBeNull();
  });
});
