# Security

## Reporting a vulnerability

Please report security problems privately, through GitHub's private vulnerability reporting:
[Report a vulnerability](https://github.com/workingBen/tap-to-fix/security/advisories/new)
(the **Security** tab, then **Report a vulnerability**).

Do not open a public issue for a security problem. Include what you found, how to reproduce it,
and what an attacker could do with it. You should hear back within a week.

## Scope

tap-to-fix is self-hosted: each owner deploys their own copy to their own Cloudflare account. There
is no shared service to attack. Reports about the code in this repo are in scope:

- The Worker in `service/src/`: owner and reviewer sign-in, the API, and how screenshots are served.
- The script tag and comment layer (`t.js`, `overlay.js`) that run on the owner's site, and the
  owner and reviewer dashboards (`service/client/`).
- The deploy script (`service/scripts/deploy.mjs`), the CLI (`bin/`) and the Claude Code skills
  (`skills/`), including anything that could leak the owner token, the `LINK_KEY` secret or a
  reviewer token.

Out of scope:

- Anything that needs the owner token, or access to the owner's machine or Cloudflare account.
- Problems in Cloudflare itself, or in a site that installs the script tag.
- Using up a free Cloudflare plan's quotas with a valid reviewer link, within the limits below.

## How it protects data

- **Reviewer tokens** are random, 256-bit, and stored as a SHA-256 hash for sign-in. A copy sealed
  with AES-256-GCM under the `LINK_KEY` Worker secret lets the owner show a link again. Turning off
  a link deletes that copy.
- **The owner token** is a Worker secret, compared in constant time. It is never stored in D1.
- **Screenshots** sit in a private R2 bucket. The service serves them only to the owner and to the
  reviewer who made them, with `Cache-Control: private, no-store`.
- **Tokens stay out of logs.** Reviewer links carry the token in the URL fragment (`#ttf=`), which
  browsers do not send to servers. Every response sends `Referrer-Policy: no-referrer`.
- **Comments are tied to their site.** A reviewer can comment only on a page assigned to them. When
  a browser sends an `Origin` header, it must be the site's registered origin, and the API's CORS
  headers name only registered origins.

## Limits on reviewer writes

`POST /api/me/comments` (the only write that stores data) enforces these, from `service/src/limits.ts`:

| Limit | Value | Over it |
|---|---|---|
| Whole request | 1 MB screenshot + 64 KB | 413, nothing saved |
| Comment text | 5,000 characters | 413, nothing saved |
| Screenshot | 1 MB, WebP, PNG or JPEG | comment saved without it |
| Location fields (selector, element text, device) | 2,000 characters each | comment saved without that field |
| Comments per reviewer | 20 a minute, 300 a day | 429 with `Retry-After` |

The rate limit counts the reviewer's saved comments in D1, so it holds across every Worker
instance. It is not exact: two requests that arrive together can both pass the check, so a burst
can go slightly over. Refused requests are not counted. Owner endpoints are not rate limited,
since they need the owner token.

Known trade-offs:

- An older `?ttf=TOKEN` link form still works, and a token in a query string can end up in logs.
  New links never use it.
- A request without an `Origin` header (a script rather than a browser) is accepted if its reviewer
  token is valid. The token is the credential; the `Origin` check stops other websites from posting
  with a reviewer's browser.
