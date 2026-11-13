-- 0051 — operator corrections on parsed documents: an overlay keyed by
-- check path, never touching parsed.form (invariant 9 — the file's own
-- words stay as uploaded). Idempotent, tenant-aware (docs/specs/0022).

SELECT platform.apply_to_tenants($ddl$

  ALTER TABLE port_call_document
    ADD COLUMN IF NOT EXISTS corrections jsonb;

$ddl$);
