#!/usr/bin/env node
// Deploys tap-to-fix to the signed-in Cloudflare account:
//   node scripts/deploy.mjs [--rotate-token] [--dry-run]     (npm run deploy -- --dry-run)
//
// It creates or reuses exactly two resources, the D1 database `tap-to-fix` and the
// R2 bucket `tap-to-fix-shots`, and deploys the Worker `tap-to-fix`. Every wrangler
// call goes through `wrangler()`, which refuses any argument list not in ALLOWED, so
// no other resource name can ever reach a wrangler command. The owner token goes to
// `wrangler secret put` on stdin only and is printed once, in the final owner link.
// wrangler.deploy.toml is built from a fixed template, never copied from wrangler.toml.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { configPath, saveConfig } from "../../bin/lib/config.mjs";

export const DB_NAME = "tap-to-fix";
export const BUCKET_NAME = "tap-to-fix-shots";
export const WORKER_NAME = "tap-to-fix";
export const DEPLOY_CONFIG = "wrangler.deploy.toml";

/** The only wrangler argument lists this script may run. Nothing else gets through. */
export const ALLOWED = [
  ["whoami", "--json"],
  ["d1", "list", "--json"],
  ["d1", "create", DB_NAME],
  ["r2", "bucket", "list"],
  ["r2", "bucket", "create", BUCKET_NAME],
  ["d1", "migrations", "apply", DB_NAME, "--remote", "-c", DEPLOY_CONFIG],
  ["secret", "put", "OWNER_TOKEN", "-c", DEPLOY_CONFIG],
  ["deploy", "-c", DEPLOY_CONFIG],
];

export function assertAllowed(args) {
  const ok = ALLOWED.some((a) => a.length === args.length && a.every((x, i) => x === args[i]));
  if (!ok) throw new Error(`deploy: refusing to run wrangler ${args.join(" ")} (not an allowed command)`);
}

const WARNING = /Unsupported macOS version detected/;

/** Output without wrangler's macOS warning (or any other line starting with the warning sign). */
export function cleanOutput(text) {
  return String(text ?? "")
    .split("\n")
    .filter((l) => !WARNING.test(l) && !/^\s*⚠️/.test(l))
    .join("\n");
}

/** The first JSON value in mixed output: tries each line that opens with [ or { against each later line that closes one. */
export function parseJsonOutput(text) {
  const lines = cleanOutput(text).split("\n");
  const starts = lines.flatMap((l, i) => (/^\s*[[{]/.test(l) ? [i] : []));
  const ends = lines.flatMap((l, i) => (/[\]}]\s*$/.test(l) ? [i] : [])).reverse();
  for (const s of starts) {
    for (const e of ends) {
      if (e < s) continue;
      try {
        return JSON.parse(lines.slice(s, e + 1).join("\n"));
      } catch {
        // try the next window
      }
    }
  }
  return undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The uuid of the D1 database named exactly DB_NAME in `d1 list --json` output, or null. */
export function findD1Id(list) {
  if (!Array.isArray(list)) return null;
  const db = list.find((d) => d && d.name === DB_NAME);
  const id = db && (db.uuid ?? db.database_id ?? db.id);
  return typeof id === "string" && UUID.test(id) ? id : null;
}

/** database_id from `d1 create` output (it prints a config snippet), or null. */
export function parseD1CreateId(text) {
  const m = cleanOutput(text).match(/database_id"?\s*[=:]\s*"([0-9a-f-]{36})"/i);
  return m && UUID.test(m[1]) ? m[1] : null;
}

/** Bucket names in `r2 bucket list` output (`name:  <bucket>` lines, or JSON if wrangler ever prints it). */
export function parseR2Names(text) {
  const json = parseJsonOutput(text);
  const arr = Array.isArray(json) ? json : Array.isArray(json?.buckets) ? json.buckets : null;
  if (arr) return arr.map((b) => (typeof b === "string" ? b : b?.name)).filter((n) => typeof n === "string");
  return [...cleanOutput(text).matchAll(/^\s*name:\s*(\S+)\s*$/gm)].map((m) => m[1]);
}

/** The Worker's workers.dev URL in `wrangler deploy` output, or null. */
export function parseWorkersDevUrl(text) {
  const urls = [...cleanOutput(text).matchAll(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev\b/gi)].map((m) => m[0]);
  return urls.find((u) => u.toLowerCase().startsWith(`https://${WORKER_NAME}.`)) ?? null;
}


const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function validDate(s) {
  const m = DATE.exec(s);
  if (!m) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * wrangler.deploy.toml from a fixed template. Only compatibility_date is read from
 * wrangler.toml (the first top-level one, validated); nothing else is copied, so no
 * route, binding or name added to wrangler.toml can reach a deploy.
 */
export function renderDeployToml(source, databaseId) {
  if (typeof databaseId !== "string" || !UUID.test(databaseId)) {
    throw new Error("deploy: the D1 database id is not a UUID; not deploying");
  }
  const topLevel = String(source).split(/^\s*\[/m)[0];
  const m = topLevel.match(/^\s*compatibility_date\s*=\s*(?:"([^"\n]*)"|'([^'\n]*)')\s*(?:#.*)?$/m);
  const date = m ? (m[1] ?? m[2]) : null;
  if (!date || !validDate(date)) {
    throw new Error("deploy: wrangler.toml needs a top-level compatibility_date = \"YYYY-MM-DD\"; not deploying");
  }
  return [
    "# Generated by scripts/deploy.mjs from a fixed template. Git-ignored; do not edit.",
    `name = "${WORKER_NAME}"`,
    'main = "src/index.ts"',
    `compatibility_date = "${date}"`,
    "",
    "[assets]",
    'directory = "./public"',
    "",
    "[[d1_databases]]",
    'binding = "DB"',
    `database_name = "${DB_NAME}"`,
    `database_id = "${databaseId.toLowerCase()}"`,
    'migrations_dir = "migrations"',
    "",
    "[[r2_buckets]]",
    'binding = "SHOTS"',
    `bucket_name = "${BUCKET_NAME}"`,
    "",
  ].join("\n");
}

export const WRANGLER_BIN = join("node_modules", ".bin", "wrangler");

/** What a fresh deploy runs, in order. --dry-run prints this and runs nothing. */
export function plan({ hasToken, rotate }) {
  const w = (args, note) => ({ line: `${WRANGLER_BIN} ${args.join(" ")}`, note });
  const secretNote = hasToken && !rotate
    ? "only if the database was just created (the saved token is kept)"
    : "token on stdin, never as an argument";
  return [
    w(ALLOWED[0]),
    w(ALLOWED[1]),
    w(ALLOWED[2], `only if "${DB_NAME}" is not in the list`),
    w(ALLOWED[3]),
    w(ALLOWED[4], `only if "${BUCKET_NAME}" is not in the list`),
    { line: `write ${DEPLOY_CONFIG}`, note: "fixed template plus the real database_id" },
    w(ALLOWED[5]),
    { line: "npm run build:client" },
    w(ALLOWED[6], secretNote),
    w(ALLOWED[7]),
    { line: "save ~/.config/tap-to-fix/config.json", note: "mode 0600" },
    { line: "read-only live check", note: "GET /api/health, /t.js, /r, /api/owner/overview without and with the token" },
  ];
}

/**
 * Runs the deploy. Returns the exit code: 0 ok, 1 error, 3 not signed in to Cloudflare (or offline).
 * run(cmd, args, { cwd, input }) → Promise<{ code, stdout, stderr? }>
 */
export async function deploy(argv, deps) {
  const {
    run,
    fetchImpl = fetch,
    home = homedir(),
    serviceDir,
    env = process.env,
    out = (s) => console.log(s),
    err = (s) => console.error(s),
    newToken = () => randomBytes(32).toString("base64url"),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = deps;
  const rotate = argv.includes("--rotate-token");
  const dryRun = argv.includes("--dry-run");
  const unknown = argv.filter((a) => a !== "--rotate-token" && a !== "--dry-run");
  if (unknown.length) {
    err(`deploy: unknown option ${unknown.join(" ")}. Options: --rotate-token, --dry-run`);
    return 1;
  }

  const saved = readSavedToken(home);
  if (dryRun) {
    out(`Dry run: nothing runs. A deploy runs these, in order, in ${serviceDir}:`);
    for (const step of plan({ hasToken: !!saved, rotate })) out(`  ${step.line}${step.note ? `    (${step.note})` : ""}`);
    out(`Owner token: ${saved && !rotate ? "kept from the saved config" : "a new one is generated"}.`);
    return 0;
  }

  // CLOUDFLARE_ENV makes wrangler target the Worker "tap-to-fix-<env>" instead.
  if (env.CLOUDFLARE_ENV) {
    err("deploy: CLOUDFLARE_ENV is set in this shell, which would send the deploy to a different Worker. Unset it (unset CLOUDFLARE_ENV) and run again.");
    return 1;
  }
  const wranglerPath = join(serviceDir, WRANGLER_BIN);
  if (!existsSync(wranglerPath)) {
    err(`deploy: ${WRANGLER_BIN} is missing. Run npm ci first, in ${serviceDir}.`);
    return 1;
  }

  let token = null; // set once known; every printed line is redacted against it
  const redact = (s) => (token ? String(s).split(token).join("[owner token]") : String(s));
  const say = (s) => out(redact(s));
  const fail = (what, res) => {
    err(redact(`deploy: ${what} failed (exit ${res.code}).`));
    const text = cleanOutput(`${res.stdout ?? ""}\n${res.stderr ?? ""}`).trim();
    if (text) err(redact(text.split("\n").slice(-30).join("\n")));
    return 1;
  };
  /** List commands: their output names other resources on the account, so it is never printed. */
  const failList = (kind, cmd, code) => {
    err(`deploy: couldn't read the ${kind} list from wrangler${code ? ` (exit ${code})` : ""} — run \`npx wrangler ${cmd}\` yourself to see why.`);
    return 1;
  };
  const wrangler = (args, opts = {}) => {
    assertAllowed(args);
    return run(wranglerPath, args, { cwd: serviceDir, ...opts });
  };

  // 1. Signed in?
  const who = await wrangler(["whoami", "--json"]);
  const whoJson = parseJsonOutput(who.stdout);
  if (who.code !== 0 || whoJson?.loggedIn !== true) {
    say("Not signed in to Cloudflare (or offline). Run: ! npx wrangler login");
    say("(It opens a browser. Then run the deploy again.)");
    const detail = cleanOutput(who.stderr ?? "").trim();
    if (detail) err(detail.split("\n").slice(-10).join("\n"));
    return 3;
  }
  const accounts = Array.isArray(whoJson?.accounts) ? whoJson.accounts : [];
  if (accounts.length > 1 && !env.CLOUDFLARE_ACCOUNT_ID) {
    err("deploy: this sign-in can reach more than one Cloudflare account, and the deploy will not pick one for you.");
    for (const a of accounts) err(`  ${a.name ?? "(unnamed)"}  ${a.id ?? ""}`);
    err("Run it again with the account to use: CLOUDFLARE_ACCOUNT_ID=<id> npm run deploy");
    return 1;
  }

  // 2. D1: reuse tap-to-fix, else create it.
  const d1List = await wrangler(["d1", "list", "--json"]);
  if (d1List.code !== 0) return failList("D1", "d1 list", d1List.code);
  const d1Json = parseJsonOutput(d1List.stdout);
  if (!Array.isArray(d1Json)) return failList("D1", "d1 list");
  let databaseId = findD1Id(d1Json);
  let createdDb = false;
  if (databaseId) {
    say(`D1 database ${DB_NAME}: reusing it.`);
  } else {
    const created = await wrangler(["d1", "create", DB_NAME]);
    if (created.code !== 0) return fail(`Creating D1 database ${DB_NAME}`, created);
    databaseId = parseD1CreateId(created.stdout);
    if (!databaseId) {
      const again = await wrangler(["d1", "list", "--json"]);
      databaseId = again.code === 0 ? findD1Id(parseJsonOutput(again.stdout)) : null;
    }
    if (!databaseId) return fail(`Finding the id of the new D1 database ${DB_NAME}`, created);
    createdDb = true;
    say(`D1 database ${DB_NAME}: created.`);
  }

  // R2: reuse tap-to-fix-shots, else create it. Other names in the list are only compared, never used or printed.
  const r2List = await wrangler(["r2", "bucket", "list"]);
  if (r2List.code !== 0) return failList("R2", "r2 bucket list", r2List.code);
  const r2Names = parseR2Names(r2List.stdout);
  // Readable: at least one `name:` row, or nothing at all besides the "Listing buckets..." line (no buckets yet).
  const r2Rest = cleanOutput(r2List.stdout).replace(/^\s*Listing buckets\.*\s*$/im, "").trim();
  const r2Readable = r2Names.length > 0 || r2Rest === "";
  if (!r2Readable) return failList("R2", "r2 bucket list");
  if (r2Names.includes(BUCKET_NAME)) {
    say(`R2 bucket ${BUCKET_NAME}: reusing it.`);
  } else {
    const created = await wrangler(["r2", "bucket", "create", BUCKET_NAME]);
    const text = `${created.stdout ?? ""}\n${created.stderr ?? ""}`;
    if (created.code !== 0 && !/already exists/i.test(text)) return fail(`Creating R2 bucket ${BUCKET_NAME}`, created);
    say(`R2 bucket ${BUCKET_NAME}: ${created.code === 0 ? "created" : "already there, reusing it"}.`);
  }

  // 3. The deploy config: a fixed template with the real database id.
  let deployToml;
  try {
    deployToml = renderDeployToml(readFileSync(join(serviceDir, "wrangler.toml"), "utf8"), databaseId);
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return 1;
  }
  writeFileSync(join(serviceDir, DEPLOY_CONFIG), deployToml);
  say(`Wrote ${DEPLOY_CONFIG}.`);

  // 4. Migrations.
  const migrate = await wrangler(["d1", "migrations", "apply", DB_NAME, "--remote", "-c", DEPLOY_CONFIG]);
  if (migrate.code !== 0) return fail("Applying D1 migrations", migrate);
  say("Migrations applied.");

  // 5. Build first, so a failed build never leaves a new live secret that was never saved.
  const build = await run("npm", ["run", "build:client"], { cwd: serviceDir });
  if (build.code !== 0) return fail("Building the client (npm run build:client)", build);
  say("Client built.");

  // 6. Owner token: keep the saved one unless rotating; a new database always gets the secret set.
  const keep = !!saved && !rotate;
  token = keep ? saved : newToken();
  if (!keep || createdDb) {
    const put = await wrangler(["secret", "put", "OWNER_TOKEN", "-c", DEPLOY_CONFIG], { input: token });
    if (put.code !== 0) return fail("Setting the OWNER_TOKEN secret", put);
    say(`Owner token: ${keep ? "kept, and set on the new deployment" : rotate ? "rotated" : "created"}.`);
  } else {
    say("Owner token: kept from the saved config.");
  }

  // 7. Deploy.
  const dep = await wrangler(["deploy", "-c", DEPLOY_CONFIG]);
  if (dep.code !== 0) return fail("wrangler deploy", dep);
  const service = parseWorkersDevUrl(dep.stdout) ?? parseWorkersDevUrl(dep.stderr);
  if (!service) return fail(`Finding the https://${WORKER_NAME}.<subdomain>.workers.dev URL in the deploy output`, { ...dep, code: 0 });
  say(`Deployed: ${service}`);

  // 8. Save, check the live service (read-only), print the tag and the owner link (once).
  saveConfig({ service, owner_token: token }, { home });
  say(`Saved ${configPath(home)} (mode 0600).`);

  const check = await liveCheck(service, token, fetchImpl, sleep);
  if (!check.ok) {
    for (const p of check.problems) err(redact(`deploy: live check: ${p}`));
    if (check.tokenMismatch) err("deploy: the saved owner token doesn't match the deployed one — run with --rotate-token");
    else err("deploy: the Worker is deployed and the config is saved, but the live check failed. Fix that, then run the deploy again (it keeps the same token and prints the owner link).");
    return 1;
  }
  say("Live check: ok.");

  say("");
  say("Script tag for each site (put the site's slug in data-site):");
  say(`  <script src="${service}/t.js" data-site="your-site-slug" defer></script>`);
  say("");
  say("Owner link. Save it now; the only other copy is the config file:");
  out(`  ${service}/o/#owner=${token}`);
  return 0;
}

function readSavedToken(home) {
  try {
    const raw = JSON.parse(readFileSync(configPath(home), "utf8"));
    return typeof raw.owner_token === "string" && raw.owner_token ? raw.owner_token : null;
  } catch {
    return null;
  }
}

/**
 * Read-only checks against the deployed Worker. It writes nothing. The token travels only
 * in the Authorization header. A 401 with the token means the saved token is not the live one.
 */
export async function liveCheck(service, token, fetchImpl, sleep = async () => {}) {
  const problems = [];
  let tokenMismatch = false;
  const get = async (path, headers = {}) => {
    try {
      return await fetchImpl(`${service}${path}`, { method: "GET", headers, redirect: "manual" });
    } catch (e) {
      return { status: 0, ok: false, headers: new Headers(), error: e instanceof Error ? e.message : String(e) };
    }
  };
  const status = (res) => (res.status ? `got ${res.status}` : `request failed (${res.error ?? "network"})`);

  // A new workers.dev URL can take a few seconds to answer.
  let health;
  for (let i = 0; i < 6; i++) {
    health = await get("/api/health");
    if (health.status === 200) break;
    await sleep(2000);
  }
  if (health.status !== 200) {
    problems.push(`GET /api/health: expected 200, ${status(health)}`);
    return { ok: false, problems, tokenMismatch };
  }

  const tjs = await get("/t.js");
  if (tjs.status !== 200) problems.push(`GET /t.js: expected 200, ${status(tjs)}`);
  else if (tjs.headers.get("access-control-allow-origin") !== "*") problems.push("GET /t.js: missing Access-Control-Allow-Origin: *");

  let r = await get("/r");
  if (r.status >= 300 && r.status < 400) {
    const loc = r.headers.get("location") ?? "";
    if (!/\/r\/$/.test(new URL(loc, service).pathname)) problems.push(`GET /r: redirected to ${loc || "(nowhere)"}, expected /r/`);
    else r = await get("/r/");
  }
  if (r.status !== 200) problems.push(`GET /r/: expected 200, ${status(r)}`);
  else if (r.headers.get("referrer-policy") !== "no-referrer") problems.push("GET /r/: missing Referrer-Policy: no-referrer");

  const anon = await get("/api/owner/overview");
  if (anon.status !== 401) problems.push(`GET /api/owner/overview without a token: expected 401, ${status(anon)}`);

  const authed = await get("/api/owner/overview", { Authorization: `Bearer ${token}` });
  if (authed.status === 401) {
    tokenMismatch = true;
    problems.push("GET /api/owner/overview with the saved token: 401");
  } else if (authed.status !== 200) problems.push(`GET /api/owner/overview with the saved token: expected 200, ${status(authed)}`);

  return { ok: problems.length === 0, problems, tokenMismatch };
}

/** The real run: no shell, stdin gets `input` and is then closed, output captured. CLOUDFLARE_ENV is dropped. */
export function spawnRun(cmd, args, { cwd, input } = {}) {
  return new Promise((resolve) => {
    const childEnv = { ...process.env };
    delete childEnv.CLOUDFLARE_ENV;
    const child = spawn(cmd, args, { cwd, env: childEnv, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => resolve({ code: 127, stdout, stderr: stderr + String(e) }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    if (input !== undefined) child.stdin.write(input);
    child.stdin.end();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const serviceDir = dirname(dirname(fileURLToPath(import.meta.url)));
  const code = await deploy(process.argv.slice(2), { run: spawnRun, serviceDir });
  process.exit(code);
}
