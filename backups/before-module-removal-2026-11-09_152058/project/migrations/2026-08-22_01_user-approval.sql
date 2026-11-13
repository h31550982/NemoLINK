-- Migration: 2026-08-22_01_user-approval
-- Idempotent — safe to rerun. Matches schema.sql as of this date.
-- SSO self-signup + admin approval (docs/specs/0012): user_account.status,
-- role nullable (pending users have none), active users must carry a role.

ALTER TABLE platform.user_account
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CONSTRAINT user_account_status_check
    CHECK (status IN ('pending', 'active', 'rejected'));

ALTER TABLE platform.user_account ALTER COLUMN role DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_account_active_role_check'
  ) THEN
    ALTER TABLE platform.user_account
      ADD CONSTRAINT user_account_active_role_check
      CHECK (status <> 'active' OR role IS NOT NULL);
  END IF;
END $$;
