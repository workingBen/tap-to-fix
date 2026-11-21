// Node-only D1 stand-in over node:sqlite, for tests. Not bundled into the Worker.
import { DatabaseSync } from "node:sqlite";

type SqlValue = null | number | bigint | string | Uint8Array;

class Statement {
  constructor(
    readonly db: DatabaseSync,
    readonly sql: string,
    readonly values: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new Statement(this.db, this.sql, values.map((v) => (v === undefined ? null : v)) as SqlValue[]);
  }

  async first<T = unknown>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.values) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column === undefined ? { ...row } : row[column]) as T;
  }

  async all<T = unknown>() {
    const results = this.db.prepare(this.sql).all(...this.values).map((r) => ({ ...r })) as T[];
    return { results, success: true as const, meta: { changes: 0, last_row_id: 0 } };
  }

  async run() {
    const r = this.db.prepare(this.sql).run(...this.values);
    return {
      success: true as const,
      results: [],
      meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) },
    };
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const stmt = this.db.prepare(this.sql);
    stmt.setReturnArrays(true);
    return stmt.all(...this.values) as unknown as T[];
  }
}

export function createD1(path = ":memory:"): D1Database {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  const d1 = {
    prepare: (sql: string) => new Statement(db, sql),
    async exec(sql: string) {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
    async batch(statements: Statement[]) {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return d1 as unknown as D1Database;
}
