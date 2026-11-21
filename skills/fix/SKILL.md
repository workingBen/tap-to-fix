---
name: fix
description: Use when the user runs /tap-to-fix:fix <reviewer> <site>, or asks to fix, work through or go over a reviewer's tap-to-fix comments ("fix Alexis's comments", "work Alexis's comments on the main site"). Pulls that reviewer's open comments and screenshots for one site, runs them as a proofs review cycle, and reports each comment's status back to the service as the cycle works.
---

# tap-to-fix: fix one reviewer's comments

Turns one reviewer's open comments on one site into a `proofs:review-cycle` session, and keeps each comment's status on the service in step with what the cycle does, so the reviewer sees progress on their own list.

Arguments: `<reviewer>` (an id, a full-name slug such as `alexis-rivera`, or a first name) and `<site>` (the site slug). If either is missing, ask for it once, then go.

Every CLI call below is `node "${CLAUDE_PLUGIN_ROOT}/bin/ttf.mjs" …`. Run each in the foreground and read its exit code: `0` ok, `1` error (the message is on stderr), `2` the reviewer argument is ambiguous or unknown.

## Never

- **Never print, echo, cat or log the owner token, and never put it on a command line or in a URL.** The CLI reads it itself. Do not open `~/.config/tap-to-fix/config.json`; test that it exists.
- Never mark a comment `done` before its PR is merged. Never say "deployed": a merge does not deploy.
- Never commit the batch folder (`.tap-to-fix/`). It holds the reviewer's screenshots.

## 1. Prerequisites

1. **proofs:** the `proofs:review-cycle` skill must be in your skill list. If it is not, stop and say: *"tap-to-fix needs the proofs plugin. Install it with `/plugin marketplace add workingBen/proofs` then `/plugin install proofs@proofs`, and run this again."*
2. **Sign-in config:** it comes from `/tap-to-fix:setup`, which saves the service URL and owner token to `~/.config/tap-to-fix/config.json` (mode 0600). Check that the file exists without reading it:
   ```bash
   test -f ~/.config/tap-to-fix/config.json && echo "config: present" || echo "config: missing"
   ```
   Missing → stop and say: *"No tap-to-fix sign-in on this machine. Run `/tap-to-fix:setup` first."* (The CLI also accepts `TTF_SERVICE` plus `TTF_OWNER_TOKEN` from the environment; if the user says those are set, carry on, and a CLI error naming the config means they are not.) Every status call needs the sign-in, even offline, so do not continue without it.
3. **Keep the batch out of git:** if `git check-ignore -q .tap-to-fix/x` fails, run `echo '.tap-to-fix/' >> .git/info/exclude` (local only; no commit).

## 2. Pull the batch

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/ttf.mjs" batch <reviewer> <site>
```

When the user hands you a downloaded batch file from the owner dashboard, or the network is blocked (a sandbox), use the file instead: `node "${CLAUDE_PLUGIN_ROOT}/bin/ttf.mjs" batch <reviewer> <site> --from <file>`.

- Exit `2` → show the matches it printed (full name and slug for each) and stop. Do not guess which one.
- Exit `1` → show the error and stop. If it is a network failure, say the dashboard's batch file plus `--from` works offline.
- Exit `0` → line 1 of stdout is the batch folder; line 2 is the item count. Save the folder as an **absolute path**; call it `DIR`. Everything below passes `--dir "$DIR"`, because review-cycle works in a worktree and the CLI cannot find the folder from there on its own.

`DIR` holds `batch.json`, `queue.md` and `shots/`. A comment whose screenshot could not be fetched carries `screenshot: "missing"`; work it anyway, from the page URL, selector and element text.

## 3. Repo check — before any code is touched

The site's repo is `site.repo` in `batch.json`. It must match this checkout's `origin` as `owner/name`:

```bash
node -e '
const norm = (s) => String(s).trim().replace(/\/+$/, "").replace(/\.git$/, "").replace(/^.*github\.com[:/]/, "").toLowerCase();
const want = norm(require(process.argv[1]).site.repo);
const have = norm(require("node:child_process").execSync("git remote get-url origin").toString());
if (want !== have) { console.error(`Wrong repo: this site lives in ${want}; this checkout is ${have || "(no origin)"}.`); process.exit(1); }
console.log("Repo OK: " + have);
' "$DIR/batch.json"
```

Non-zero → stop and say: *"These comments are for `<site.repo>`. Open that repo and run `/tap-to-fix:fix <reviewer> <site>` there."* Set no statuses and edit nothing.

## 4. Nothing to do

Item count `0` → say *"<Reviewer> has no open comments on <site>."* and stop.

## 5. Run the review cycle

Invoke `proofs:review-cycle` with the contents of `$DIR/queue.md` as the opening batch. Tell it:

- **Screenshots ON** (its default; do not ask).
- Each item's `Screenshot:` path is the reviewer's own phone or desktop **before** evidence, at the device and viewport the item lists. Put it on the tracking page as the before for that width; capture your own before only for the other width. Pair every after with a before at the same viewport.
- The page URL locates the page; the `Selector` and `Element text` locate the spot the reviewer tapped. Search the code for the element text first; the selector confirms it.
- Each item's `Comment id` is what the status calls below take.

Review-cycle's own rules still apply in this repo unchanged: one worktree for the session off a freshly fetched `origin/main`, one item / one branch / one PR, merge once the local suite is green, the project's own rules on CI and merging, and the owner deploys, not you. This skill adds the status calls; it changes nothing in proofs.

## 6. Status rules — one call per transition, as it happens

| When, in the cycle | Call |
|---|---|
| Item picked up (intake) | `node "${CLAUDE_PLUGIN_ROOT}/bin/ttf.mjs" status <id> in_progress --dir "$DIR"` |
| Its PR is merged (`gh pr view <n> --json state` says `MERGED`) | `node "${CLAUDE_PLUGIN_ROOT}/bin/ttf.mjs" status <id> done --pr <PR url> --dir "$DIR"` |
| Saved as a to-do instead of built | `node "${CLAUDE_PLUGIN_ROOT}/bin/ttf.mjs" status <id> later --note "<one line>" --dir "$DIR"` |
| Decided not to change it | `node "${CLAUDE_PLUGIN_ROOT}/bin/ttf.mjs" status <id> kept --note "<one line>" --dir "$DIR"` |
| Sent to a design review (or visual QA, copy edit, photo picker, style guide), or flagged Needs input | No call: it stays `in_progress` until the picks or the answer come back and it ships (`done`), is saved (`later`) or is kept (`kept`) |

- The `--note` is one plain sentence the reviewer may read: what happens next, or why it stays as it is. No jargon, no line breaks.
- Two comments fixed by one PR each get their own `done` call with the same `--pr`.
- `Queued (offline): …` on stdout is a success: the change waits in `$DIR/pending-status.jsonl`. Keep going.
- Exit `1` on a status call → note the error on that item's card and keep going; do not retry in a loop.

## 7. Finish

1. Send anything queued offline:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/ttf.mjs" flush --dir "$DIR"
   ```
   Exit `1` means some changes are still queued (network still down): say so, and that running the same `flush` later sends them. Any line it rejected is saved in `$DIR/rejected-status.jsonl`; name each one and the reason.
2. List every comment id in `$DIR/batch.json` that never got a status call, is still queued, or was rejected — that comment is still `open` (or stale) on the service. Give each one's page, a few words of its body, and why (not reached, flagged, waiting on a review page, still queued offline).
3. Report in the review-cycle's end-of-session summary: per item, the status sent and its PR or note. Merged means merged, not deployed.
