-- 2026-09-02_02_gisis-facilities — GISIS port-facility master list (docs/specs/0053)
-- Platform-only change (no tenant tables touched). Idempotent — safe to rerun.
--
-- One row per ISPS port facility from the IMO GISIS Maritime Security export,
-- uploaded by a platform admin (no public bulk URL — GISIS sits behind a login).
-- facility_code is the normalized full code (<LOCODE>-<4 digits>); locode and
-- country are derived from its prefix and are the join keys the read paths use.
-- Deactivation flips is_active on the same row (per-country replace on upload),
-- so the natural key is the primary key — no versioning here.

CREATE TABLE IF NOT EXISTS platform.gisis_port_facility (
  facility_code   text PRIMARY KEY,
  locode          text NOT NULL,
  country         text NOT NULL,
  port_name       text,
  facility_name   text NOT NULL,
  description     text,
  longitude       text,
  latitude        text,
  plan_approved   boolean,
  plan_withdrawn  boolean,
  source_updated  date,
  author          text,
  created         timestamptz NOT NULL DEFAULT now(),
  updated         timestamptz NOT NULL DEFAULT now(),
  is_active       boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS gisis_port_facility_locode_idx
  ON platform.gisis_port_facility (locode);
CREATE INDEX IF NOT EXISTS gisis_port_facility_country_idx
  ON platform.gisis_port_facility (country);
