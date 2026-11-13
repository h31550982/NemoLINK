-- 2026-09-16_00_ingest-ship-autocreate — per-credential permission to create
-- ships from a `ship` envelope (docs/specs/0060). Platform-only change (no
-- tenant tables touched). Idempotent — safe to rerun.
--
-- Default false: a pushing system may register its own fleet only once someone
-- has switched the flag on for its credential (ingest-credential.js
-- may-create-ships <id> on). Plan and log-event envelopes never create a ship
-- whatever the flag says — see the spec.

ALTER TABLE platform.ingest_credential
  ADD COLUMN IF NOT EXISTS may_create_ships boolean NOT NULL DEFAULT false;
