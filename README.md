# tap-to-fix

tap-to-fix lets a reviewer tap a spot on a live page and leave a comment with a screenshot. The site owner then works through each reviewer's batch of comments with Claude Code in a review cycle, marking each one done, saved for later, or kept as is.

## service/

The backend is a Hono app with D1 (SQLite) and R2 storage. Run these from `service/`:

```bash
npm test                  # unit and route tests
npm run dev:node          # dev server on http://localhost:8787 (needs OWNER_TOKEN in .dev.vars or the environment)
bash scripts/smoke.sh     # end-to-end check against the running dev server; ends with "smoke: ok"
```

Production runs as a Cloudflare Worker (deploy comes in a later plan). Local dev and tests run on Node instead, because workerd needs macOS 13.5+. The Node dev server keeps its database in `service/.local/dev.sqlite`; screenshots live in memory and are lost on restart.
