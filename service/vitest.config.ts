import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // e2e/ holds Playwright specs; they run with `npm run e2e`, not Vitest.
  test: { environment: "node", setupFiles: ["./test/setup.ts"], include: ["test/**/*.test.ts"], exclude: [...configDefaults.exclude, "e2e/**"] },
});
