-- Migration: 2026-08-22_00_auth
-- Idempotent — safe to rerun. Matches schema.sql as of this date.
-- Auth v1 (docs/specs/0011): platform users + opaque sessions.

CREATE TABLE IF NOT EXISTS platform.user_account (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES platform.organization(id),
  username         text NOT NULL,
  email            text,
  display_name     text,
  auth_type        text NOT NULL CHECK (auth_type IN ('oidc', 'local')),
  role             text NOT NULL CHECK (role IN ('admin', 'editor', 'viewer', 'crew')),
  vessel_id        uuid,                    -- crew scope; org-schema vessel id, no cross-schema FK
  oidc_issuer      text,
  oidc_subject     text,
  password_hash    text,                    -- argon2id; local accounts only
  failed_attempts  integer NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  author           text,
  created          timestamptz NOT NULL DEFAULT now(),
  updated          timestamptz NOT NULL DEFAULT now(),
  is_active        boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS user_account_username_key
  ON platform.user_account (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS user_account_oidc_key
  ON platform.user_account (oidc_issuer, oidc_subject)
  WHERE oidc_issuer IS NOT NULL;

CREATE TABLE IF NOT EXISTS platform.session (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  text NOT NULL UNIQUE,        -- sha256 of the opaque cookie token
  user_id     uuid NOT NULL REFERENCES platform.user_account(id),
  created     timestamptz NOT NULL DEFAULT now(),
  expires     timestamptz NOT NULL,
  last_seen   timestamptz NOT NULL DEFAULT now(),
  is_active   boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS session_user_idx ON platform.session (user_id);
