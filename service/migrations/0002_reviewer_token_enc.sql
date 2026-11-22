-- The reviewer's token, sealed with the LINK_KEY secret (AES-GCM, see src/linkcrypt.ts), so the
-- owner can copy or text a reviewer's link again. Auth still matches token_hash only.
-- NULL for reviewers made before this, and after a link is turned off.
ALTER TABLE reviewers ADD COLUMN token_enc TEXT;
