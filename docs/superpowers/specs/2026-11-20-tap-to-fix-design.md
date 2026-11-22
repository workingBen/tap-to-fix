# tap-to-fix — design

2026-11-20 · Ben Pellow with Claude · status: draft for Ben's approval

## Why

Ben's reviewers (Alexis first) find problems on his sites from their phones. Today they text him screenshots plus a message per problem, and he relays those into a Claude Code review cycle by hand. The spot on the page each comment is about gets lost on the way, so Claude has to re-find the element, and Ben is the bottleneck.

tap-to-fix lets a reviewer tap the exact spot on the live page, type a comment, and have it land, with a screenshot and the precise location, in a queue Ben works through with Claude in a review cycle. Ben assigns pages to specific reviewers; each reviewer has their own dashboard showing what to review and what has changed since they last looked.

It is built for Ben first, then open-sourced with its own website, the way Proofs was (`workingBen/proofs`, site at workingben.github.io/proofs).

## Goals

1. A reviewer can comment on any public page assigned to them, from a phone or desktop, by tapping a spot and typing. Nothing to install, no account.
2. Each comment carries a screenshot and an exact, re-findable location on the page.
3. Ben assigns pages to named reviewers, and each reviewer gets a private dashboard of their assigned pages with status and an "updated since you looked" flag.
4. Ben has an owner dashboard: reviewers, assignments, per-assignment status with links to the page and the fixing PR, and the command that starts a review cycle for one reviewer's batch.
5. Ben starts the fix run himself, in Claude Code, one reviewer's whole batch at a time, through the proofs `review-cycle` skill (which already routes design calls to `design-review`). The run marks comments *in progress* and then *done*, with the PR link.
6. It works with any site, whatever it is built with. The only thing a site adds is one script tag.
7. It is beautiful and friendlier than Loupe (the closest prior art). That is a requirement, not a polish pass.

## Non-goals (for now, by Ben's decision)

- **No notifications.** No email, text or push. Reviewers check their dashboard.
- **No before/after screenshots of fixes and no deploy tracking.** Status is just open / in progress / done, plus links to the page and the PR. (Ben: "too much infrastructure for this so far.")
- **No "Looks right / Still not right" confirm step.** If something still looks wrong, the reviewer leaves a new comment.
- **No pages behind a login.** Public pages only.
- **No automatic fix runs.** Claude never picks up comments on its own; Ben starts each run.
- **No hosted service for other people.** Each installer runs their own instance. Ben does not operate a service for strangers.

## Anti-goals (would be a failure even if it technically works)

- Reviewers needing to install anything, make an account, or remember a password.
- The comment layer ever appearing to an ordinary visitor of the site.
- Reviewers being stored in the host app's user accounts. They are separate on purpose.
- A comment whose spot on the page cannot be found again.
- Looking like developer tooling (Loupe's look). The reviewers are family and friends, many on phones, and skew older; type stays large.

## Decided by Ben

| Topic | Decision |
|---|---|
| Build or adopt | Build our own, borrowing ideas from Loupe (MIT, github.com/mohamed-ashraf-elsaed/loupe): what it captures per comment, how it re-finds a pin after the page changes. Huddlekit was ruled out (phone review needs its widget, $19/mo for Claude access, SaaS only). |
| Where it lives | **A small service of its own**, separate from any app, so it works with any stack. Each installer deploys their own. Ben's admin panel links to it. |
| Notifications | None. |
| Fix runs | Ben starts them, one reviewer's batch at a time, in a review cycle. |
| Status | Open / in progress / done, plus page link and PR link. Nothing more. |
| Pages | Public only. |
| Look | **"Paper"** on all three screens: warm off-white, serif headings, ink text, one green accent. Mockups: design review at https://claude.ai/artifact/3GRTyX4piRHteaAvEsDTV7 (variant A of each item). |
| Commenting on a phone | Paper variant A: tap drops a numbered pin; a sheet slides up from the bottom ("What should change here?", the pinned element named under it, big Save comment / Cancel). A thin bar at the top shows "Reviewing · N comments · Done". The sheet never covers the pinned spot. |
| Reviewer dashboard | Paper variant A (greeting, one sentence of instructions, an open list with dividers, no cards, page title, path, comment counts, a chip: *Updated since you looked* / *New* / *All done*), **plus the progress circle from variant B on the left of each row** (share of that reviewer's comments on the page that are done). |
| Owner dashboard | Paper variant A: reviewers down the left with open counts and "+ Add a reviewer"; on the right "+ Assign a page", a highlighted box "Alexis has 7 comments ready for a review cycle" with the command to run, and a ruled table of assignments (page + path, reviewer, status chip, Page link, PR link). |
| Name | **tap-to-fix.** Free on GitHub (`workingBen/tap-to-fix`) and npm as of 2026-11-20; `taptofix.dev` appeared unregistered, `.com` is parked, `.app` is taken. |
| Sites | **One instance for all of Ben's sites** (Bonus Decade's three sub-brands and low-emf-life). Each site is a record that remembers its repo; a fix batch is one reviewer on one site, e.g. `/tap-to-fix:fix alexis bonus-decade`. |
| Statuses | Open, In progress, Done, plus **Saved for later** (became a to-do) and **Kept as is** (decided not to change), each of those two with a one-line note from Ben the reviewer can read. A comment sent to a design review stays In progress until Ben picks. Done reads *Fixed — goes live with Ben's next update*. The progress circle counts Done, Saved for later and Kept as is as settled. |
| Other reviewers' pins | **Not shown.** Each reviewer sees only their own pins and comments. "Updated since you looked" counts only their own comments. |
| Open source | Yes, with its own website like Proofs, once Ben has used it himself. |

## Decided by Claude (Ben can overrule)

- **Reviewer sign-in is a personal private link** (one link per reviewer across all sites), one per reviewer, that Ben texts them once; they save it to their home screen. It can be revoked and reissued from the owner dashboard. (No email exists anywhere in the system, so magic-link email was dropped.)
- **The comment layer loads only for reviewers, and reviewers always enter from their dashboard.** Every page link on the dashboard carries the reviewer's token, so it never has to survive in the browser (iOS keeps home-screen web apps' storage apart from Safari's, and Safari clears script-written storage after about 7 days without a visit). The site's script tag is a tiny loader that does nothing without a token in the URL; it may keep the token for the current visit only. Reviewers comment only on pages assigned to them. Ordinary visitors download a few hundred bytes and see nothing.
- **"Updated since you looked"** means: a comment of yours on this page changed status since you last opened the page from your dashboard. "New" means assigned and never opened.
- **Stack for the service:** Cloudflare Worker + D1 (database) + R2 (screenshots), deployable to a free Cloudflare account with one command run by the plugin. Ben already uses Cloudflare R2 for private media (`r2_private`). Screenshots are private: served only through the service to the owner, the reviewer who made them, and Claude's access token, never by public URL.
- **Screenshots are taken in the reviewer's browser** at the moment of commenting (rendering the page's DOM to an image, as Loupe does), then downscaled in the browser before upload. Each stores: the image, the pin's position within it, page URL, viewport size and device type, and the element's location (CSS selector, text content, position within the element), enough to re-find it after the page changes.
- **Claude Code side is a plugin in the same repo** (`/plugin install tap-to-fix@...`), which needs the proofs plugin installed. It provides: a setup skill (deploy the service, print the script tag and the owner link), and a fix skill invoked as `/tap-to-fix:fix alexis` that pulls that reviewer's open comments (text, screenshot, location, page) and hands them to `proofs:review-cycle` as its queue, marking each *in progress* when picked up and *done* with the PR link when merged. The owner dashboard's highlighted box shows this command.
- **The fix skill wraps `proofs:review-cycle` without requiring changes to proofs.** It loads the batch as the cycle's queue and instructs the run to update each comment's status (via a small command the plugin ships) when an item is picked up and when its PR merges. A proper intake/status hook in proofs can come later; proofs is also Ben's, so a small change there is allowed if it turns out cleaner.
- **"Done" means merged, not live** (deploy tracking was ruled out). The reviewer-facing wording says so: *Fixed — goes live with Ben's next update*, so nobody re-files a fix they can't see yet.
- **Fix runs happen on the laptop** and talk to the service's API directly. If the network is blocked (as the Daytona sandbox's has been), the owner dashboard offers a downloadable batch file the fix skill can read instead.
- **Setup reuses the installer's existing Cloudflare account** with its own new database and storage bucket; for Ben, his current account, never his existing `r2_private` bucket.
- **One repo** `workingBen/tap-to-fix` holding the service, the overlay script, the dashboards, the Claude Code plugin, and the website (GitHub Pages, like Proofs).

## Constraints

- **Phones are the main case.** iOS Safari first; every screen is designed at 390px wide before desktop.
- **Large type for reviewers**, 17px body minimum, no tiny labels. Monochrome line icons, no emoji.
- **Fewer cards**: rules, dividers and space over boxes (Ben's standing preference).
- **American English** throughout, code included.
- **Bonus Decade's content security policy** (`config/initializers/content_security_policy.rb`) allows scripts only from itself and two named hosts; adding tap-to-fix to Bonus Decade means adding the service's host to `script_src`, `connect_src` and `img_src`. That change in Bonus Decade follows Bonus Decade's own rules (worktree, PR, Ben deploys).
- **Cross-origin images** (Bonus Decade serves photos from Cloudinary) can come out blank or block an in-browser screenshot. The capture must handle that gracefully: a screenshot with a gray box where a photo was is acceptable; failing to save the comment is not.
- **Never lose a comment.** If the screenshot fails, save the comment and location without it.
- Free-tier hosting must be enough for a handful of reviewers.

## Left to the builder

- Database schema, API shape, and the access-token scheme for owner and Claude.
- The library used for in-browser screenshots, and the downscale size (Ben's other projects downscale every upload in the browser before sending, with a server-side size ceiling as a backstop; follow that pattern, and ask Ben before fixing the numbers).
- How a pin is re-found after the page changes, and what shows when it can't be (Loupe shows a "moved" badge).
- How the overlay is isolated from the host page's styles (Loupe uses Shadow DOM).
- Typeface for the tool itself (the mockups used the device's own serif).
- How the website is built and what is on it, beyond "like Proofs".
- Test approach, release and versioning.

## Open, to settle with Ben during planning

- None. (Screenshot limits settled 2026-11-20: downscale to 1200 px wide in the browser, 1 MB server ceiling.)
