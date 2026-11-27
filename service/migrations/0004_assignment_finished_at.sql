-- When the reviewer marked the page "Review complete" on their list (/r/), so it moves to the
-- Finished list at the bottom. NULL while the page is still being reviewed, and again after
-- Re-review. Set and cleared by POST / DELETE /api/me/assignments/:id/finished.
ALTER TABLE assignments ADD COLUMN finished_at TEXT;
