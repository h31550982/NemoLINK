-- 2026-08-23_01_hs-map — FI statistics-group → representative-HS mapping +
-- hub codelist support (docs/specs/0023). Platform-only change; seeded by the
-- refdata 'hsmap'/'codelists' syncs from vendor/nemo/hub/. Idempotent.

-- Hub codelists carry an FI-Preferred flag the spreadsheet lacks
ALTER TABLE platform.codelist_entry
  ADD COLUMN IF NOT EXISTS fi_preferred boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS platform.hs_map (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_code   text NOT NULL,              -- tilastoryhmäkoodi, e.g. 22, 29.1
  group_label  text,                       -- Finnish group label (as published)
  refinement   text NOT NULL,              -- tarkennus, e.g. Sellu / Puuhioke
  hs6          text NOT NULL,              -- representative HS code, zero-padded
  hs_printed   text,                       -- verbatim value as the hub prints it
  author       text,
  source       text,
  created      timestamptz NOT NULL DEFAULT now(),
  updated      timestamptz NOT NULL DEFAULT now(),
  is_active    boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS hs_map_group_refinement_active_uq
  ON platform.hs_map (group_code, refinement) WHERE is_active;
