-- 0093 D4 — a ship form that names no IMO (the NSW Security form has no
-- ship field at all) is kept, but counts for the call only once a user has
-- confirmed it is this ship's. Idempotent, tenant-aware (docs/specs/0022).
-- Existing documents stay as they were: counted.

SELECT platform.apply_to_tenants($ddl$

  ALTER TABLE port_call_document
    ADD COLUMN IF NOT EXISTS ship_confirm_needed boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS ship_confirmed_by text,
    ADD COLUMN IF NOT EXISTS ship_confirmed_at timestamptz;

$ddl$);
