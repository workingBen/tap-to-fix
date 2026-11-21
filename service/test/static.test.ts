import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

describe("client build", () => {
  beforeAll(() => {
    execFileSync("node", ["scripts/build-client.mjs"], { stdio: "inherit" });
  }, 60_000);

  it("writes public/t.js and public/overlay.js", () => {
    expect(existsSync("public/t.js")).toBe(true);
    expect(existsSync("public/overlay.js")).toBe(true);
  });

  it("keeps the loader at or under 1500 bytes", () => {
    expect(statSync("public/t.js").size).toBeLessThanOrEqual(1500);
  });
});
