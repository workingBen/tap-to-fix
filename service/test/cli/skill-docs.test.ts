import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
// @ts-expect-error plain .mjs, not type-checked
import { commands } from "../../../bin/lib/commands.mjs";

const root = resolve(__dirname, "../../..");
const skillsDir = join(root, "skills");
const readJson = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"));

/** Every skills/<name>/SKILL.md that exists (setup may not exist yet). */
function skillFiles(): string[] {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir)
    .map((d) => join(skillsDir, d, "SKILL.md"))
    .filter((f) => existsSync(f));
}

/** Text that is a command: fenced code blocks, plus inline code spans with arguments (a bare name like an env var is not a command). */
function commandText(md: string): string[] {
  const fenced = [...md.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const prose = md.replace(/```[^\n]*\n[\s\S]*?```/g, "");
  const inline = [...prose.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]).filter((s) => /\s/.test(s.trim()));
  return [...fenced, ...inline];
}

const fixPath = join(skillsDir, "fix", "SKILL.md");
const fix = () => readFileSync(fixPath, "utf8");

describe("plugin manifest", () => {
  it("plugin.json parses with the right name and version", () => {
    const p = readJson(".claude-plugin/plugin.json");
    expect(p.name).toBe("tap-to-fix");
    expect(p.version).toBe("0.1.0");
    expect(p.license).toBe("MIT");
    expect(p.author?.name).toBe("workingBen");
    expect(typeof p.repository).toBe("string");
    expect(typeof p.description).toBe("string");
  });

  it("marketplace.json lists the plugin at the repo root", () => {
    const m = readJson(".claude-plugin/marketplace.json");
    const entry = (m.plugins ?? []).find((x: { name: string }) => x.name === "tap-to-fix");
    expect(entry).toBeTruthy();
    expect(entry.source).toBe("./");
  });
});

describe("skill docs", () => {
  it("finds the fix skill", () => {
    expect(skillFiles()).toContain(fixPath);
  });

  it("every ttf subcommand named in a skill exists in the command table", () => {
    const named = new Set<string>();
    for (const f of skillFiles()) {
      const md = readFileSync(f, "utf8");
      for (const m of md.matchAll(/ttf\.mjs"?\s+([a-z][a-z_-]*)/g)) named.add(m[1]);
      for (const m of md.matchAll(/`ttf\s+([a-z][a-z_-]*)/g)) named.add(m[1]);
    }
    expect(named.size).toBeGreaterThan(0);
    for (const n of named) expect(Object.keys(commands), `ttf ${n}`).toContain(n);
  });

  it("no skill puts the owner token in a command", () => {
    for (const f of skillFiles()) {
      for (const cmd of commandText(readFileSync(f, "utf8"))) {
        expect(cmd, f).not.toMatch(/owner_token=/i);
        expect(cmd, f).not.toContain("OWNER_TOKEN");
      }
    }
  });

  it("fix skill has the frontmatter name and the trigger", () => {
    const md = fix();
    expect(md).toMatch(/^---\nname: fix\n/);
    expect(md).toContain("/tap-to-fix:fix");
    expect(md).toMatch(/fix Alexis's comments/);
  });

  it("fix skill checks prerequisites, the repo and the empty batch", () => {
    const md = fix();
    expect(md).toContain("proofs:review-cycle");
    expect(md).toContain("/tap-to-fix:setup");
    expect(md).toContain("~/.config/tap-to-fix/config.json");
    expect(md).toMatch(/Repo check/);
    expect(md).toContain("site.repo");
    expect(md).toContain("git remote get-url origin");
    expect(md).toContain("--from");
    expect(md).toMatch(/Exit `2`/);
  });

  it("fix skill carries all five status rules and the flush", () => {
    const md = fix();
    expect(md).toMatch(/ttf\.mjs" status <id> in_progress/);
    expect(md).toMatch(/ttf\.mjs" status <id> done --pr /);
    expect(md).toMatch(/ttf\.mjs" status <id> later --note /);
    expect(md).toMatch(/ttf\.mjs" status <id> kept --note /);
    expect(md).toMatch(/design review[^\n]*stays `in_progress`/i);
    expect(md).toMatch(/ttf\.mjs" flush/);
    expect(md).toMatch(/Never mark a comment `done` before its PR is merged/);
    expect(md).toContain("${CLAUDE_PLUGIN_ROOT}/bin/ttf.mjs");
  });
});
