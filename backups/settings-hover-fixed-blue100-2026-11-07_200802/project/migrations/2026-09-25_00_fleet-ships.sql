-- 2026-09-25_00_fleet-ships — each organisation's fleet (docs/specs/0068).
-- The master list stays in platform.ship (spec 0067); each org's shortlist is
-- a tenant table, fleet_ship, which also carries THAT org's overrides. Moves
-- the org-stamped overrides off the shared rows into the fleets and makes
-- 0067's derived membership (registered by the org, has a call in the org,
-- bound to one of its captains) explicit. Idempotent — replayed on every
-- boot: fleet rows are inserted only where missing, and the override strip
-- finds nothing on a rerun.

SELECT platform.apply_to_tenants($ddl$
  CREATE TABLE IF NOT EXISTS fleet_ship (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ship_id     uuid NOT NULL REFERENCES platform.ship(id),
    data        jsonb NOT NULL DEFAULT '{}'::jsonb,
    author      text,
    source      text,
    created     timestamptz NOT NULL DEFAULT now(),
    updated     timestamptz NOT NULL DEFAULT now(),
    is_active   boolean NOT NULL DEFAULT true
  );
  CREATE UNIQUE INDEX IF NOT EXISTS fleet_ship_active_uq
    ON fleet_ship (ship_id) WHERE is_active;
$ddl$);

DO $mig$
DECLARE
  s      text;
  slug   text;
  added  integer;
BEGIN
  FOR s, slug IN
    SELECT o.schema_name, o.slug FROM platform.organization o
     WHERE o.is_active ORDER BY o.schema_name
  LOOP
    -- The org's fleet: what 0067 derived, made a row — with the org's own
    -- overrides lifted off the shared record (the 'org' stamp says whose).
    EXECUTE format($q$
      INSERT INTO %I.fleet_ship (ship_id, data, author, source)
      SELECT p.id,
             CASE WHEN ov.overrides IS NULL THEN '{}'::jsonb
                  ELSE jsonb_build_object('overrides', ov.overrides) END,
             'migration:0068', 'migration'
        FROM platform.ship p
        LEFT JOIN LATERAL (
          SELECT jsonb_object_agg(e.key, e.value - 'org') AS overrides
            FROM jsonb_each(COALESCE(p.data->'overrides', '{}'::jsonb)) e
           WHERE jsonb_typeof(e.value) = 'object' AND e.value->>'org' = %L
        ) ov ON true
       WHERE (p.author_org = %L
              OR ov.overrides IS NOT NULL
              OR EXISTS (SELECT 1 FROM %I.port_call pc
                          WHERE pc.ship_id = p.id AND pc.is_active)
              OR EXISTS (SELECT 1 FROM platform.user_account u
                           JOIN platform.organization o ON o.id = u.org_id
                          WHERE u.ship_id = p.id AND o.slug = %L))
         AND NOT EXISTS (SELECT 1 FROM %I.fleet_ship f
                          WHERE f.ship_id = p.id AND f.is_active)
    $q$, s, slug, slug, s, slug, s);
    GET DIAGNOSTICS added = ROW_COUNT;
    RAISE NOTICE 'fleet-ships: % gained % fleet rows', s, added;
  END LOOP;

  -- Overrides are the organisation's now (spec 0068): nothing of them stays
  -- on the shared record. Orgs deactivated before this ran lose theirs —
  -- counted here, never silently.
  SELECT count(*) INTO added FROM platform.ship WHERE data ? 'overrides';
  IF added > 0 THEN
    UPDATE platform.ship SET data = data - 'overrides' WHERE data ? 'overrides';
    RAISE NOTICE 'fleet-ships: overrides removed from % master rows', added;
  END IF;
END
$mig$;
