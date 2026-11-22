import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import app from "../src/index";
import type { Env } from "../src/env";
import { createD1 } from "../src/node/d1-sqlite";
import { createR2 } from "../src/node/r2-memory";

const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));

/** A fixed 32-byte base64url key, like the LINK_KEY deploy makes. */
export const TEST_LINK_KEY = "A".repeat(42) + "E";

export function makeEnv(): Env {
  const raw = createD1();
  for (const f of readdirSync(migrationsDir).filter((n) => n.endsWith(".sql")).sort()) {
    // exec is async in the D1 shape but synchronous underneath; see d1-sqlite.ts
    void raw.exec(readFileSync(migrationsDir + f, "utf8"));
  }
  return { DB: raw, SHOTS: createR2(), OWNER_TOKEN: "test-owner-token", LINK_KEY: TEST_LINK_KEY };
}

export function call(path: string, init?: RequestInit, env: Env = makeEnv()) {
  return app.fetch(new Request("http://x" + path, init), env);
}
