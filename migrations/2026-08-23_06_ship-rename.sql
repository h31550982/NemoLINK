-- Spec 0039: one word — "ship". Renames the tenant vessel table and its
-- identifiers to ship (matching what a fresh schema.sql build auto-names),
-- plus the platform crew-scope column. Idempotent: every rename is guarded,
-- so replay-all converges. Historical migrations keep creating `vessel`;
-- this one, replayed after them, renames it.

SELECT platform.apply_to_tenants($ddl$
DO $rename$
DECLARE
  con record;
  stray bigint;
BEGIN
  -- Replay-all artifact: after this rename once ran, the historical
  -- base-schema replay recreates an EMPTY vessel table (CREATE TABLE IF
  -- NOT EXISTS). Drop it — but never a vessel that holds rows.
  IF to_regclass('ship') IS NOT NULL AND to_regclass('vessel') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM vessel' INTO stray;
    IF stray = 0 THEN
      DROP TABLE vessel;
    ELSE
      RAISE EXCEPTION 'both ship and vessel hold rows in % — resolve by hand',
        current_schema();
    END IF;
  END IF;
  IF to_regclass('vessel') IS NOT NULL THEN
    ALTER TABLE vessel RENAME TO ship;
  END IF;
  -- Every auto-named constraint follows the table name on a fresh build:
  -- vessel_pkey and the PG-18 named NOT NULL constraints (vessel_<col>_not_null)
  FOR con IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = current_schema()
       AND t.relname = 'ship'
       AND c.conname LIKE 'vessel\_%'
  LOOP
    EXECUTE format(
      'ALTER TABLE ship RENAME CONSTRAINT %I TO %I',
      con.conname,
      'ship_' || substring(con.conname FROM 8)
    );
  END LOOP;
  IF to_regclass('vessel_imo_active_uq') IS NOT NULL THEN
    ALTER INDEX vessel_imo_active_uq RENAME TO ship_imo_active_uq;
  END IF;
  IF EXISTS (SELECT 1
               FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'port_call'
                AND column_name = 'vessel_id') THEN
    ALTER TABLE port_call RENAME COLUMN vessel_id TO ship_id;
  END IF;
  IF EXISTS (SELECT 1
               FROM pg_constraint c
               JOIN pg_class t ON t.oid = c.conrelid
               JOIN pg_namespace n ON n.oid = t.relnamespace
              WHERE n.nspname = current_schema()
                AND t.relname = 'port_call'
                AND c.conname = 'port_call_vessel_id_fkey') THEN
    ALTER TABLE port_call RENAME CONSTRAINT port_call_vessel_id_fkey
      TO port_call_ship_id_fkey;
  END IF;
  IF to_regclass('port_call_vessel_idx') IS NOT NULL THEN
    ALTER INDEX port_call_vessel_idx RENAME TO port_call_ship_idx;
  END IF;
END
$rename$;
$ddl$);

-- Platform: crew scope column (no cross-schema FK by design)
DO $platform$
BEGIN
  IF EXISTS (SELECT 1
               FROM information_schema.columns
              WHERE table_schema = 'platform'
                AND table_name = 'user_account'
                AND column_name = 'vessel_id') THEN
    ALTER TABLE platform.user_account RENAME COLUMN vessel_id TO ship_id;
  END IF;
END
$platform$;
