-- 2026-08-22_02_refdata — reference-data sync (docs/specs/0021)
-- Platform-only change (no tenant tables touched): hazmat reference cache +
-- sync-run bookkeeping. Idempotent — safe to rerun.

-- Hazmat reference cache (Fintraffic Hazmat Service sync).
-- hazmat_id = the service's own id (natural key); full DTO kept in data.
CREATE TABLE IF NOT EXISTS platform.hazmat_item (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hazmat_id             text NOT NULL,
  proper_shipping_name  text,
  undg_number           text,
  hazard_class          text,
  data                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  author                text,
  source                text,
  created               timestamptz NOT NULL DEFAULT now(),
  updated               timestamptz NOT NULL DEFAULT now(),
  is_active             boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS hazmat_item_hazmat_id_active_uq
  ON platform.hazmat_item (hazmat_id) WHERE is_active;

-- Reference-data sync bookkeeping: one row per run.
-- Mutual exclusion is a session advisory lock ('refdata:<job>'), not this table;
-- stale 'running' rows (crashed run) are marked failed by the next run.
CREATE TABLE IF NOT EXISTS platform.sync_run (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job       text NOT NULL,
  status    text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'failed')),
  started   timestamptz NOT NULL DEFAULT now(),
  finished  timestamptz,
  stats     jsonb NOT NULL DEFAULT '{}'::jsonb,
  error     text,
  author    text,
  created   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sync_run_job_started_idx
  ON platform.sync_run (job, started DESC);
