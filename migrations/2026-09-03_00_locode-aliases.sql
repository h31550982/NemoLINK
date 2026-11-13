-- 2026-09-03_00_locode-aliases — legacy and superseded LOCODEs (docs/specs/0056)
-- Platform-only change (no tenant tables touched). Idempotent — safe to rerun.
--
-- One row per known-bad-or-old way of naming a place: a code that is not a
-- LOCODE at all, a code the Finnish port system no longer operates because the
-- place is a port area of a bigger port, a place that was renamed while its code
-- stayed put, or a code that is valid somewhere else entirely.
--
-- `relation` decides what the door may do with the row: not_a_code /
-- port_area_of / renamed may substitute; confusable_with may only suggest,
-- because replacing a valid code for a real place is an operator's call.
--
-- Keyed by (given_code, given_name) so both a code lookup ('FIMTY') and a name
-- lookup ('Raasepori') can find a row; COALESCE keeps the unique index usable
-- when either side is null.

CREATE TABLE IF NOT EXISTS platform.location_alias (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  given_code    text,
  given_name    text,
  relation      text NOT NULL,
  current_code  text,
  note          text NOT NULL,
  evidence      text,
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  author        text,
  source        text,
  created       timestamptz NOT NULL DEFAULT now(),
  updated       timestamptz NOT NULL DEFAULT now(),
  is_active     boolean NOT NULL DEFAULT true,
  CONSTRAINT location_alias_relation_check CHECK (
    relation IN ('not_a_code', 'port_area_of', 'renamed', 'confusable_with')
  ),
  CONSTRAINT location_alias_key_check CHECK (
    given_code IS NOT NULL OR given_name IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS location_alias_key
  ON platform.location_alias (COALESCE(given_code, ''), COALESCE(given_name, ''));

-- Code lookups are the hot path (every ingested plan, every checked document).
CREATE INDEX IF NOT EXISTS location_alias_given_code
  ON platform.location_alias (given_code) WHERE is_active;
