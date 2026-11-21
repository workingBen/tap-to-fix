import { loadConfig } from "./config.mjs";
import { client, ApiError, NetworkError } from "./api.mjs";
import { AmbiguousReviewer, UnknownReviewer, slug } from "./reviewers.mjs";

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
