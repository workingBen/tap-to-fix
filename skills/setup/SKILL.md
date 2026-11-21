---
name: setup
description: Use when the user runs /tap-to-fix:setup, asks to set up, deploy, install or redeploy tap-to-fix on their own Cloudflare account, or another tap-to-fix skill says to run setup (no sign-in config on this machine, or the owner token was rejected). Deploys the service to the signed-in Cloudflare account with its own D1 database and R2 bucket, saves the sign-in config, and hands over the script tag and the owner link.
---

# tap-to-fix: set up your own service

Deploys tap-to-fix to the user's own Cloudflare account. It creates (or reuses on a re-run) exactly two resources, the D1 database `tap-to-fix` and the R2 bucket `tap-to-fix-shots`, and the Worker `tap-to-fix`. Then it saves the service URL and owner token to `~/.config/tap-to-fix/config.json` (mode 0600), which the fix skill reads.

Arguments: optionally `--rotate-token` (issue a new owner token; the old owner link stops working). Without it, a re-run keeps the saved token, the data and the owner link.

## The service folder — resolve it once

This skill's loader printed `Base directory for this skill: <dir>`. The deploy script lives in `<dir>/../../service`. Resolve that to an absolute path once:

```bash
cd "<dir>/../../service" && pwd
```

Below, `<service dir>` stands for that literal absolute path, typed in each time. **Shell variables do not survive between Bash calls**, so never set one in one call and read it in another. Run every command in the foreground.

## Never

- **Never print, echo, cat or log the owner token**, other than relaying the owner link once in step 5. Never put it on a command line or in a URL query string. Do not open `~/.config/tap-to-fix/config.json`.
- Never run any other `wrangler` command against the account: no listing, creating, editing or deleting of buckets, databases or Workers by hand. The account also holds the user's other production resources. The deploy script names only `tap-to-fix` and `tap-to-fix-shots`, and refuses anything else.
- Never edit `wrangler.toml` to point at another bucket or database. The script checks the names and stops if they differ.

## 1. Confirm first

This creates resources on the user's Cloudflare account. Before running anything, show the plan and ask:

```bash
cd "<service dir>" && npm run deploy -- --dry-run
```

Then say: *"This deploys tap-to-fix to your Cloudflare account. It creates (or reuses) a D1 database `tap-to-fix`, an R2 bucket `tap-to-fix-shots` and a Worker `tap-to-fix`, and touches nothing else. The commands it will run are above. Go ahead?"*

Wait for a yes. If the user passed `--rotate-token`, add: *"It also issues a new owner token; your current owner link stops working."*

## 2. Node and packages

The script needs Node 22.13 or newer and the service's own packages (wrangler, esbuild).

```bash
cd "<service dir>" && (test -f ~/.nvm/nvm.sh && . ~/.nvm/nvm.sh && nvm use >/dev/null; node --version) && (test -d node_modules || npm ci)
```

If Node is older than 22.13, stop and say which version is installed and that tap-to-fix needs 22.13 or newer.

## 3. Deploy

```bash
cd "<service dir>" && (test -f ~/.nvm/nvm.sh && . ~/.nvm/nvm.sh && nvm use >/dev/null; npm run deploy)
```

Add ` -- --rotate-token` after `npm run deploy` only if the user asked for it. It takes a minute or two.

Exit codes: `0` deployed and checked live, `1` error (the message says which step), `3` not signed in to Cloudflare (or offline).

- **Exit `3`:** say: *"You're not signed in to Cloudflare (or this machine is offline). Type this, and a browser opens to sign in:"* then give the line `! cd "<service dir>" && npx wrangler login` with the literal path in it. Wait until the user says it worked, then run step 3 again.
- **Exit `1`, "more than one Cloudflare account":** show the accounts it listed and ask which one to use. Then run step 3 with `CLOUDFLARE_ACCOUNT_ID=<id>` in front of `npm run deploy`. Never pick one yourself.
- **Exit `1`, "the saved owner token doesn't match the deployed one":** offer to run step 3 again with `-- --rotate-token`. Say that this issues a new owner link and the old one stops working.
- **Exit `1`, any other "live check" line:** the Worker is deployed and the config is saved, but a check failed. Show the `live check:` lines and stop.
- **Exit `1`, CLOUDFLARE_ENV is set, or `npm ci` is needed:** do what the message says (step 2 runs `npm ci`), then run step 3 again.
- **Exit `1`, "couldn't read the D1 (or R2) list":** pass the message on as it is. It asks the user to run the list command themselves. Do not run it yourself, because its output names the account's other resources.
- **Exit `1`, anything else:** show the error and stop. Do not retry in a loop.

## 4. The live check

The deploy ends with a read-only check of the live service. It loads the health endpoint, `t.js` (which must allow any origin), the reviewer page `/r/` (which must send `Referrer-Policy: no-referrer`) and the owner overview, once without the token (which must be refused) and once with it. It writes nothing, so no test data is left on the owner dashboard. The token travels only in a request header, never on a command line.

## 5. Hand over the script tag and the owner link — once

On exit `0`, the last lines of the output are the script tag and the owner link. Relay both, exactly once:

- **The script tag** goes on every page of each site the reviewers will comment on, with that site's slug in `data-site`:
  `<script src="https://tap-to-fix.<subdomain>.workers.dev/t.js" data-site="your-site-slug" defer></script>` (with the real URL from the output).
- **The owner link** (`…/o/#owner=…`) opens the owner dashboard. Say: *"Save this link somewhere safe, such as a password manager. It is the only copy besides the config file on this machine, and anyone with it can manage your reviewers."*

Do not repeat the owner link later in the conversation, in a summary, a handoff or a working log.

## 6. Add sites and reviewers

Tell the user how to finish, from the owner dashboard (the owner link):

1. **Sites → Add a site:** slug (for example `bonus-decade`), name, origin (the site's `https://` address, no path) and repo (`owner/name`, the GitHub repo the fix skill works in).
2. Put the script tag on that site, with the same slug in `data-site`.
3. **Reviewers → Add a reviewer**, then copy that reviewer's private link to send them.
4. **Pages:** assign each reviewer the pages to look at.

When a reviewer's comments are ready, the dashboard shows the `/tap-to-fix:fix <reviewer> <site>` command to run in that site's repo.

To redeploy later (after updating the plugin), run this skill again. It reuses the same database, bucket and token, so the data and the owner link stay.
