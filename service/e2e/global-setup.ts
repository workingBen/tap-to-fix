// Boots the service (fresh SQLite file) and the fixture servers, seeds a site, reviewers and
// an assignment, and hands ids/tokens to the specs through process.env. Returns the teardown.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SERVICE = "http://localhost:8788";
export const FIXTURE = "http://localhost:4173";
export const OWNER_TOKEN = "e2e-owner";

const serviceDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function launch(cmd: string, args: string[], env: Record<string, string>): ChildProcess {
  // Own process group, so teardown can kill tsx and the node child it starts.
  const child = spawn(cmd, args, { cwd: serviceDir, env: { ...process.env, ...env }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr?.on("data", (d) => process.stderr.write(`[${args.at(-1)}] ${d}`));
  child.stdout?.resume();
  return child;
}

/** SIGTERM the child's process group and wait (up to 5 s) for it to exit, so ports are free. */
async function kill(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    return;
  }
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
}

async function portFree(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(500) });
    return false;
  } catch {
    return true;
  }
}

async function waitFor(url: string, child: ChildProcess): Promise<void> {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`${url}: server exited with code ${child.exitCode}`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${url} did not come up within 30 s`);
}

async function owner<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${SERVICE}/api/owner${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${OWNER_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  for (const url of [SERVICE, FIXTURE, "http://localhost:4174"]) {
    if (!(await portFree(url))) throw new Error(`${url} is already in use; stop whatever is running there first.`);
  }
  const tmp = mkdtempSync(join(tmpdir(), "ttf-e2e-"));
  const children: ChildProcess[] = [];
  const teardown = async () => {
    await Promise.all(children.map(kill));
    rmSync(tmp, { recursive: true, force: true });
  };
  try {
    const service = launch(join(serviceDir, "node_modules", ".bin", "tsx"), ["src/node/server.ts"], {
      PORT: "8788",
      OWNER_TOKEN,
      TTF_DB_PATH: join(tmp, "e2e.sqlite"),
    });
    children.push(service);
    const fixture = launch(process.execPath, ["e2e/fixture-server.mjs"], {});
    children.push(fixture);
    await waitFor(`${SERVICE}/api/health`, service);
    await waitFor(`${FIXTURE}/index.html`, fixture);

    await owner("/sites", { slug: "fixture", name: "Fixture", origin: FIXTURE, repo: "workingBen/fixture" });
    const alexis = await owner<{ id: string; token: string }>("/reviewers", { name: "Alexis" });
    const assignment = await owner<{ id: string }>("/assignments", {
      site: "fixture",
      reviewer_id: alexis.id,
      path: "/index.html",
      title: "Fixture home",
    });
    process.env.TTF_REVIEWER_ID = alexis.id;
    process.env.TTF_TOKEN = alexis.token;
    process.env.TTF_ASSIGNMENT_ID = assignment.id;
    process.env.TTF_OWNER_TOKEN = OWNER_TOKEN;
  } catch (err) {
    await teardown();
    throw err;
  }
  return teardown;
}
