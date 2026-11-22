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
    expect(p.version).toBe("0.4.0");
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
      for (const m of md.matchAll(/<TTF>\s+([a-z][a-z_-]*)/g)) named.add(m[1]);
      for (const m of md.matchAll(/`ttf\s+([a-z][a-z_-]*)/g)) named.add(m[1]);
    }
    expect([...named]).toEqual(expect.arrayContaining(["batch", "status", "flush", "progress", "open"]));
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
    expect(md).toMatch(/<TTF> status <id> in_progress`/);
    expect(md).toMatch(/<TTF> status <id> done --pr /);
    expect(md).toMatch(/<TTF> status <id> later --note '/);
    expect(md).toMatch(/<TTF> status <id> kept --note '/);
    expect(md).toMatch(/design review[^\n]*stays `in_progress`/i);
    expect(md).toMatch(/<TTF> flush/);
    expect(md).toMatch(/Never mark a comment `done` before its PR is merged/);
    expect(md).toMatch(/start Investigate[^\n]*\*\*not\*\* at intake/);
  });

  it("fix skill resolves the CLI from the skill's base directory, not an env var", () => {
    const md = fix();
    expect(md).toContain("Base directory for this skill");
    expect(md).toContain("<dir>/../../bin/ttf.mjs");
    expect(md).not.toContain("CLAUDE_PLUGIN_ROOT");
    expect(md).toMatch(/Shell variables do not survive between Bash calls/);
    for (const cmd of commandText(md)) expect(cmd, "no shell variables carried across calls").not.toMatch(/\$DIR\b/);
  });

  it("fix skill survives checkpoints: resume line, progress, id tags", () => {
    const md = fix();
    expect(md).toContain("/tap-to-fix:fix <reviewer> <site> --resume");
    expect(md).toMatch(/<TTF> progress <reviewer> <site>/);
    expect(md).toContain("[ttf <comment id>]");
    expect(md).toMatch(/not final/);
  });

  it("fix skill keys re-run setup on the CLI's message, and resume pulls in_progress too", async () => {
    const md = fix();
    // @ts-expect-error plain .mjs, not type-checked
    const { TOKEN_REJECTED } = await import("../../../bin/lib/status.mjs");
    expect(md).toContain(TOKEN_REJECTED);
    expect(md).toContain("--status open,in_progress");
    expect(md).toMatch(/parked in a design review/);
  });

  it("fix skill never reports a repo-check crash as the wrong repo", () => {
    const md = fix();
    expect(md).toContain("process.exit(3)");
    expect(md).toMatch(/Never report a crash as "wrong repo"/);
  });

  it("fix skill with no arguments (or only a reviewer) lists with ttf open and picks with AskUserQuestion", () => {
    const md = fix();
    expect(md).toMatch(/## 2\. Pick a batch/);
    expect(md).toContain("node <TTF> open");
    expect(md).toContain("node <TTF> open <reviewer>");
    expect(md).toContain("AskUserQuestion");
    expect(md).toMatch(/most comments first/);
    expect(md).toMatch(/Nothing waiting/);
    expect(md).not.toMatch(/ask for it once/);
    expect(md.indexOf("## 2. Pick a batch")).toBeLessThan(md.indexOf("## 3. Pull the batch"));
  });

  it("no status or flush call in the skill passes --dir (folders live under ~/.tap-to-fix/batches)", () => {
    for (const cmd of commandText(fix())) expect(cmd).not.toMatch(/(status|flush)\b[^\n]*--dir/);
  });
});

describe("list skill", () => {
  const listPath = join(skillsDir, "list", "SKILL.md");
  const list = () => readFileSync(listPath, "utf8");

  it("exists with the frontmatter name and the trigger", () => {
    expect(skillFiles()).toContain(listPath);
    const md = list();
    expect(md).toMatch(/^---\nname: list\n/);
    expect(md).toContain("/tap-to-fix:list");
  });

  it("runs ttf open from the skill's base directory and changes nothing", () => {
    const md = list();
    expect(md).toContain("Base directory for this skill");
    expect(md).toContain("<dir>/../../bin/ttf.mjs");
    expect(md).toContain("node <TTF> open");
    expect(md).not.toContain("CLAUDE_PLUGIN_ROOT");
    expect(md).toMatch(/Shell variables do not survive between Bash calls/);
    for (const cmd of commandText(md)) expect(cmd).not.toMatch(/<TTF> (status|batch|flush)\b/);
  });
});

describe("setup skill", () => {
  const setupPath = join(skillsDir, "setup", "SKILL.md");
  const setup = () => readFileSync(setupPath, "utf8");

  it("exists with the frontmatter name and the trigger", () => {
    expect(skillFiles()).toContain(setupPath);
    const md = setup();
    expect(md).toMatch(/^---\nname: setup\n/);
    expect(md).toContain("/tap-to-fix:setup");
  });

  it("confirms before creating anything, showing the dry run", () => {
    const md = setup();
    const confirmAt = md.indexOf("## 1. Confirm first");
    const deployAt = md.indexOf("## 3. Deploy");
    expect(confirmAt).toBeGreaterThan(-1);
    expect(confirmAt).toBeLessThan(deployAt);
    expect(md).toContain("npm run deploy -- --dry-run");
    expect(md).toMatch(/Wait for a yes/);
  });

  it("runs the deploy script in the plugin's service folder, resolved from the skill's base directory", () => {
    const md = setup();
    expect(md).toContain("Base directory for this skill");
    expect(md).toContain("<dir>/../../service");
    expect(md).toMatch(/cd "<service dir>" && [^\n]*npm run deploy\)/);
    expect(md).not.toContain("CLAUDE_PLUGIN_ROOT");
    expect(md).toMatch(/Shell variables do not survive between Bash calls/);
  });

  it("handles not signed in by asking the user to run wrangler login with !", () => {
    const md = setup();
    expect(md).toMatch(/Exit `3`/);
    expect(md).toMatch(/`! cd "<service dir>" && npx wrangler login`/);
    expect(md).toMatch(/Wait until the user says it worked/);
  });

  it("relays the script tag and the owner link once, and says to save the link", () => {
    const md = setup();
    expect(md).toContain('data-site="your-site-slug"');
    expect(md).toContain("/o/#owner=");
    expect(md).toMatch(/exactly once/);
    expect(md).toMatch(/Save this link/);
    expect(md).toMatch(/Do not repeat the owner link/);
  });

  it("names only its own resources and forbids other wrangler commands", () => {
    const md = setup();
    expect(md).toContain("`tap-to-fix-shots`");
    expect(md).toMatch(/Never run any other `wrangler` command/);
    for (const cmd of commandText(md)) {
      const wr = cmd.match(/wrangler\s+([a-z0-9]+(?:\s+[a-z0-9]+)?)/g) ?? [];
      for (const w of wr) expect(["wrangler login"], cmd).toContain(w);
    }
  });

  it("explains adding sites from the owner dashboard", () => {
    const md = setup();
    expect(md).toMatch(/Add a site/);
    expect(md).toMatch(/Add a reviewer/);
  });
});
