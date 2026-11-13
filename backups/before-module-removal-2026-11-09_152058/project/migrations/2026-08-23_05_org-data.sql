-- Spec 0038: org declarant profile — static customer-level data (carrier
-- agent block under the vendored NOA spelling) lives in a data JSONB on the
-- org registry row. Platform-only change: no tenant schemas touched.
-- Idempotent (safe to rerun).

ALTER TABLE platform.organization
  ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
