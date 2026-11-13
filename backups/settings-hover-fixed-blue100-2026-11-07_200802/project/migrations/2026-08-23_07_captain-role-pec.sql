-- Spec 0043: the ship user type is "captain" (was 'crew'), and captains
-- carry their Pilotage Exemption Certificate number (DE-083-02; the MIG
-- bounds ram:PilotExemptionCertificate ram:ID at 1-10 chars).
-- Platform-only DDL; idempotent (drop+re-add converges, updates match 0
-- rows on rerun).

ALTER TABLE platform.user_account DROP CONSTRAINT IF EXISTS user_account_role_check;
UPDATE platform.user_account SET role = 'captain' WHERE role = 'crew';
ALTER TABLE platform.user_account ADD CONSTRAINT user_account_role_check
  CHECK (role IN ('superadmin', 'admin', 'editor', 'viewer', 'captain'));

ALTER TABLE platform.user_account ADD COLUMN IF NOT EXISTS pec_certificate_number text
  CONSTRAINT user_account_pec_check
  CHECK (pec_certificate_number IS NULL
     OR char_length(pec_certificate_number) BETWEEN 1 AND 10);
