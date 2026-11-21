#!/usr/bin/env node
// Deploys tap-to-fix to the signed-in Cloudflare account:
//   node scripts/deploy.mjs [--rotate-token] [--dry-run]     (npm run deploy -- --dry-run)
//
// It creates or reuses exactly two resources, the D1 database `tap-to-fix` and the
// R2 bucket `tap-to-fix-shots`, and deploys the Worker `tap-to-fix`. Every wrangler
// call goes through `wrangler()`, which refuses any argument list not in ALLOWED, so
// no other resource name can ever reach a wrangler command. The owner token goes to
// `wrangler secret put` on stdin only and is printed once, in the final owner link.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { configPath, saveConfig } from "../../bin/lib/config.mjs";

export const DB_NAME = "tap-to-fix";
export const BUCKET_NAME = "tap-to-fix-shots";
export const WORKER_NAME = "tap-to-fix";
export const DEPLOY_CONFIG = "wrangler.deploy.toml";
const SMOKE_REVIEWER = "Smoke Reviewer"; // the name scripts/smoke.sh gives its reviewer
const SMOKE_SITE = /^smoke-\d+$/; // the slug scripts/smoke.sh gives its site

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

/** wrangler.deploy.toml: wrangler.toml with the real database_id, after checking every name in it is ours. */
export function renderDeployToml(source, databaseId) {
  if (!UUID.test(databaseId)) throw new Error(`deploy: "${databaseId}" is not a D1 database id`);
  const values = (key) => [...source.matchAll(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "gm"))].map((m) => m[1]);
  const expect = { name: WORKER_NAME, database_name: DB_NAME, bucket_name: BUCKET_NAME };
  for (const [key, want] of Object.entries(expect)) {
    const got = values(key);
    if (got.length !== 1 || got[0] !== want) {
      throw new Error(`deploy: wrangler.toml must have exactly one ${key} = "${want}" (found ${JSON.stringify(got)}); not deploying`);
    }
  }
  if (values("database_id").length !== 1) throw new Error("deploy: wrangler.toml must have exactly one database_id");
  const body = source.replace(/^(\s*database_id\s*=\s*)"[^"]*"/m, `$1"${databaseId}"`);
  return `# Generated by scripts/deploy.mjs from wrangler.toml. Git-ignored; do not edit.\n${body}`;
}

/** What a fresh deploy runs, in order. --dry-run prints this and runs nothing. */
export function plan({ hasToken, rotate }) {
  const w = (args, note) => ({ line: `npx wrangler ${args.join(" ")}`, note });
  const secretNote = hasToken && !rotate
    ? "only if the database was just created (the saved token is kept)"
    : "token on stdin, never as an argument";
  return [
    w(ALLOWED[0]),
    w(ALLOWED[1]),
    w(ALLOWED[2], `only if "${DB_NAME}" is not in the list`),
    w(ALLOWED[3]),
    w(ALLOWED[4], `only if "${BUCKET_NAME}" is not in the list`),
    { line: `write ${DEPLOY_CONFIG}`, note: "wrangler.toml plus the real database_id" },
    w(ALLOWED[5]),
    w(ALLOWED[6], secretNote),
    { line: "npm run build:client" },
    w(ALLOWED[7]),
    { line: "save ~/.config/tap-to-fix/config.json", note: "mode 0600" },
    { line: "bash scripts/smoke.sh", note: "BASE and OWNER_TOKEN in its environment; then removes its test data" },
  ];
}

/**
 * Runs the deploy. Returns the exit code: 0 ok, 1 error, 3 not signed in to Cloudflare.
 * run(cmd, args, { cwd, input, env }) → Promise<{ code, stdout, stderr? }>
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

  let token = null; // set once known; every printed line is redacted against it
  const redact = (s) => (token ? String(s).split(token).join("[owner token]") : String(s));
  const say = (s) => out(redact(s));
  const fail = (what, res) => {
    err(redact(`deploy: ${what} failed (exit ${res.code}).`));
    const text = cleanOutput(`${res.stdout ?? ""}\n${res.stderr ?? ""}`).trim();
    if (text) err(redact(text.split("\n").slice(-30).join("\n")));
    return 1;
  };
  const wrangler = (args, opts = {}) => {
    assertAllowed(args);
    return run("npx", ["wrangler", ...args], { cwd: serviceDir, ...opts });
  };

  // 1. Signed in?
  const who = await wrangler(["whoami", "--json"]);
  const whoJson = parseJsonOutput(who.stdout);
  if (who.code !== 0 || whoJson?.loggedIn !== true) {
    const text = `${who.stdout ?? ""}\n${who.stderr ?? ""}`;
    if (whoJson?.loggedIn === false || /not authenticated|not logged in|wrangler login/i.test(text) || who.code !== 0) {
      say("Not signed in to Cloudflare. Run: ! npx wrangler login");
      say("(It opens a browser. Then run the deploy again.)");
      return 3;
    }
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
  if (d1List.code !== 0) return fail("Listing D1 databases", d1List);
  const d1Json = parseJsonOutput(d1List.stdout);
  if (!Array.isArray(d1Json)) return fail("Reading the D1 database list (no JSON list in the output)", d1List);
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

  // R2: reuse tap-to-fix-shots, else create it. Other names in the list are only compared, never used.
  const r2List = await wrangler(["r2", "bucket", "list"]);
  if (r2List.code !== 0) return fail("Listing R2 buckets", r2List);
  if (parseR2Names(r2List.stdout).includes(BUCKET_NAME)) {
    say(`R2 bucket ${BUCKET_NAME}: reusing it.`);
  } else {
    const created = await wrangler(["r2", "bucket", "create", BUCKET_NAME]);
    const text = `${created.stdout ?? ""}\n${created.stderr ?? ""}`;
    if (created.code !== 0 && !/already exists/i.test(text)) return fail(`Creating R2 bucket ${BUCKET_NAME}`, created);
    say(`R2 bucket ${BUCKET_NAME}: ${created.code === 0 ? "created" : "already there, reusing it"}.`);
  }

  // 3. The deploy config, with the real database id.
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

  // 5. Owner token: keep the saved one unless rotating; a new database always gets the secret set.
  const keep = !!saved && !rotate;
  token = keep ? saved : newToken();
  if (!keep || createdDb) {
    const put = await wrangler(["secret", "put", "OWNER_TOKEN", "-c", DEPLOY_CONFIG], { input: token });
    if (put.code !== 0) return fail("Setting the OWNER_TOKEN secret", put);
    say(`Owner token: ${keep ? "kept, and set on the new deployment" : rotate ? "rotated" : "created"}.`);
  } else {
    say("Owner token: kept from the saved config.");
  }

  // 6. Build the client, then deploy (always in this order).
  const build = await run("npm", ["run", "build:client"], { cwd: serviceDir });
  if (build.code !== 0) return fail("Building the client (npm run build:client)", build);
  const dep = await wrangler(["deploy", "-c", DEPLOY_CONFIG]);
  if (dep.code !== 0) return fail("wrangler deploy", dep);
  const service = parseWorkersDevUrl(dep.stdout) ?? parseWorkersDevUrl(dep.stderr);
  if (!service) return fail(`Finding the https://${WORKER_NAME}.<subdomain>.workers.dev URL in the deploy output`, { ...dep, code: 0 });
  say(`Deployed: ${service}`);

  // 7. Save, smoke test, print the tag and the owner link (once).
  saveConfig({ service, owner_token: token }, { home });
  say(`Saved ${configPath(home)} (mode 0600).`);

  const before = await ownerSnapshot(service, token, fetchImpl);
  const smoke = await run("bash", ["scripts/smoke.sh"], {
    cwd: serviceDir,
    env: { ...env, BASE: service, OWNER_TOKEN: token },
  });
  const cleanup = before ? await cleanUpSmoke(service, token, fetchImpl, before) : null;
  if (cleanup) say(cleanup);
  else say("Smoke data: not cleaned up (could not read the owner overview before the smoke test).");
  if (smoke.code !== 0) {
    fail("The smoke test", smoke);
    err(keep
      ? "deploy: if the smoke test got a 401, the saved owner token does not match the deployed one. Run again with --rotate-token."
      : "deploy: the Worker is deployed but did not pass the smoke test. Fix that, then run the deploy again (it keeps the same token and prints the owner link).");
    return 1;
  }
  say("Smoke test: ok.");

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

async function ownerJson(service, token, fetchImpl, path, init = {}) {
  const res = await fetchImpl(`${service}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  return res;
}

/** Ids of every reviewer and assignment before the smoke test, so cleanup only touches what it added. */
async function ownerSnapshot(service, token, fetchImpl) {
  try {
    const res = await ownerJson(service, token, fetchImpl, "/api/owner/overview");
    if (!res.ok) return null;
    const o = await res.json();
    return { reviewers: new Set(o.reviewers.map((r) => r.id)), assignments: new Set(o.assignments.map((a) => a.id)) };
  } catch {
    return null;
  }
}

/**
 * Deletes the smoke test's assignment (and with it its comment and any screenshot) and revokes its reviewer.
 * Only rows that are new since `before` and carry smoke.sh's names. The API cannot delete a site or a
 * reviewer, so one "Smoke" site and one revoked "Smoke Reviewer" stay per run.
 */
async function cleanUpSmoke(service, token, fetchImpl, before) {
  try {
    const res = await ownerJson(service, token, fetchImpl, "/api/owner/overview");
    if (!res.ok) return `Smoke data: not cleaned up (overview returned ${res.status}).`;
    const o = await res.json();
    let deleted = 0;
    let revoked = 0;
    for (const a of o.assignments) {
      if (before.assignments.has(a.id) || !SMOKE_SITE.test(a.site)) continue;
      const d = await ownerJson(service, token, fetchImpl, `/api/owner/assignments/${encodeURIComponent(a.id)}`, { method: "DELETE" });
      if (d.ok) deleted++;
    }
    for (const r of o.reviewers) {
      if (before.reviewers.has(r.id) || r.name !== SMOKE_REVIEWER || r.revoked) continue;
      const d = await ownerJson(service, token, fetchImpl, `/api/owner/reviewers/${encodeURIComponent(r.id)}/revoke`, { method: "POST" });
      if (d.ok) revoked++;
    }
    return `Smoke data: removed ${deleted} test assignment(s) and revoked ${revoked} test reviewer(s); the test site row stays (the API has no site delete).`;
  } catch (e) {
    return `Smoke data: not cleaned up (${e instanceof Error ? e.message : String(e)}).`;
  }
}

/** The real run: no shell, stdin closed after `input`, output captured. */
export function spawnRun(cmd, args, { cwd, input, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: env ?? process.env, stdio: ["pipe", "pipe", "pipe"] });
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
