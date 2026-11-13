-- Spec 0045 (refines 0043): structured PEC on the captain's account.
-- pec jsonb: NULL = not answered, {"none": true} = no PEC for Finland,
-- else {number, type?, regions?, ports?, validUntil?} (validated at the
-- API; number stays MIG-bounded 1-10 chars there). The flat
-- pec_certificate_number column from _07 folds into it. Idempotent.

ALTER TABLE platform.user_account ADD COLUMN IF NOT EXISTS pec jsonb;

DO $pec$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'platform'
                AND table_name = 'user_account'
                AND column_name = 'pec_certificate_number') THEN
    UPDATE platform.user_account
       SET pec = jsonb_build_object('number', pec_certificate_number)
     WHERE pec IS NULL AND pec_certificate_number IS NOT NULL;
    ALTER TABLE platform.user_account DROP COLUMN pec_certificate_number;
  END IF;
END
$pec$;
