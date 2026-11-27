-- When the reviewer last tapped "Got it" on the "Since you last looked" notice (POST
-- /api/me/acknowledge). GET /api/me lists the comments settled after this time, page by page.
-- NULL until the first Got it, so the first notice lists every settled comment.
ALTER TABLE reviewers ADD COLUMN acknowledged_at TEXT;
