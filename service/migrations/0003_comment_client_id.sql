-- The id the comment layer gives a comment on the reviewer's phone before it is sent (offline
-- mode keeps unsent comments there and retries). A retry, or a second tab sending the same
-- comment, finds the stored row by this id instead of saving it twice (POST /api/me/comments).
-- NULL for comments saved before this, and from older copies of the comment layer.
ALTER TABLE comments ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX idx_comments_client ON comments(assignment_id, client_id);
