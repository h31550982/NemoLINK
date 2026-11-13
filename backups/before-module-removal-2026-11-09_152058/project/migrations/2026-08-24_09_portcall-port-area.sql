-- 0048 — the port call's place inside the port: port area + berth.
-- Idempotent, tenant-aware (docs/specs/0022): unqualified DDL replayed
-- into org_template + every active org schema.
--
-- NEMO's own port call carries `portAreaCode` and `berth` (vendored
-- declarant API PortCall DTO, e.g. FIOUL-ANK / FIOUL-ANK-MUU); the VID
-- guidance says to fill them "if they are known". Reference data for the
-- pickers lives in platform.location.data.portAreas (spec 0027).

SELECT platform.apply_to_tenants($ddl$

  ALTER TABLE port_call ADD COLUMN IF NOT EXISTS port_area_code text;
  ALTER TABLE port_call ADD COLUMN IF NOT EXISTS berth text;

$ddl$);
