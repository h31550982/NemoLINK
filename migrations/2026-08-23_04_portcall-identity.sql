-- 0034 — port-call source identity + suggestion-era columns.
-- Idempotent, tenant-aware (docs/specs/0022): unqualified DDL replayed
-- into org_template + every active org schema.

SELECT platform.apply_to_tenants($ddl$

  -- External identity: the source system's own UUID for the call.
  -- Together with the existing `source` column (which stores the source
  -- system on ingested rows) this is the plan upsert key (spec 0034).
  ALTER TABLE port_call ADD COLUMN IF NOT EXISTS source_call_id uuid;
  CREATE UNIQUE INDEX IF NOT EXISTS port_call_source_call_uq
    ON port_call (source, source_call_id)
    WHERE source_call_id IS NOT NULL;

  -- What ingestion did with each archived event (created / plan_updated /
  -- arrival_suggested / unmatched / ...) — unplaced events stay queryable
  -- for operator triage.
  ALTER TABLE source_record ADD COLUMN IF NOT EXISTS outcome text;

$ddl$);
