import type { D1Migration } from "@cloudflare/vitest-pool-workers";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      SHOTS: R2Bucket;
      OWNER_TOKEN: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
