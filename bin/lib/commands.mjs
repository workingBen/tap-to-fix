import { loadConfig } from "./config.mjs";
import { client, ApiError, NetworkError } from "./api.mjs";
import { AmbiguousReviewer, UnknownReviewer, slug, resolveReviewer } from "./reviewers.mjs";
import { writeBatch, readBatchFile, defaultDir, newestBatchDir, batchDirs, dirForComment } from "./batch.mjs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setStatus, flushPending } from "./status.mjs";

/** Exit codes: 0 ok, 1 error, 2 ambiguous/unknown reviewer. */
export const EXIT = { ok: 0, error: 1, reviewer: 2 };

function needConfig(ctx) {
  const cfg = loadConfig({ env: ctx.env, home: ctx.home });
  if (!cfg) {
    ctx.err("No tap-to-fix config. Set TTF_SERVICE and TTF_OWNER_TOKEN, or run the setup skill.");
    return null;
  }
  return client(cfg, ctx.fetchImpl);
}

const FLAGS = new Set(["status", "out", "from", "pr", "note", "dir"]);

/** Splits argv into positionals and --flag value pairs. */
function parseArgs(args) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      if (!FLAGS.has(k)) throw new Error("Unknown option " + a);
      if (i + 1 >= args.length) throw new Error(a + " needs a value");
      flags[k] = args[++i];
    } else pos.push(a);
  }
  return { pos, flags };
}

const cwdOf = (ctx) => ctx.cwd ?? process.cwd();

/** The command table. Each entry: { usage, summary, run(args, ctx) => exit code }. */
export const commands = {
  reviewers: {
    usage: "ttf reviewers",
    summary: "List reviewers as: name · slug · id · open N",
    async run(_args, ctx) {
      const api = needConfig(ctx);
      if (!api) return EXIT.error;
      const { reviewers } = await api.overview();
      for (const r of reviewers) ctx.out(`${r.name} · ${slug(r.name)} · ${r.id} · open ${r.ready_count}`);
      return EXIT.ok;
    },
  },
  batch: {
    usage: "ttf batch <reviewer> <site> [--status open,in_progress] [--out DIR] [--from FILE]",
    summary: "Pull a reviewer's comments and screenshots into a local folder",
    async run(args, ctx) {
      const { pos, flags } = parseArgs(args);
      let batch;
      let shots = {};
      if (flags.from) {
        if (flags.status) ctx.err("Note: --status is ignored with --from; the file is used as-is.");
        ({ batch, shots } = readBatchFile(flags.from));
      } else {
        if (pos.length < 2) throw new Error("Usage: " + commands.batch.usage);
        const api = needConfig(ctx);
        if (!api) return EXIT.error;
        const { reviewers } = await api.overview();
        const reviewer = resolveReviewer(reviewers, pos[0]);
        const statuses = flags.status ? flags.status.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
        batch = await api.batch(reviewer.id, pos[1], statuses);
        for (const c of batch.comments) {
          if (!c.has_screenshot) continue;
          try {
            const s = await api.screenshot(c.id);
            if (s) shots[c.id] = s;
          } catch {
            // leave it missing; the batch is still useful
          }
        }
      }
      const dir = flags.out ?? defaultDir(cwdOf(ctx), batch, ctx.now ? ctx.now() : new Date());
      const written = writeBatch(dir, batch, shots);
      const missing = written.comments.filter((c) => c.screenshot === "missing" && c.has_screenshot).length;
      ctx.out(dir);
      ctx.out(`${written.comments.length} item${written.comments.length === 1 ? "" : "s"}` + (missing ? ` (${missing} screenshot${missing === 1 ? "" : "s"} missing)` : ""));
      return EXIT.ok;
    },
  },
  status: {
    usage: "ttf status <id> <in_progress|done|later|kept> [--pr URL] [--note TEXT] [--dir DIR]",
    summary: "Set a comment's status; queues offline in the batch folder",
    async run(args, ctx) {
      const { pos, flags } = parseArgs(args);
      if (pos.length !== 2) throw new Error("Usage: " + commands.status.usage);
      const api = needConfig(ctx);
      if (!api) return EXIT.error;
      const dir = flags.dir ?? dirForComment(cwdOf(ctx), pos[0]);
      const r = await setStatus({ api, dir, id: pos[0], status: pos[1], pr: flags.pr, note: flags.note, now: ctx.now ? ctx.now() : new Date() });
      ctx.out(r.queued ? `Queued (offline): ${pos[0]} -> ${pos[1]} in ${dir}. Run ttf flush when the network is back.` : `${pos[0]} -> ${r.result.status ?? pos[1]}`);
      return EXIT.ok;
    },
  },
  flush: {
    usage: "ttf flush [--dir DIR]",
    summary: "Send queued status changes",
    async run(args, ctx) {
      const { flags } = parseArgs(args);
      const api = needConfig(ctx);
      if (!api) return EXIT.error;
      const dirs = flags.dir
        ? [flags.dir]
        : batchDirs(cwdOf(ctx)).filter((d) => existsSync(join(d, "pending-status.jsonl")));
      if (!flags.dir && !dirs.length) {
        ctx.out("Nothing queued.");
        return EXIT.ok;
      }
      let left = 0;
      for (const dir of dirs) {
        const r = await flushPending(dir, api, ctx.now ? ctx.now() : new Date());
        ctx.out(`${dir}: sent ${r.sent}, rejected ${r.dropped.length}, still queued ${r.remaining}.`);
        for (const d of r.dropped) ctx.err(`Rejected ${d.id ?? "(unreadable)"}: ${d.reason} (saved in ${join(dir, "rejected-status.jsonl")})`);
        if (r.stopped) ctx.err(`Still queued in ${dir}: ${r.stopped}.`);
        left += r.remaining;
      }
      return left ? EXIT.error : EXIT.ok;
    },
  },
};

export async function main(argv, ctx) {
  const [name, ...args] = argv;
  const cmd = name && Object.hasOwn(commands, name) ? commands[name] : null;
  if (!cmd) {
    ctx.err("Usage:\n" + Object.values(commands).map((c) => `  ${c.usage}  ${c.summary}`).join("\n"));
    return name && name !== "help" && name !== "--help" ? EXIT.error : EXIT.ok;
  }
  try {
    return await cmd.run(args, ctx);
  } catch (e) {
    if (e instanceof AmbiguousReviewer || e instanceof UnknownReviewer) {
      ctx.err(e.message);
      return EXIT.reviewer;
    }
    if (e instanceof ApiError || e instanceof NetworkError) {
      ctx.err(e.message);
      return EXIT.error;
    }
    ctx.err(e instanceof Error ? e.message : String(e));
    return EXIT.error;
  }
}
