-- 2026-08-23_00_tenant-migration-helper — platform.apply_to_tenants (docs/specs/0022)
-- One call applies an unqualified DDL block to org_template AND every active
-- org schema (same replay semantics as tenant provisioning), so tenant-table
-- migrations can never reach the template but miss live tenants. Idempotent.
--
-- Usage in a migration:
--   SELECT platform.apply_to_tenants($ddl$
--     ALTER TABLE port_call ADD COLUMN IF NOT EXISTS example text;
--   $ddl$);

CREATE OR REPLACE FUNCTION platform.apply_to_tenants(ddl text)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  s        text;
  original text := current_setting('search_path');
  applied  integer := 0;
BEGIN
  FOR s IN
    SELECT x FROM unnest(
      ARRAY['org_template'] ||
      ARRAY(SELECT schema_name FROM platform.organization
             WHERE is_active ORDER BY schema_name)
    ) AS t(x)
  LOOP
    PERFORM set_config('search_path', s, true);
    EXECUTE ddl;
    applied := applied + 1;
  END LOOP;
  PERFORM set_config('search_path', original, true);
  RETURN applied;
END;
$fn$;
