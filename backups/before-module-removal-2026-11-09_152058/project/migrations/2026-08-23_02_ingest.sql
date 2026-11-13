-- Spec 0026 — ingestion door + canonical port-call spine.
-- Idempotent; tenant DDL reaches org_template AND every active org schema
-- via platform.apply_to_tenants (docs/specs/0022).

-- Per-source scoped service credentials for /api/v1/ingest: org-bound +
-- source-system-bound; only the sha256 of the bearer token is stored.
CREATE TABLE IF NOT EXISTS platform.ingest_credential (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES platform.organization(id),
  source_system  text NOT NULL CHECK (source_system ~ '^[a-z][a-z0-9_-]*$'),
  label          text,
  token_hash     text NOT NULL UNIQUE,
  last_used      timestamptz,
  author         text,
  created        timestamptz NOT NULL DEFAULT now(),
  updated        timestamptz NOT NULL DEFAULT now(),
  is_active      boolean NOT NULL DEFAULT true
);

SELECT platform.apply_to_tenants($ddl$
  -- Port-call spine columns owned by ingestion (spec 0026): plan facts as
  -- real columns (invariant 10 reserves data-JSONB keys for MIG spelling),
  -- verified actuals from log events.
  ALTER TABLE port_call ADD COLUMN IF NOT EXISTS voyage_number text;
  ALTER TABLE port_call ADD COLUMN IF NOT EXISTS cargo_description text;
  ALTER TABLE port_call ADD COLUMN IF NOT EXISTS ata timestamptz;
  ALTER TABLE port_call ADD COLUMN IF NOT EXISTS atd timestamptz;
  -- Guarded since the 2026-08-23_06 ship rename: on a replayed live DB the
  -- column is already ship_id, so this historical index only applies while
  -- vessel_id exists (from-empty behavior unchanged — spec 0039).
  DO $ing$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'port_call'
                  AND column_name = 'vessel_id') THEN
      CREATE INDEX IF NOT EXISTS port_call_vessel_idx ON port_call (vessel_id);
    END IF;
  END
  $ing$;

  -- Envelope dedupe key: one (source system, event id) lands exactly once
  ALTER TABLE source_record ADD COLUMN IF NOT EXISTS event_id text;
  CREATE UNIQUE INDEX IF NOT EXISTS source_record_source_event_uq
    ON source_record (source_system, event_id) WHERE event_id IS NOT NULL;
$ddl$);
