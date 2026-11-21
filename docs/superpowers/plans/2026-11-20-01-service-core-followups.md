# Plan 1 (service core) — carry-forward notes

Written at the end of plan 1 (2026-11-20) so later plans inherit what the reviews found.

## Decisions made while building (rulings)
- Tests and local dev run on **Node** (`node:sqlite` D1 adapter, in-memory R2) because workerd needs macOS 13.5+ and this laptop is on 12.7.6. Production is still a Cloudflare Worker.
- `OWNER_TOKEN` never lives in `wrangler.toml`: tests set it in `test/env.ts`, local dev in git-ignored `service/.dev.vars`, production via `wrangler secret put`.
- Owner-token compare: SHA-256 both strings, constant-time XOR loop (works in Workers and Node).
- Reissuing a reviewer link clears `revoked_at`; revoke is how access is cut.
- Overview `unsettled_count` = open + in_progress; `ready_count` = open only.
- A new comment has `status_changed_at = NULL`; only a real status change (PATCH) sets it, so "updated since you looked" never fires from the reviewer's own comment.
- PATCH clears `note` unless the status is `later`/`kept`; `pr_url: null` clears the PR link.
- Batch takes `?status=open,in_progress,…` (default `open`).

## For plan 2 (comment layer)
- Paths match exactly (`/digital-detox` ≠ `/digital-detox/`); assignment paths can't contain `?` or `#`.
- Send `data` as a plain form field, not a file part; screenshot as the `screenshot` file part.
- Remove `ttf` from the address bar with `history.replaceState` on load (any script on the host page can read `location`).
- Call `GET /api/me/pages/comments` first; 404 means not assigned, so don't offer commenting.
- R2 adapter lacks Blob/stream `put`, etag and list; add when persistent dev screenshots are needed.

## For plan 3 (dashboards)
- Pages carrying `?ttf=` send `Referrer-Policy: no-referrer`; never log query strings.

## For plan 4 (plugin + deploy)
- Check `wrangler deploy` works on macOS 12 first; otherwise deploy from Daytona or CI.
- Run `service/scripts/smoke.sh` against real Workers/D1/R2 (deployed or `wrangler dev --remote`) before calling it done.
- `wrangler.toml` has placeholder D1/R2 ids.

## Small known gaps (fix when touched)
- Concurrent duplicate site slug or assignment returns 500 instead of 409/200 (use `ON CONFLICT`).
- D1 adapter edge cases the app doesn't use: `first(missingCol)`, `all()` meta, `INSERT…RETURNING` meta in batch, `run()` on SELECT.
- Comment create buffers the whole upload before the size check; orphan R2 object if the insert fails after `put`; no `device`/`element_x` range checks or body length cap.
- Dev server: `.dev.vars` beats an env `OWNER_TOKEN`; migration exec + record not one transaction; smoke is happy-path only.
