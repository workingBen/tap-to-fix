import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs, not type-checked
import { loadConfig, saveConfig } from "../../../bin/lib/config.mjs";

describe("config", () => {
  it("returns null when nothing is configured", () => {
    expect(loadConfig({ env: {}, home: mkdtempSync(join(tmpdir(), "ttf-")) })).toBeNull();
  });
  it("saves 0600 in a 0700 folder and loads it back", () => {
    const home = mkdtempSync(join(tmpdir(), "ttf-"));
    const file = saveConfig({ service: "https://s.example", owner_token: "tok" }, { home });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, ".config", "tap-to-fix")).mode & 0o777).toBe(0o700);
    expect(loadConfig({ env: {}, home })).toEqual({ service: "https://s.example", owner_token: "tok" });
  });
  it("keeps link_key in the file when given, and loadConfig still returns only the sign-in fields", () => {
    const home = mkdtempSync(join(tmpdir(), "ttf-"));
    const file = saveConfig({ service: "https://s.example", owner_token: "tok", link_key: "KEY" }, { home });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ service: "https://s.example", owner_token: "tok", link_key: "KEY" });
    expect(loadConfig({ env: {}, home })).toEqual({ service: "https://s.example", owner_token: "tok" });
    saveConfig({ service: "https://s.example", owner_token: "tok" }, { home });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ service: "https://s.example", owner_token: "tok" });
  });
  it("env wins over the file", () => {
    const home = mkdtempSync(join(tmpdir(), "ttf-"));
    saveConfig({ service: "https://file", owner_token: "file" }, { home });
    expect(loadConfig({ env: { TTF_SERVICE: "https://env/", TTF_OWNER_TOKEN: "envtok" }, home })).toEqual({
      service: "https://env",
      owner_token: "envtok",
    });
  });
});
