// Screenshot byte ceiling (1 MB). Ben's call, 2026-11-20.
export const MAX_SCREENSHOT_BYTES = 1_048_576;

// Offline batch file (GET /api/owner/batch?format=file): screenshots are embedded only while both
// limits hold, so the Worker never builds a file larger than ~40 MB raw (~54 MB base64). Comments
// past either limit are still in the file, marked screenshot_omitted. Mutable only so tests can
// inject small values.
export const BATCH_FILE_MAX_SHOTS = 40;
export const BATCH_FILE_MAX_BYTES = 40 * 1024 * 1024;
export const batchFileLimits = { maxShots: BATCH_FILE_MAX_SHOTS, maxBytes: BATCH_FILE_MAX_BYTES };

// Comment text, in characters (JavaScript string length). A longer body gets 413 and saves nothing;
// the comment layer keeps the text so the reviewer can shorten it.
export const MAX_COMMENT_CHARS = 5_000;

// Location fields (selector, element_text, device). The comment layer sends far less; a longer one
// is stored as null and the comment is still saved, like a screenshot that can't be kept.
export const MAX_FIELD_CHARS = 2_000;

// Whole POST /api/me/comments request: the screenshot ceiling plus room for the form fields.
// Anything larger gets 413 before the body is parsed.
export const MAX_COMMENT_REQUEST_BYTES = MAX_SCREENSHOT_BYTES + 64 * 1024;

// Saved comments per reviewer, counted from the comments table, so the limit holds across every
// Worker isolate. Two concurrent requests can both pass the check, so a burst can go a little over.
// Mutable only so tests can inject small values.
export const COMMENTS_PER_MINUTE = 20;
export const COMMENTS_PER_DAY = 300;
export const commentLimits = { perMinute: COMMENTS_PER_MINUTE, perDay: COMMENTS_PER_DAY };
