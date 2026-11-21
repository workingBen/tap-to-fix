// Screenshot byte ceiling (1 MB). Ben's call, 2026-11-20.
export const MAX_SCREENSHOT_BYTES = 1_048_576;

// Offline batch file (GET /api/owner/batch?format=file): screenshots are embedded only while both
// limits hold, so the Worker never builds a file larger than ~40 MB raw (~54 MB base64). Comments
// past either limit are still in the file, marked screenshot_omitted. Mutable only so tests can
// inject small values.
export const BATCH_FILE_MAX_SHOTS = 40;
export const BATCH_FILE_MAX_BYTES = 40 * 1024 * 1024;
export const batchFileLimits = { maxShots: BATCH_FILE_MAX_SHOTS, maxBytes: BATCH_FILE_MAX_BYTES };
