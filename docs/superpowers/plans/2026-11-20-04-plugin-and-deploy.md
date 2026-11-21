# tap-to-fix Claude Code Plugin and Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ben can deploy his own tap-to-fix to Cloudflare with one setup skill, and run `/tap-to-fix:fix alexis bonus-decade` to turn Alexis's open comments into a proofs review cycle that marks each comment in progress, then done with its PR link.

**Architecture:** The repo root becomes a Claude Code plugin (`.claude-plugin/`, `skills/setup`, `skills/fix`). A dependency-free Node CLI, `bin/ttf.mjs`, is the only thing skills call: it reads `~/.config/tap-to-fix/config.json` (service URL + owner token), pulls a batch with screenshots to a local folder, and posts status changes (queued to a file and retried when the network is down). A deploy script drives `wrangler` to create Ben's own D1 + R2, set the owner secret, build and deploy. Logic lives in `bin/lib/*.mjs` and is tested with Vitest from `service/` against the real Hono app (injected `fetch`).

**Tech Stack:** Node ≥ 22 (built-in `fetch`, `node:fs`), Wrangler 4.166 (verified 2026-11-20: `wrangler deploy --dry-run` bundles fine on this macOS 12 laptop; only local workerd needs 13.5+), Vitest, Playwright (owner dashboard button).

**Spec:** `docs/superpowers/specs/2026-11-20-tap-to-fix-design.md` · followups from plans 1–3: `2026-11-20-0{1,2,3}-*-followups.md` (read their "For plan 4" sections).

## Global Constraints

- American English. Commit with explicit paths; never `git add -A`. Tests in the foreground.
- The owner token never appears in git, in command output, in logs or in a URL query string. Config file mode `0600`. Printed owner link uses the fragment: `<service>/o/#owner=<token>` and is printed once, at setup.
- Setup creates its **own** D1 database `tap-to-fix` and R2 bucket `tap-to-fix-shots`; it never lists, reuses, modifies or deletes any other bucket (Ben's `r2_private` bucket especially). Generated deploy config `service/wrangler.deploy.toml` is git-ignored.
- `wrangler deploy` always runs after `npm run build:client` (plan 2 followup).
- Statuses: `open`, `in_progress`, `done`, `later`, `kept`; `later`/`kept` require a one-line note (plan 1 API). "Done" = PR merged, never "deployed".
- The fix skill requires the proofs plugin and wraps `proofs:review-cycle` without changing proofs.
- Reviewer argument matching (`ttf` and the owner dashboard's command must agree): exact id; else full-name slug (`alexis-rivera`); else first word, case-insensitive. Ambiguous → error listing each match's full name and slug, exit 2. The owner dashboard prints the first name when it is unique among reviewers, else the full-name slug.

## Review Focus

1. Network blocked mid-run (as on the Daytona sandbox) → `ttf status` queues the change in `pending-status.jsonl` and exits 0 with a clear line; `ttf flush` sends them later; nothing is lost (Task 2).
2. Two reviewers named Alexis → `ttf batch alexis …` exits 2 listing both slugs; owner dashboard shows slug commands for both (Tasks 1, 3).
3. Fix run started in the wrong repo → the skill stops before touching code and names the site's repo (Task 4 doc test).
4. Re-running setup on an existing deployment → reuses the same D1/R2, keeps data, does not rotate the owner token unless `--rotate-token` (Task 5).
5. A screenshot that fails to download → batch still written, item marked `screenshot: missing` (Task 2).

---

## File Structure

```
.claude-plugin/plugin.json, marketplace.json
skills/setup/SKILL.md          deploy, print script tag + owner link
skills/fix/SKILL.md            /tap-to-fix:fix <reviewer> <site>
bin/ttf.mjs                    CLI entry (argv → lib)
bin/lib/config.mjs             loadConfig, saveConfig
bin/lib/api.mjs                client(cfg, fetchImpl): overview, batch, patch, screenshot
bin/lib/reviewers.mjs          resolveReviewer(reviewers, arg), commandName(reviewers, reviewer)
bin/lib/batch.mjs              writeBatch(dir, batch, shots), queueMarkdown(batch, dir)
bin/lib/status.mjs             setStatus(...), flushPending(dir, client)
service/scripts/deploy.mjs     deploy steps via an injectable run(cmd,args)
service/test/cli/*.test.ts     Vitest, imports ../../../bin/lib/*.mjs
```

---

### Task 1: CLI core — config, API client, reviewer matching

**Files:** Create `bin/ttf.mjs`, `bin/lib/config.mjs`, `bin/lib/api.mjs`, `bin/lib/reviewers.mjs`; modify `service/vitest.config.ts` (include `test/cli`), `service/tsconfig.json` if needed (allowJs off is fine; tests import `.mjs`). Test: `service/test/cli/reviewers.test.ts`, `config.test.ts`, `api.test.ts`.

**Interfaces — Produces:**
- `loadConfig({ env, home }): { service: string; owner_token: string } | null` — `TTF_SERVICE` + `TTF_OWNER_TOKEN` env win; else `<home>/.config/tap-to-fix/config.json`. `saveConfig(cfg, { home })` writes with mode `0o600`, creating the folder `0o700`.
- `client(cfg, fetchImpl = fetch)` → `{ overview(), sites(), batch(reviewerId, site, statuses?), patch(id, body), screenshot(id): Promise<{ bytes: Uint8Array, type: string } | null> }`; Bearer auth; non-2xx throws `ApiError { status, message }` carrying the service's `error`; network failure throws `NetworkError`.
- `resolveReviewer(reviewers: {id,name}[], arg): {id,name}` per Global Constraints; throws `AmbiguousReviewer { matches }` / `UnknownReviewer`. `slug(name)`: lowercase, non-alphanumerics → `-`, trimmed. `commandName(reviewers, r)`: first word lowercased if unique, else `slug(r.name)`.
- `ttf reviewers` prints `name · slug · id · open N` lines; exit codes: 0 ok, 1 error, 2 ambiguous/unknown.

- [ ] **Step 1: Failing tests:** resolve by id; by full slug; by first word any case; ambiguous "alexis" with Alexis Rivera + Alexis Smith → `AmbiguousReviewer` listing both; unknown → `UnknownReviewer`; `commandName` unique → `"alexis"`, duplicate → `"alexis-rivera"`; config env wins over file; saved file mode `0o600`; `client` against the real app (`fetchImpl = req => app.fetch(req, env)` from `test/env.ts`) returns overview, and a wrong token throws `ApiError` 401.
- [ ] **Step 2: Run** `npx vitest run test/cli` — FAIL. **Step 3: Implement.** **Step 4:** PASS + `npm run typecheck`. **Step 5: Commit** `CLI core: config, API client, reviewer matching`.

### Task 2: `ttf batch`, `ttf status`, `ttf flush`

**Files:** Create `bin/lib/batch.mjs`, `bin/lib/status.mjs`; extend `bin/ttf.mjs`. Test: `service/test/cli/batch.test.ts`, `status.test.ts`.

**Interfaces — Produces:**
- `ttf batch <reviewer> <site> [--status open,in_progress] [--out DIR] [--from FILE]` → writes `DIR/batch.json` (plan 1 batch shape plus per comment `screenshot_path` or `screenshot: "missing"`), `DIR/shots/<id>.<webp|jpg|png>`, `DIR/queue.md`; default DIR `./.tap-to-fix/<site>-<reviewer slug>-<YYYYMMDD-HHMM>/`; prints DIR and the item count. `--from FILE` reads an offline batch file (Task 3 format: plan 1 batch + `screenshots: { [id]: { type, base64 } }`) instead of the API.
- `queueMarkdown(batch, dir): string` — one numbered item per comment: page title + URL, the comment body in quotes, `element_text`, selector, device + viewport, screenshot path, comment id. This is what the fix skill hands to review-cycle.
- `ttf status <id> <in_progress|done|later|kept> [--pr URL] [--note TEXT] [--dir DIR]` → PATCH; on `NetworkError` appends `{id, body, at}` to `DIR/pending-status.jsonl` (DIR = `--dir` or the newest batch dir) and prints `Queued (offline): …`, exit 0. `ttf flush [--dir DIR]` sends queued lines in order, rewriting the file with what still failed.
- [ ] **Step 1: Failing tests:** batch against the real app writes batch.json, two screenshots and queue.md with both comment ids; a screenshot 404 → `screenshot: "missing"`, still exit 0; `--from` file produces identical batch.json/queue.md and writes the base64 shots; status `done --pr` updates (verify via batch `status=done`); `later` without `--note` → exit 1 with the API's message; NetworkError (fetch that throws) queues the line; flush sends it and empties the file; a 404 during flush is reported and dropped (not retried forever).
- [ ] **Step 2–4:** fail, implement, pass. **Step 5: Commit** `CLI: batch pull with screenshots, status updates with offline queue`.

### Task 3: Batch file download + unique fix commands on the owner dashboard

**Files:** Modify `service/src/routes/owner.ts` (`GET /api/owner/batch?...&format=file` → the batch plus `screenshots` base64 map, `Content-Disposition: attachment; filename="tap-to-fix-<site>-<reviewer slug>-<YYYYMMDD>.json"`), `service/client/dash/owner.ts` (each ready box gets a "Download batch file" button: fetch with Bearer → Blob → download; `fixCommand` uses `commandName` rules — port the same logic to TS in `client/dash/names.ts` and have a test that runs the same cases as `reviewers.test.ts`). Tests: `service/test/owner-batch.test.ts` (extend), `test/client/dash-owner.test.ts`, `e2e/dashboards.spec.ts` (download event yields a JSON file whose `comments.length` matches the box count).

- [ ] **Step 1: Failing tests** (above, plus: duplicate first names → both ready boxes show slug commands). **Step 2–4.** **Step 5: Commit** `Owner dashboard: batch file download and unambiguous fix commands`.

### Task 4: The plugin and the fix skill

**Files:** Create `.claude-plugin/plugin.json` (name `tap-to-fix`, version `0.1.0`, author workingBen, repository, license MIT, description), `.claude-plugin/marketplace.json` (same shape as proofs'), `skills/fix/SKILL.md`. Test: `service/test/cli/skill-docs.test.ts`.

`skills/fix/SKILL.md` contract (frontmatter `name: fix`, a description that triggers on `/tap-to-fix:fix` and "fix Alexis's comments"):
1. Check prerequisites: proofs plugin installed (`proofs:review-cycle` available) else stop and say how to install; `ttf` config present else point to `/tap-to-fix:setup`.
2. `node ${CLAUDE_PLUGIN_ROOT}/bin/ttf.mjs batch <reviewer> <site>` (or `--from <file>` when Ben gives a downloaded batch file / the network is blocked). Exit 2 → show the matches and stop.
3. **Repo check:** `batch.json`'s `site.repo` must equal this checkout's `origin` (`owner/name`); otherwise stop and name the repo to open.
4. Zero comments → say so and stop.
5. Invoke `proofs:review-cycle` with `queue.md` as the opening batch, screenshots ON, telling it each item's screenshot path is the reviewer's own *before* evidence, and the page URL + selector + element text locate the spot.
6. Status rules the run follows, per item: picked up → `ttf status <id> in_progress`; PR merged → `ttf status <id> done --pr <url>`; became a to-do → `later --note "<one line>"`; decided not to change → `kept --note "<one line>"`; sent to a design review → stays `in_progress`. Never mark done before merge; never say "deployed".
7. At the end: `ttf flush`, then list any comment still `open` and why.

- [ ] **Step 1: Failing doc test:** every `ttf` subcommand named in `skills/*/SKILL.md` exists in `bin/ttf.mjs`'s command table; plugin.json parses and `name === "tap-to-fix"`; the fix skill mentions the repo check, all five status rules and `ttf flush`.
- [ ] **Step 2–4.** **Step 5: Commit** `Plugin: manifest and the fix skill wrapping proofs review-cycle`.

### Task 5: Deploy script and the setup skill

**Files:** Create `service/scripts/deploy.mjs`, `skills/setup/SKILL.md`; modify `.gitignore` (`service/wrangler.deploy.toml`), `service/package.json` (script `deploy`). Test: `service/test/cli/deploy.test.ts`.

`deploy.mjs [--rotate-token] [--dry-run]` with an injectable `run(cmd, args, opts) → { code, stdout }`:
1. `wrangler whoami` → not logged in: print `Run: ! npx wrangler login` and exit 3.
2. D1: `wrangler d1 list --json`; reuse `tap-to-fix` if present, else `wrangler d1 create tap-to-fix`. R2: `wrangler r2 bucket list`; reuse `tap-to-fix-shots`, else create it. Never touch any other name.
3. Write `wrangler.deploy.toml` from `wrangler.toml` with the real `database_id`.
4. `wrangler d1 migrations apply tap-to-fix --remote -c wrangler.deploy.toml`.
5. Owner token: if `~/.config/tap-to-fix/config.json` has one and no `--rotate-token`, keep it; else generate 32 random bytes base64url and `wrangler secret put OWNER_TOKEN` via stdin (never as an argument).
6. `npm run build:client`, then `wrangler deploy -c wrangler.deploy.toml`; parse the `*.workers.dev` URL from stdout.
7. `saveConfig({ service, owner_token })`; run `scripts/smoke.sh` with `BASE` and `OWNER_TOKEN` env against the deployed URL; print the script tag `<script src="<service>/t.js" data-site="<slug>" defer></script>` and the owner link `<service>/o/#owner=<token>` (once).

`skills/setup/SKILL.md`: confirm with Ben before running (it creates Cloudflare resources), run `npm run deploy` in `service/`, relay the script tag and owner link, then add his sites from the owner dashboard (or `curl` with the config token — never echo it).

- [ ] **Step 1: Failing tests** with a fake `run`: fresh account → creates both, sets the secret via stdin, builds before deploy, saves config; second run → reuses both, no secret put; `--rotate-token` → new secret; not logged in → exit 3 and no other command; other bucket names in the list are never passed to any command; the token never appears in any `args` array or printed line except the final owner link.
- [ ] **Step 2–4.** **Step 5: Commit** `Setup: deploy script and skill for Ben's own Cloudflare instance`.

### Task 6: Real deploy (needs Ben) and carry-forward

**Stop point:** ask Ben on the working log for the go-ahead and to run `! npx wrangler login`. Then run `npm run deploy` in `service/`; verify on the live URL: `/api/health`, `/t.js` CORS header, `/r` → `/r/` with `Referrer-Policy` (plan 3 followup), a full smoke. Add the three sites from the owner dashboard. Write `docs/superpowers/plans/2026-11-20-04-plugin-and-deploy-followups.md` (what plan 5 needs: the service origin for Bonus Decade's CSP, the exact script tag per sub-brand) and update README (install the plugin, setup, fix).

- [ ] **Step 1:** Ben's go-ahead + login. **Step 2:** deploy + live checks. **Step 3:** followups + README. **Step 4: Commit.**
