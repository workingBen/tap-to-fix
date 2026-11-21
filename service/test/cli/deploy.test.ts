import { copyFileSync, existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs, not type-checked
import { saveConfig } from "../../../bin/lib/config.mjs";
import {
  ALLOWED,
  assertAllowed,
  deploy,
  parseJsonOutput,
  parseR2Names,
  parseWorkersDevUrl,
  renderDeployToml,
  // @ts-expect-error plain .mjs, not type-checked
} from "../../scripts/deploy.mjs";

const serviceRoot = resolve(__dirname, "../..");
const WARN =
  "⚠️  Warning: Unsupported macOS version detected (12.6.0). The Cloudflare Workers runtime may not work correctly on macOS versions below 13.5.0.";
const DB_ID = "0b7c3f6e-1a2b-4c3d-8e9f-0123456789ab";
const NEW_DB_ID = "9f8e7d6c-5b4a-4321-9abc-def012345678";
const URL = "https://tap-to-fix.bens-sub.workers.dev";

type Call = { cmd: string; args: string[]; opts: { cwd?: string; input?: string; env?: Record<string, string> } };
type Res = { code: number; stdout: string; stderr?: string };

/** A fake Cloudflare account. `buckets` and `dbs` are what the account already holds. */
function fakeAccount({
  loggedIn = true,
  dbs = [] as { name: string; uuid: string }[],
  buckets = [] as string[],
  accounts = [{ name: "Greensprings", id: "acct1" }],
} = {}) {
  const calls: Call[] = [];
  const run = async (cmd: string, args: string[], opts: Call["opts"] = {}): Promise<Res> => {
    calls.push({ cmd, args, opts });
    const a = args.join(" ");
    if (cmd === "npx" && a === "wrangler whoami --json") {
      return loggedIn
        ? { code: 0, stdout: `${WARN}\n${JSON.stringify({ loggedIn: true, email: "b@x", accounts }, null, 2)}\n` }
        : { code: 1, stdout: `${WARN}\n{\n  "loggedIn": false\n}\n` };
    }
    if (a === "wrangler d1 list --json") return { code: 0, stdout: `${WARN}\n${JSON.stringify(dbs, null, 2)}\n` };
    if (a === "wrangler d1 create tap-to-fix") {
      dbs.push({ name: "tap-to-fix", uuid: NEW_DB_ID });
      return {
        code: 0,
        stdout: `${WARN}\n✅ Successfully created DB 'tap-to-fix'\nCreated your new D1 database.\n\n[[d1_databases]]\nbinding = "tap_to_fix"\ndatabase_name = "tap-to-fix"\ndatabase_id = "${NEW_DB_ID}"\n`,
      };
    }
    if (a === "wrangler r2 bucket list") {
      const body = buckets.map((b) => `name:           ${b}\ncreation_date:  2026-01-01T00:00:00.000Z`).join("\n\n");
      return { code: 0, stdout: `${WARN}\nListing buckets...\n${body}\n` };
    }
    if (a === "wrangler r2 bucket create tap-to-fix-shots") {
      buckets.push("tap-to-fix-shots");
      return { code: 0, stdout: `${WARN}\nCreating bucket 'tap-to-fix-shots'...\n✅ Created bucket 'tap-to-fix-shots'\n` };
    }
    if (a.startsWith("wrangler d1 migrations apply")) return { code: 0, stdout: `${WARN}\n✅ 0001_init.sql\n` };
    if (a.startsWith("wrangler secret put")) return { code: 0, stdout: `${WARN}\n✨ Success! Uploaded secret OWNER_TOKEN\n` };
    if (cmd === "npm" && a === "run build:client") return { code: 0, stdout: "built\n" };
    if (a.startsWith("wrangler deploy")) {
      return { code: 0, stdout: `${WARN}\nUploaded tap-to-fix (3.1 sec)\nDeployed tap-to-fix triggers (0.9 sec)\n  ${URL}\nCurrent Version ID: abc\n` };
    }
    if (cmd === "bash" && a === "scripts/smoke.sh") return { code: 0, stdout: "smoke: ok\n" };
    return { code: 99, stdout: `unexpected ${cmd} ${a}` };
  };
  return { run, calls };
}

/** A fake owner API that smoke.sh "adds to": one pre-existing reviewer and assignment, then smoke's. */
function fakeOwnerApi() {
  const requests: { method: string; url: string; auth: string | null }[] = [];
  let overviews = 0;
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const auth = new Headers(init.headers).get("Authorization");
    requests.push({ method, url, auth });
    if (url.endsWith("/api/owner/overview")) {
      overviews++;
      const reviewers = [{ id: "r-old", name: "Alexis Rivera", revoked: false }];
      const assignments = [{ id: "a-old", site: "bonus-decade" }];
      if (overviews > 1) {
        reviewers.push({ id: "r-smoke", name: "Smoke Reviewer", revoked: false });
        assignments.push({ id: "a-smoke", site: "smoke-1763600000" });
      }
      return new Response(JSON.stringify({ reviewers, assignments }), { status: 200 });
    }
    if (method === "DELETE" || method === "POST") return new Response(null, { status: 204 });
    return new Response("{}", { status: 404 });
  };
  return { fetchImpl, requests };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ttf-deploy-"));
  copyFileSync(join(serviceRoot, "wrangler.toml"), join(dir, "wrangler.toml"));
  const home = mkdtempSync(join(tmpdir(), "ttf-home-"));
  const lines: string[] = [];
  const out = (s: string) => lines.push(s);
  return { dir, home, lines, out, err: out };
}

let tokenCount = 0;
const newToken = () => `TOKEN${++tokenCount}xyzSECRETxyz`;

const wranglerArgs = (calls: Call[]) => calls.filter((c) => c.cmd === "npx").map((c) => c.args.slice(1).join(" "));
const configFile = (home: string) => join(home, ".config", "tap-to-fix", "config.json");

describe("deploy", () => {
  it("fresh account: creates both, sets the secret via stdin, builds before deploy, saves config", async () => {
    const s = setup();
    const acct = fakeAccount({ buckets: ["r2_private", "other-bucket"] });
    const api = fakeOwnerApi();
    const code = await deploy([], { run: acct.run, fetchImpl: api.fetchImpl, home: s.home, serviceDir: s.dir, env: {}, out: s.out, err: s.err, newToken });
    expect(code, s.lines.join("\n")).toBe(0);

    expect(wranglerArgs(acct.calls)).toEqual([
      "whoami --json",
      "d1 list --json",
      "d1 create tap-to-fix",
      "r2 bucket list",
      "r2 bucket create tap-to-fix-shots",
      "d1 migrations apply tap-to-fix --remote -c wrangler.deploy.toml",
      "secret put OWNER_TOKEN -c wrangler.deploy.toml",
      "deploy -c wrangler.deploy.toml",
    ]);
    const put = acct.calls.find((c) => c.args.includes("secret"))!;
    const cfg = JSON.parse(readFileSync(configFile(s.home), "utf8"));
    expect(put.opts.input).toBe(cfg.owner_token);
    expect(cfg.service).toBe(URL);
    expect(statSync(configFile(s.home)).mode & 0o777).toBe(0o600);

    const order = acct.calls.map((c) => `${c.cmd} ${c.args.join(" ")}`);
    const buildAt = order.indexOf("npm run build:client");
    expect(buildAt).toBeGreaterThan(-1);
    expect(buildAt).toBeLessThan(order.indexOf("npx wrangler deploy -c wrangler.deploy.toml"));

    const toml = readFileSync(join(s.dir, "wrangler.deploy.toml"), "utf8");
    expect(toml).toContain(`database_id = "${NEW_DB_ID}"`);
    expect(toml).not.toContain("local-placeholder");
    expect(toml).toContain('bucket_name = "tap-to-fix-shots"');

    const smoke = acct.calls.find((c) => c.cmd === "bash")!;
    expect(smoke.opts.env?.BASE).toBe(URL);
    expect(smoke.opts.env?.OWNER_TOKEN).toBe(cfg.owner_token);
    expect(s.lines).toContain(`  <script src="${URL}/t.js" data-site="your-site-slug" defer></script>`);
    expect(s.lines).toContain(`  ${URL}/o/#owner=${cfg.owner_token}`);
  });

  it("smoke cleanup touches only what the smoke test added", async () => {
    const s = setup();
    const acct = fakeAccount();
    const api = fakeOwnerApi();
    await deploy([], { run: acct.run, fetchImpl: api.fetchImpl, home: s.home, serviceDir: s.dir, env: {}, out: s.out, err: s.err, newToken });
    const writes = api.requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.url.replace(URL, "")}`);
    expect(writes).toEqual(["DELETE /api/owner/assignments/a-smoke", "POST /api/owner/reviewers/r-smoke/revoke"]);
    for (const r of api.requests) expect(r.url).not.toContain("SECRET");
  });

  it("second run: reuses both, no create, no secret put, keeps the token", async () => {
    const s = setup();
    saveConfig({ service: URL, owner_token: "KEPTtokenSECRET" }, { home: s.home });
    const acct = fakeAccount({ dbs: [{ name: "tap-to-fix", uuid: DB_ID }], buckets: ["r2_private", "tap-to-fix-shots"] });
    const code = await deploy([], { run: acct.run, fetchImpl: fakeOwnerApi().fetchImpl, home: s.home, serviceDir: s.dir, env: {}, out: s.out, err: s.err, newToken });
    expect(code, s.lines.join("\n")).toBe(0);
    const args = wranglerArgs(acct.calls);
    expect(args.some((a) => a.includes("create"))).toBe(false);
    expect(args.some((a) => a.startsWith("secret"))).toBe(false);
    expect(readFileSync(join(s.dir, "wrangler.deploy.toml"), "utf8")).toContain(`database_id = "${DB_ID}"`);
    expect(JSON.parse(readFileSync(configFile(s.home), "utf8")).owner_token).toBe("KEPTtokenSECRET");
  });

  it("--rotate-token puts a new secret", async () => {
    const s = setup();
    saveConfig({ service: URL, owner_token: "OLDtokenSECRET" }, { home: s.home });
    const acct = fakeAccount({ dbs: [{ name: "tap-to-fix", uuid: DB_ID }], buckets: ["tap-to-fix-shots"] });
    const code = await deploy(["--rotate-token"], { run: acct.run, fetchImpl: fakeOwnerApi().fetchImpl, home: s.home, serviceDir: s.dir, env: {}, out: s.out, err: s.err, newToken });
    expect(code).toBe(0);
    const put = acct.calls.find((c) => c.args.includes("secret"))!;
    const cfg = JSON.parse(readFileSync(configFile(s.home), "utf8"));
    expect(cfg.owner_token).not.toBe("OLDtokenSECRET");
    expect(put.opts.input).toBe(cfg.owner_token);
  });

  it("a kept token is still set when the database had to be created (new account)", async () => {
    const s = setup();
    saveConfig({ service: URL, owner_token: "KEPTtokenSECRET" }, { home: s.home });
    const acct = fakeAccount();
    await deploy([], { run: acct.run, fetchImpl: fakeOwnerApi().fetchImpl, home: s.home, serviceDir: s.dir, env: {}, out: s.out, err: s.err, newToken });
    expect(acct.calls.find((c) => c.args.includes("secret"))?.opts.input).toBe("KEPTtokenSECRET");
  });

  it("not logged in: exit 3, the login hint, and no other command", async () => {
    const s = setup();
    const acct = fakeAccount({ loggedIn: false });
    const code = await deploy([], { run: acct.run, home: s.home, serviceDir: s.dir, env: {}, out: s.out, err: s.err, newToken });
    expect(code).toBe(3);
    expect(acct.calls.map((c) => c.args.join(" "))).toEqual(["wrangler whoami --json"]);
    expect(s.lines.join("\n")).toContain("Run: ! npx wrangler login");
    expect(existsSync(join(s.dir, "wrangler.deploy.toml"))).toBe(false);
  });

  it("more than one Cloudflare account and no CLOUDFLARE_ACCOUNT_ID: stops after whoami", async () => {
    const s = setup();
    const acct = fakeAccount({ accounts: [{ name: "A", id: "1" }, { name: "B", id: "2" }] });
    const code = await deploy([], { run: acct.run, home: s.home, serviceDir: s.dir, env: {}, out: s.out, err: s.err, newToken });
    expect(code).toBe(1);
    expect(acct.calls).toHaveLength(1);
    expect(s.lines.join("\n")).toContain("CLOUDFLARE_ACCOUNT_ID");
  });

  it("other bucket and database names in the lists are never passed to any command", async () => {
    const s = setup();
    const acct = fakeAccount({
      dbs: [{ name: "longevity", uuid: "11111111-2222-4333-8444-555555555555" }, { name: "tap-to-fix-old", uuid: "22222222-2222-4333-8444-555555555555" }],
      buckets: ["r2_private", "tap-to-fix-shots-backup", "public-assets"],
    });
    await deploy([], { run: acct.run, fetchImpl: fakeOwnerApi().fetchImpl, home: s.home, serviceDir: s.dir, env: {}, out: s.out, err: s.err, newToken });
    const everything = acct.calls.map((c) => [c.cmd, ...c.args, c.opts.input ?? ""].join(" ")).join("\n");
    for (const other of ["r2_private", "tap-to-fix-shots-backup", "public-assets", "longevity", "tap-to-fix-old", "11111111", "22222222"]) {
      expect(everything).not.toContain(other);
      expect(s.lines.join("\n")).not.toContain(other);
    }
    expect(wranglerArgs(acct.calls)).toContain("r2 bucket create tap-to-fix-shots");
    expect(wranglerArgs(acct.calls)).toContain("d1 create tap-to-fix");
  });

  it("the token never appears in any args array or printed line except the final owner link", async () => {
    const s = setup();
    const acct = fakeAccount();
    await deploy([], { run: acct.run, fetchImpl: fakeOwnerApi().fetchImpl, home: s.home, serviceDir: s.dir, env: {}, out: s.out, err: s.err, newToken });
    const token = JSON.parse(readFileSync(configFile(s.home), "utf8")).owner_token as string;
    for (const c of acct.calls) for (const a of c.args) expect(a).not.toContain(token);
    const withToken = s.lines.filter((l) => l.includes(token));
    expect(withToken).toEqual([`  ${URL}/o/#owner=${token}`]);
  });

  it("a failing command's output is printed with the token redacted", async () => {
    const s = setup();
    const acct = fakeAccount();
    const run = async (cmd: string, args: string[], opts: Call["opts"] = {}) => {
      if (cmd === "bash") return { code: 1, stdout: "", stderr: `smoke: FAIL token was ${opts.env?.OWNER_TOKEN}` };
      return acct.run(cmd, args, opts);
    };
    const code = await deploy([], { run, fetchImpl: fakeOwnerApi().fetchImpl, home: s.home, serviceDir: s.dir, env: {}, out: s.out, err: s.err, newToken });
    expect(code).toBe(1);
    const token = JSON.parse(readFileSync(configFile(s.home), "utf8")).owner_token as string;
    expect(s.lines.join("\n")).toContain("smoke: FAIL token was [owner token]");
    expect(s.lines.join("\n")).not.toContain(token);
  });

  it("--dry-run prints the plan and runs nothing", async () => {
    const s = setup();
    const calls: unknown[] = [];
    const run = async (...a: unknown[]) => {
      calls.push(a);
      return { code: 0, stdout: "" };
    };
    const fetchImpl = async () => {
      throw new Error("no fetch in a dry run");
    };
    const code = await deploy(["--dry-run"], { run, fetchImpl, home: s.home, serviceDir: s.dir, env: {}, out: s.out, err: s.err, newToken });
    expect(code).toBe(0);
    expect(calls).toHaveLength(0);
    expect(existsSync(join(s.dir, "wrangler.deploy.toml"))).toBe(false);
    expect(existsSync(configFile(s.home))).toBe(false);
    const text = s.lines.join("\n");
    for (const a of ALLOWED) expect(text).toContain(`npx wrangler ${a.join(" ")}`);
    expect(text).toContain("npm run build:client");
  });

  it("unknown options are refused before anything runs", async () => {
    const s = setup();
    const acct = fakeAccount();
    expect(await deploy(["--bucket", "r2_private"], { run: acct.run, home: s.home, serviceDir: s.dir, env: {}, out: s.out, err: s.err, newToken })).toBe(1);
    expect(acct.calls).toHaveLength(0);
  });
});

describe("deploy guards and parsing", () => {
  it("assertAllowed refuses anything not in the list", () => {
    expect(() => assertAllowed(["r2", "bucket", "delete", "r2_private"])).toThrow(/refusing/);
    expect(() => assertAllowed(["r2", "bucket", "create", "r2_private"])).toThrow(/refusing/);
    expect(() => assertAllowed(["d1", "create", "other"])).toThrow(/refusing/);
    expect(() => assertAllowed(["deploy"])).toThrow(/refusing/);
    for (const a of ALLOWED) expect(() => assertAllowed(a)).not.toThrow();
  });

  it("every allowed command names only tap-to-fix resources", () => {
    const names = ALLOWED.flat().filter((x: string) => !x.startsWith("-") && /^[a-z0-9_-]+$/i.test(x) && /[_-]/.test(x));
    expect(new Set(names)).toEqual(new Set(["tap-to-fix", "tap-to-fix-shots", "OWNER_TOKEN"]));
  });

  it("parses JSON around the macOS warning", () => {
    expect(parseJsonOutput(`${WARN}\n[\n  {"name":"a"}\n]\n`)).toEqual([{ name: "a" }]);
    expect(parseJsonOutput(`${WARN}\n[]`)).toEqual([]);
    expect(parseJsonOutput(`${WARN}\nnot json`)).toBeUndefined();
  });

  it("reads bucket names and the workers.dev URL", () => {
    expect(parseR2Names(`${WARN}\nListing buckets...\nname:  a\ncreation_date: x\n\nname:  tap-to-fix-shots\n`)).toEqual(["a", "tap-to-fix-shots"]);
    expect(parseWorkersDevUrl(`${WARN}\n  https://tap-to-fix.sub.workers.dev\n`)).toBe("https://tap-to-fix.sub.workers.dev");
    expect(parseWorkersDevUrl("no url")).toBeNull();
  });

  it("renderDeployToml refuses a wrangler.toml naming another bucket or database", () => {
    const src = readFileSync(join(serviceRoot, "wrangler.toml"), "utf8");
    expect(() => renderDeployToml(src.replace('bucket_name = "tap-to-fix-shots"', 'bucket_name = "r2_private"'), DB_ID)).toThrow(/bucket_name/);
    expect(() => renderDeployToml(src.replace('database_name = "tap-to-fix"', 'database_name = "prod"'), DB_ID)).toThrow(/database_name/);
    expect(() => renderDeployToml(src, "not-a-uuid")).toThrow();
  });
});
