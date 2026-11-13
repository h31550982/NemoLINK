-- 2026-09-09_00_nemo-credential-vault — per-org NEMO credentials (docs/specs/0059)
-- Platform-only change (no tenant tables touched). Idempotent — safe to rerun.
--
-- The table has existed since the base schema; spec 0002 deliberately left the
-- encryption logic and the access rules to "the vault spec". This is that spec.
--
-- What changes: credentials become target-scoped. Open question 1 expects
-- customers to hold separate STG and PRD keys, and a pilot org will have both at
-- once, so (org_id) alone cannot identify "the" credential. Rotation stays an
-- insert plus a deactivate — never an update in place — so the partial unique
-- index is on the active row only and the history below it stays readable.
--
-- Nothing here touches ciphertext: the blob layout (format byte, iv, GCM tag)
-- and the master-key naming in key_id are the application's business.

ALTER TABLE platform.nemo_credential
  ADD COLUMN IF NOT EXISTS nemo_target text;

-- Pre-existing rows cannot exist in practice (nothing ever wrote this table),
-- but a rerun against a populated database must not strand a NULL.
UPDATE platform.nemo_credential SET nemo_target = 'stg' WHERE nemo_target IS NULL;

ALTER TABLE platform.nemo_credential
  ALTER COLUMN nemo_target SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'platform.nemo_credential'::regclass
       AND conname  = 'nemo_credential_target_check'
  ) THEN
    ALTER TABLE platform.nemo_credential
      ADD CONSTRAINT nemo_credential_target_check
      CHECK (nemo_target IN ('stg', 'prd'));
  END IF;
END $$;

-- One live key per org per target; deactivated rows accumulate freely.
CREATE UNIQUE INDEX IF NOT EXISTS nemo_credential_active_uq
  ON platform.nemo_credential (org_id, nemo_target)
  WHERE is_active;
