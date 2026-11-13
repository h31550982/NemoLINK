-- 2026-09-24_00_platform-ships — ships become platform data (docs/specs/0067,
-- ADR 0005). One record per hull in platform.ship, shared by every
-- organisation, as NEMO's own ship database shares it. Moves every tenant's
-- ship rows (ids kept), stamps the owning org on their lanes and overrides,
-- points port_call.ship_id at the platform table and drops the tenant table.
-- Idempotent — replayed on every boot: a schema without a ship table is
-- skipped and every DDL step checks before acting.
--
-- Duplicates: the tenant tables allowed the same active IMO in two orgs. The
-- first schema in name order keeps its record (id, data and all); a later
-- org's active record for the same IMO is not moved — its port calls and
-- captains are pointed at the kept record and a NOTICE names it. Inactive
-- duplicates move untouched (the unique index covers active rows only).

CREATE TABLE IF NOT EXISTS platform.ship (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  imo_number  text,
  mmsi        text,
  call_sign   text,
  name        text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  author      text,
  author_org  text,
  source      text,
  created     timestamptz NOT NULL DEFAULT now(),
  updated     timestamptz NOT NULL DEFAULT now(),
  is_active   boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS ship_imo_active_uq
  ON platform.ship (imo_number) WHERE imo_number IS NOT NULL AND is_active;

DO $mig$
DECLARE
  s      text;
  slug   text;
  moved  integer;
  left_behind record;
BEGIN
  FOR s, slug IN
    SELECT x.schema_name, x.slug FROM (
      SELECT 'org_template'::text AS schema_name, NULL::text AS slug, 0 AS ord
      UNION ALL
      SELECT o.schema_name, o.slug, 1 FROM platform.organization o WHERE o.is_active
    ) x ORDER BY x.ord, x.schema_name
  LOOP
    IF to_regclass(format('%I.ship', s)) IS NOT NULL THEN
      IF slug IS NOT NULL THEN
        -- 1. Move rows, ids kept. An active row whose IMO already has an
        --    active platform record stays behind (repointed in step 3).
        EXECUTE format($q$
          INSERT INTO platform.ship
            (id, imo_number, mmsi, call_sign, name, data, author, author_org,
             source, created, updated, is_active)
          SELECT t.id, t.imo_number, t.mmsi, t.call_sign, t.name, t.data,
                 t.author, %L, t.source, t.created, t.updated, t.is_active
            FROM %I.ship t
           WHERE NOT EXISTS (SELECT 1 FROM platform.ship p WHERE p.id = t.id)
             AND NOT (t.is_active AND t.imo_number IS NOT NULL AND EXISTS (
                   SELECT 1 FROM platform.ship p
                    WHERE p.imo_number = t.imo_number AND p.is_active))
        $q$, slug, s);
        GET DIAGNOSTICS moved = ROW_COUNT;

        -- 2. Lanes and overrides written while the record was this org's own
        --    get the org stamped on them (spec 0067 §3 — the mask needs it).
        EXECUTE format($q$
          UPDATE platform.ship p
             SET data = p.data
               || CASE WHEN jsonb_typeof(p.data->'lanes') = 'object' THEN
                    jsonb_build_object('lanes', (
                      SELECT COALESCE(jsonb_object_agg(e.key,
                        CASE WHEN jsonb_typeof(e.value) <> 'object' OR e.value ? 'org'
                             THEN e.value
                             ELSE e.value || jsonb_build_object('org', %L) END), '{}'::jsonb)
                        FROM jsonb_each(p.data->'lanes') e))
                  ELSE '{}'::jsonb END
               || CASE WHEN jsonb_typeof(p.data->'overrides') = 'object' THEN
                    jsonb_build_object('overrides', (
                      SELECT COALESCE(jsonb_object_agg(e.key,
                        CASE WHEN jsonb_typeof(e.value) <> 'object' OR e.value ? 'org'
                             THEN e.value
                             ELSE e.value || jsonb_build_object('org', %L) END), '{}'::jsonb)
                        FROM jsonb_each(p.data->'overrides') e))
                  ELSE '{}'::jsonb END
           WHERE p.author_org = %L
             AND p.id IN (SELECT t.id FROM %I.ship t)
        $q$, slug, slug, slug, s);

        -- 3. Rows left behind (active IMO already on the platform): repoint
        --    this org's port calls and captains at the kept record.
        EXECUTE format($q$
          UPDATE %I.port_call pc SET ship_id = p.id
            FROM %I.ship t
            JOIN platform.ship p ON p.imo_number = t.imo_number AND p.is_active
           WHERE pc.ship_id = t.id AND p.id <> t.id
             AND NOT EXISTS (SELECT 1 FROM platform.ship q WHERE q.id = t.id)
        $q$, s, s);
        EXECUTE format($q$
          UPDATE platform.user_account u SET ship_id = p.id
            FROM %I.ship t
            JOIN platform.ship p ON p.imo_number = t.imo_number AND p.is_active
           WHERE u.ship_id = t.id AND p.id <> t.id
             AND NOT EXISTS (SELECT 1 FROM platform.ship q WHERE q.id = t.id)
        $q$, s);
        FOR left_behind IN EXECUTE format($q$
          SELECT t.id, t.imo_number, t.name FROM %I.ship t
           WHERE NOT EXISTS (SELECT 1 FROM platform.ship q WHERE q.id = t.id)
        $q$, s)
        LOOP
          RAISE NOTICE 'platform-ships: %.ship % (IMO %) not moved — merged into the platform record of the same IMO',
            s, left_behind.name, left_behind.imo_number;
        END LOOP;
        RAISE NOTICE 'platform-ships: % moved % ship rows to platform.ship', s, moved;
      END IF;

      -- 4. Old FK, old table.
      EXECUTE format('ALTER TABLE %I.port_call DROP CONSTRAINT IF EXISTS port_call_ship_id_fkey', s);
      EXECUTE format('DROP TABLE %I.ship', s);
    END IF;

    -- 5. port_call.ship_id → platform.ship(id), by name, once.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conname = 'port_call_ship_id_fkey'
         AND c.conrelid = format('%I.port_call', s)::regclass
         AND c.confrelid = 'platform.ship'::regclass
    ) THEN
      EXECUTE format('ALTER TABLE %I.port_call DROP CONSTRAINT IF EXISTS port_call_ship_id_fkey', s);
      EXECUTE format('ALTER TABLE %I.port_call ADD CONSTRAINT port_call_ship_id_fkey FOREIGN KEY (ship_id) REFERENCES platform.ship(id)', s);
    END IF;
  END LOOP;
END
$mig$;
