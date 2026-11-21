import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs, not type-checked
import { saveConfig } from "../../../bin/lib/config.mjs";
import {
  ALLOWED,
  assertAllowed,
  deploy,
  liveCheck,
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

type Call = { cmd: string; args: string[]; opts: { cwd?: string; input?: string } };
type Res = { code: number; stdout: string; stderr?: string };
const isWrangler = (cmd: string) => cmd.endsWith(join("node_modules", ".bin", "wrangler"));

/** A fake Cloudflare account. `buckets` and `dbs` are what the account already holds. */
function fakeAccount({
  loggedIn = true,
  dbs = [] as { name: string; uuid: string }[],
  buckets = [] as string[],
  accounts = [{ name: "Greensprings", id: "acct1" }],
  d1ListStdout = null as string | null,
  r2ListStdout = null as string | null,
} = {}) {
  const calls: Call[] = [];
  const run = async (cmd: string, args: string[], opts: Call["opts"] = {}): Promise<Res> => {
    calls.push({ cmd, args, opts });
    const a = args.join(" ");
    if (isWrangler(cmd)) {
      if (a === "whoami --json") {
        return loggedIn
          ? { code: 0, stdout: `${WARN}\n${JSON.stringify({ loggedIn: true, email: "b@x", accounts }, null, 2)}\n` }
          : { code: 1, stdout: `${WARN}\n{\n  "loggedIn": false\n}\n` };
      }
      if (a === "d1 list --json") return { code: 0, stdout: d1ListStdout ?? `${WARN}\n${JSON.stringify(dbs, null, 2)}\n` };
      if (a === "d1 create tap-to-fix") {
        dbs.push({ name: "tap-to-fix", uuid: NEW_DB_ID });
        return {
          code: 0,
          stdout: `${WARN}\n✅ Successfully created DB 'tap-to-fix'\nCreated your new D1 database.\n\n[[d1_databases]]\nbinding = "tap_to_fix"\ndatabase_name = "tap-to-fix"\ndatabase_id = "${NEW_DB_ID}"\n`,
        };
      }
      if (a === "r2 bucket list") {
        if (r2ListStdout !== null) return { code: 0, stdout: r2ListStdout };
        const body = buckets.map((b) => `name:           ${b}\ncreation_date:  2026-01-01T00:00:00.000Z`).join("\n\n");
        return { code: 0, stdout: `${WARN}\nListing buckets...\n${body}\n` };
      }
      if (a === "r2 bucket create tap-to-fix-shots") {
        buckets.push("tap-to-fix-shots");
        return { code: 0, stdout: `${WARN}\nCreating bucket 'tap-to-fix-shots'...\n✅ Created bucket 'tap-to-fix-shots'\n` };
      }
      if (a.startsWith("d1 migrations apply")) return { code: 0, stdout: `${WARN}\n✅ 0001_init.sql\n` };
      if (a.startsWith("secret put")) return { code: 0, stdout: `${WARN}\n✨ Success! Uploaded secret OWNER_TOKEN\n` };
      if (a.startsWith("deploy")) {
        return { code: 0, stdout: `${WARN}\nUploaded tap-to-fix (3.1 sec)\nDeployed tap-to-fix triggers (0.9 sec)\n  ${URL}\nCurrent Version ID: abc\n` };
      }
    }
    if (cmd === "npm" && a === "run build:client") return { code: 0, stdout: "built\n" };
    return { code: 99, stdout: `unexpected ${cmd} ${a}` };
  };
  return { run, calls };
}

/** A fake live Worker: read-only checks. `liveToken` is the OWNER_TOKEN the Worker holds (null: any Bearer works). */
function fakeWorker({ liveToken = null as string | null, health = 200, acao = "*", rp = "no-referrer" } = {}) {
  const requests: { method: string; url: string; auth: string | null; redirect?: string }[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const auth = new Headers(init.headers).get("Authorization");
    requests.push({ method, url, auth, redirect: init.redirect });
    const path = url.replace(URL, "");
    if (path === "/api/health") return new Response('{"ok":true}', { status: health });
    if (path === "/t.js") return new Response("x", { status: 200, headers: acao ? { "Access-Control-Allow-Origin": acao } : {} });
    if (path === "/r") return new Response(null, { status: 307, headers: { Location: "/r/" } });
    if (path === "/r/") return new Response("<html>", { status: 200, headers: rp ? { "Referrer-Policy": rp } : {} });
    if (path === "/api/owner/overview") {
      if (!auth) return new Response("{}", { status: 401 });
      const ok = liveToken === null || auth === `Bearer ${liveToken}`;
      return new Response("{}", { status: ok ? 200 : 401 });
    }
    return new Response("{}", { status: 404 });
  };
  return { fetchImpl, requests };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ttf-deploy-"));
  copyFileSync(join(serviceRoot, "wrangler.toml"), join(dir, "wrangler.toml"));
  mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(dir, "node_modules", ".bin", "wrangler"), "");
  const home = mkdtempSync(join(tmpdir(), "ttf-home-"));
  const lines: string[] = [];
  const out = (s: string) => lines.push(s);
  return { dir, home, lines, out, err: out };
}

let tokenCount = 0;
const newToken = () => `TOKEN${++tokenCount}xyzSECRETxyz`;
const sleep = async () => {};

const wranglerArgs = (calls: Call[]) => calls.filter((c) => isWrangler(c.cmd)).map((c) => c.args.join(" "));
const configFile = (home: string) => join(home, ".config", "tap-to-fix", "config.json");

function deps(s: ReturnType<typeof setup>, run: unknown, fetchImpl: unknown = fakeWorker().fetchImpl, env: Record<string, string> = {}) {
  return { run, fetchImpl, home: s.home, serviceDir: s.dir, env, out: s.out, err: s.err, newToken, sleep };
}

describe("deploy", () => {
  it("fresh account: creates both, builds, sets the secret via stdin, deploys, saves config", async () => {
    const s = setup();
    const acct = fakeAccount({ buckets: ["r2_private", "other-bucket"] });
    const worker = fakeWorker();
    const code = await deploy([], deps(s, acct.run, worker.fetchImpl));
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
    for (const c of acct.calls.filter((c) => c.cmd !== "npm")) expect(c.cmd).toBe(join(s.dir, "node_modules", ".bin", "wrangler"));

    const put = acct.calls.find((c) => c.args.includes("secret"))!;
    const cfg = JSON.parse(readFileSync(configFile(s.home), "utf8"));
    expect(put.opts.input).toBe(cfg.owner_token);
    expect(cfg.service).toBe(URL);
    expect(statSync(configFile(s.home)).mode & 0o777).toBe(0o600);

    const order = acct.calls.map((c) => c.args.join(" "));
    const buildAt = order.indexOf("run build:client");
    expect(buildAt).toBeGreaterThan(-1);
    expect(buildAt).toBeLessThan(order.indexOf("secret put OWNER_TOKEN -c wrangler.deploy.toml"));
    expect(buildAt).toBeLessThan(order.indexOf("deploy -c wrangler.deploy.toml"));

    const toml = readFileSync(join(s.dir, "wrangler.deploy.toml"), "utf8");
    expect(toml).toContain(`database_id = "${NEW_DB_ID}"`);
    expect(toml).toContain('bucket_name = "tap-to-fix-shots"');

    expect(s.lines).toContain(`  <script src="${URL}/t.js" data-site="your-site-slug" defer></script>`);
    expect(s.lines).toContain(`  ${URL}/o/#owner=${cfg.owner_token}`);
  });

  it("the live check is read-only and sends the token only in the Authorization header", async () => {
    const s = setup();
    const acct = fakeAccount();
    const worker = fakeWorker();
    expect(await deploy([], deps(s, acct.run, worker.fetchImpl))).toBe(0);
    const token = JSON.parse(readFileSync(configFile(s.home), "utf8")).owner_token as string;
    expect(worker.requests.every((r) => r.method === "GET")).toBe(true);
    expect(worker.requests.map((r) => r.url.replace(URL, ""))).toEqual(["/api/health", "/t.js", "/r", "/r/", "/api/owner/overview", "/api/owner/overview"]);
    for (const r of worker.requests) expect(r.url).not.toContain(token);
    expect(worker.requests.filter((r) => r.auth).map((r) => r.auth)).toEqual([`Bearer ${token}`]);
    expect(acct.calls.some((c) => c.cmd === "bash")).toBe(false);
  });

  it("second run: reuses both, no create, no secret put, keeps the token", async () => {
    const s = setup();
    saveConfig({ service: URL, owner_token: "KEPTtokenSECRET" }, { home: s.home });
    const acct = fakeAccount({ dbs: [{ name: "tap-to-fix", uuid: DB_ID }], buckets: ["r2_private", "tap-to-fix-shots"] });
    const code = await deploy([], deps(s, acct.run, fakeWorker({ liveToken: "KEPTtokenSECRET" }).fetchImpl));
    expect(code, s.lines.join("\n")).toBe(0);
    const args = wranglerArgs(acct.calls);
    expect(args.some((a) => a.includes("create"))).toBe(false);
    expect(args.some((a) => a.startsWith("secret"))).toBe(false);
    expect(readFileSync(join(s.dir, "wrangler.deploy.toml"), "utf8")).toContain(`database_id = "${DB_ID}"`);
    expect(JSON.parse(readFileSync(configFile(s.home), "utf8")).owner_token).toBe("KEPTtokenSECRET");
  });

  it("a saved token that the live Worker rejects: exit 1 with the --rotate-token hint, no owner link", async () => {
    const s = setup();
    saveConfig({ service: URL, owner_token: "STALEtokenSECRET" }, { home: s.home });
    const acct = fakeAccount({ dbs: [{ name: "tap-to-fix", uuid: DB_ID }], buckets: ["tap-to-fix-shots"] });
    const code = await deploy([], deps(s, acct.run, fakeWorker({ liveToken: "OTHER" }).fetchImpl));
    expect(code).toBe(1);
    expect(s.lines.join("\n")).toContain("the saved owner token doesn't match the deployed one — run with --rotate-token");
    expect(s.lines.join("\n")).not.toContain("STALEtokenSECRET");
    expect(s.lines.some((l) => l.includes("/o/#owner="))).toBe(false);
  });

  it("--rotate-token puts a new secret", async () => {
    const s = setup();
    saveConfig({ service: URL, owner_token: "OLDtokenSECRET" }, { home: s.home });
    const acct = fakeAccount({ dbs: [{ name: "tap-to-fix", uuid: DB_ID }], buckets: ["tap-to-fix-shots"] });
    const code = await deploy(["--rotate-token"], deps(s, acct.run));
    expect(code).toBe(0);
    const put = acct.calls.find((c) => c.args.includes("secret"))!;
    const cfg = JSON.parse(readFileSync(configFile(s.home), "utf8"));
    expect(cfg.owner_token).not.toBe("OLDtokenSECRET");
    expect(put.opts.input).toBe(cfg.owner_token);
  });

  it("a failed build stops before the secret is put (a rotation never goes live unsaved)", async () => {
    const s = setup();
    saveConfig({ service: URL, owner_token: "OLDtokenSECRET" }, { home: s.home });
    const acct = fakeAccount({ dbs: [{ name: "tap-to-fix", uuid: DB_ID }], buckets: ["tap-to-fix-shots"] });
    const run = async (cmd: string, args: string[], opts: Call["opts"] = {}) =>
      cmd === "npm" ? { code: 1, stdout: "build broke" } : acct.run(cmd, args, opts);
    expect(await deploy(["--rotate-token"], deps(s, run))).toBe(1);
    expect(wranglerArgs(acct.calls).some((a) => a.startsWith("secret") || a.startsWith("deploy"))).toBe(false);
    expect(JSON.parse(readFileSync(configFile(s.home), "utf8")).owner_token).toBe("OLDtokenSECRET");
  });

  it("a kept token is still set when the database had to be created (new account)", async () => {
    const s = setup();
    saveConfig({ service: URL, owner_token: "KEPTtokenSECRET" }, { home: s.home });
    const acct = fakeAccount();
    await deploy([], deps(s, acct.run));
    expect(acct.calls.find((c) => c.args.includes("secret"))?.opts.input).toBe("KEPTtokenSECRET");
  });

  it("not signed in (or offline): exit 3, the login hint, and no other command", async () => {
    const s = setup();
    const acct = fakeAccount({ loggedIn: false });
    const code = await deploy([], deps(s, acct.run));
    expect(code).toBe(3);
    expect(acct.calls.map((c) => c.args.join(" "))).toEqual(["whoami --json"]);
    expect(s.lines.join("\n")).toContain("Not signed in to Cloudflare (or offline). Run: ! npx wrangler login");
    expect(existsSync(join(s.dir, "wrangler.deploy.toml"))).toBe(false);
  });

  it("more than one Cloudflare account and no CLOUDFLARE_ACCOUNT_ID: stops after whoami", async () => {
    const s = setup();
    const acct = fakeAccount({ accounts: [{ name: "A", id: "1" }, { name: "B", id: "2" }] });
    expect(await deploy([], deps(s, acct.run))).toBe(1);
    expect(acct.calls).toHaveLength(1);
    expect(s.lines.join("\n")).toContain("CLOUDFLARE_ACCOUNT_ID");
  });

  it("CLOUDFLARE_ENV set: refuses before running anything", async () => {
    const s = setup();
    const acct = fakeAccount();
    expect(await deploy([], deps(s, acct.run, undefined, { CLOUDFLARE_ENV: "staging" }))).toBe(1);
    expect(acct.calls).toHaveLength(0);
    expect(s.lines.join("\n")).toMatch(/CLOUDFLARE_ENV/);
  });

  it("no local wrangler: tells you to run npm ci, runs nothing", async () => {
    const s = setup();
    const dir = mkdtempSync(join(tmpdir(), "ttf-nomods-"));
    copyFileSync(join(serviceRoot, "wrangler.toml"), join(dir, "wrangler.toml"));
    const acct = fakeAccount();
    expect(await deploy([], { ...deps(s, acct.run), serviceDir: dir })).toBe(1);
    expect(acct.calls).toHaveLength(0);
    expect(s.lines.join("\n")).toMatch(/npm ci/);
  });

  it("other bucket and database names in the lists are never passed to any command", async () => {
    const s = setup();
    const acct = fakeAccount({
      dbs: [{ name: "longevity", uuid: "11111111-2222-4333-8444-555555555555" }, { name: "tap-to-fix-old", uuid: "22222222-2222-4333-8444-555555555555" }],
      buckets: ["r2_private", "tap-to-fix-shots-backup", "public-assets"],
    });
    await deploy([], deps(s, acct.run));
    const everything = acct.calls.map((c) => [c.cmd, ...c.args, c.opts.input ?? ""].join(" ")).join("\n");
    for (const other of ["r2_private", "tap-to-fix-shots-backup", "public-assets", "longevity", "tap-to-fix-old", "11111111", "22222222"]) {
      expect(everything).not.toContain(other);
      expect(s.lines.join("\n")).not.toContain(other);
    }
    expect(wranglerArgs(acct.calls)).toContain("r2 bucket create tap-to-fix-shots");
    expect(wranglerArgs(acct.calls)).toContain("d1 create tap-to-fix");
  });

  it("an unparsable D1 list fails with a fixed message and prints none of its output", async () => {
    const s = setup();
    const acct = fakeAccount({ d1ListStdout: `${WARN}\n┌──────────┐\n│ r2_private-db │ longevity │\n└──────────┘\n` });
    expect(await deploy([], deps(s, acct.run))).toBe(1);
    const text = s.lines.join("\n");
    expect(text).toContain("couldn't read the D1 list from wrangler — run `npx wrangler d1 list` yourself to see why");
    expect(text).not.toContain("r2_private");
    expect(text).not.toContain("longevity");
    expect(wranglerArgs(acct.calls)).toEqual(["whoami --json", "d1 list --json"]);
  });

  it("an unparsable R2 list fails with a fixed message and prints none of its output", async () => {
    const s = setup();
    const acct = fakeAccount({ r2ListStdout: `${WARN}\nListing buckets...\n| r2_private | 2026-01-01 |\n| public-assets | 2026-01-02 |\n` });
    expect(await deploy([], deps(s, acct.run))).toBe(1);
    const text = s.lines.join("\n");
    expect(text).toContain("couldn't read the R2 list from wrangler — run `npx wrangler r2 bucket list` yourself to see why");
    expect(text).not.toContain("r2_private");
    expect(text).not.toContain("public-assets");
    expect(wranglerArgs(acct.calls).some((a) => a.includes("create tap-to-fix-shots"))).toBe(false);
  });

  it("an account with no buckets yet is a readable (empty) R2 list", async () => {
    const s = setup();
    const acct = fakeAccount({ r2ListStdout: `${WARN}\nListing buckets...\n\n` });
    expect(await deploy([], deps(s, acct.run))).toBe(0);
    expect(wranglerArgs(acct.calls)).toContain("r2 bucket create tap-to-fix-shots");
  });

  it("the token never appears in any args array or printed line except the final owner link", async () => {
    const s = setup();
    const acct = fakeAccount();
    await deploy([], deps(s, acct.run));
    const token = JSON.parse(readFileSync(configFile(s.home), "utf8")).owner_token as string;
    for (const c of acct.calls) for (const a of c.args) expect(a).not.toContain(token);
    const withToken = s.lines.filter((l) => l.includes(token));
    expect(withToken).toEqual([`  ${URL}/o/#owner=${token}`]);
  });

  it("a failing command's output is printed with the token redacted", async () => {
    const s = setup();
    const acct = fakeAccount();
    let token = "";
    const run = async (cmd: string, args: string[], opts: Call["opts"] = {}) => {
      if (opts.input) token = opts.input;
      if (args[0] === "deploy") return { code: 1, stdout: "", stderr: `deploy broke near ${token}` };
      return acct.run(cmd, args, opts);
    };
    expect(await deploy([], deps(s, run))).toBe(1);
    expect(token).not.toBe("");
    expect(s.lines.join("\n")).toContain("deploy broke near [owner token]");
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
    expect(await deploy(["--dry-run"], deps(s, run, fetchImpl))).toBe(0);
    expect(calls).toHaveLength(0);
    expect(existsSync(join(s.dir, "wrangler.deploy.toml"))).toBe(false);
    expect(existsSync(configFile(s.home))).toBe(false);
    const text = s.lines.join("\n");
    for (const a of ALLOWED) expect(text).toContain(`node_modules/.bin/wrangler ${a.join(" ")}`);
    expect(text.indexOf("npm run build:client")).toBeLessThan(text.indexOf("secret put"));
    expect(text).not.toContain("smoke");
  });

  it("unknown options are refused before anything runs", async () => {
    const s = setup();
    const acct = fakeAccount();
    expect(await deploy(["--bucket", "r2_private"], deps(s, acct.run))).toBe(1);
    expect(acct.calls).toHaveLength(0);
  });
});

describe("liveCheck", () => {
  it("passes against a healthy Worker", async () => {
    expect(await liveCheck(URL, "tok", fakeWorker().fetchImpl)).toEqual({ ok: true, problems: [], tokenMismatch: false });
  });

  it("reports missing CORS on t.js and a missing Referrer-Policy on /r/", async () => {
    const r = await liveCheck(URL, "tok", fakeWorker({ acao: "", rp: "" }).fetchImpl);
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toMatch(/Access-Control-Allow-Origin/);
    expect(r.problems.join("\n")).toMatch(/Referrer-Policy/);
  });

  it("retries health while a new URL comes up, then gives up", async () => {
    let n = 0;
    const r = await liveCheck(URL, "tok", async () => {
      n++;
      throw new Error("ENOTFOUND");
    });
    expect(r.ok).toBe(false);
    expect(n).toBe(6);
  });

  it("flags a token mismatch", async () => {
    const r = await liveCheck(URL, "tok", fakeWorker({ liveToken: "other" }).fetchImpl);
    expect(r.tokenMismatch).toBe(true);
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
});

describe("renderDeployToml (fixed template)", () => {
  const src = readFileSync(join(serviceRoot, "wrangler.toml"), "utf8");
  const base = renderDeployToml(src, DB_ID);

  it("holds only the fixed keys, with the real id and wrangler.toml's date", () => {
    expect(base).toBe(
      [
        "# Generated by scripts/deploy.mjs from a fixed template. Git-ignored; do not edit.",
        'name = "tap-to-fix"',
        'main = "src/index.ts"',
        'compatibility_date = "2026-11-01"',
        "",
        "[assets]",
        'directory = "./public"',
        "",
        "[[d1_databases]]",
        'binding = "DB"',
        'database_name = "tap-to-fix"',
        `database_id = "${DB_ID}"`,
        'migrations_dir = "migrations"',
        "",
        "[[r2_buckets]]",
        'binding = "SHOTS"',
        'bucket_name = "tap-to-fix-shots"',
        "",
      ].join("\n"),
    );
  });

  it("is byte-identical whatever else wrangler.toml contains", () => {
    const probes = [
      src + '\n[[r2_buckets]]\nbinding = "PRIVATE"\nbucket_name = "r2_private"\n',
      src + "\n[[r2_buckets]]\nbinding = 'PRIVATE'\nbucket_name = 'r2_private'\n",
      src.replace('main = "src/index.ts"', 'main = "src/index.ts"\nroutes = [{ pattern = "greensprings.life/*", zone_name = "greensprings.life" }]'),
      src.replace('main = "src/index.ts"', 'main = "src/index.ts"\nr2_buckets = [{ binding = "P", bucket_name = "r2_private" }]'),
      src.replace('bucket_name = "tap-to-fix-shots"', 'bucket_name = "tap-to-fix-shots"\npreview_bucket_name = "r2_private"'),
      src.replace('name = "tap-to-fix"', 'name = "something-else"\naccount_id = "abc"\nworkers_dev = false'),
      src + '\n[env.prod]\ncompatibility_date = "2020-01-01"\nroute = "greensprings.life/*"\n',
    ];
    for (const p of probes) expect(renderDeployToml(p, DB_ID)).toBe(base);
  });

  it("accepts a single-quoted date", () => {
    expect(renderDeployToml(src.replace('"2026-11-01"', "'2026-11-01'"), DB_ID)).toBe(base);
  });

  it("refuses a non-UUID id or a bad or missing date", () => {
    expect(() => renderDeployToml(src, "not-a-uuid")).toThrow(/UUID/);
    expect(() => renderDeployToml(src, `${DB_ID}"\nroutes = ["x"]`)).toThrow(/UUID/);
    expect(() => renderDeployToml(src.replace("2026-11-01", "2026-13-40"), DB_ID)).toThrow(/compatibility_date/);
    expect(() => renderDeployToml(src.replace('"2026-11-01"', '"2026-11-01\\nroutes"'), DB_ID)).toThrow(/compatibility_date/);
    expect(renderDeployToml(src.replace("2026-11-01", '2026-11-01"\nroutes = ["x'), DB_ID)).toBe(base);
    expect(() => renderDeployToml(src.replace(/^compatibility_date.*$/m, ""), DB_ID)).toThrow(/compatibility_date/);
  });
});
