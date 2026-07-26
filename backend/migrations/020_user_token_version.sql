-- Token-version counter for JWT revocation.
--
-- Every access token carries the user's token_version as a `tv` claim; the
-- auth guard rejects a token whose `tv` no longer matches the row. Bumping
-- this column (on password change / admin reset) therefore invalidates every
-- token issued before the bump, without a server-side token store.
--
-- Existing tokens have no `tv` claim and decode as 0; all existing rows start
-- at 0, so tokens issued before this migration stay valid until their first
-- password change — no forced logout on deploy.

ALTER TABLE users
    ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
