-- Spec 0030 — platform admin: superadmin role + per-session customer context.
-- Platform tables only (no tenant DDL). Idempotent.

-- Widen the role vocabulary: 'superadmin' = nauticAi platform admin,
-- granted only via the create-user CLI (never through the approval UI).
-- Guarded since 2026-08-23_07 (spec 0043 renamed 'crew' to 'captain'): on a
-- replayed live DB captain rows exist and would fail this historical CHECK,
-- so it only applies pre-rename; _07 sets the final constraint.
-- From-empty behavior unchanged — the schema-sync gate proves equivalence.
DO $pa$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform.user_account WHERE role = 'captain') THEN
    ALTER TABLE platform.user_account
      DROP CONSTRAINT IF EXISTS user_account_role_check;
    ALTER TABLE platform.user_account
      ADD CONSTRAINT user_account_role_check
      CHECK (role IN ('superadmin', 'admin', 'editor', 'viewer', 'crew'));
  END IF;
END
$pa$;

-- The customer a platform admin is currently acting in — session-scoped,
-- cleared with the session; every switch is audited on the platform chain.
ALTER TABLE platform.session
  ADD COLUMN IF NOT EXISTS acting_org_id uuid REFERENCES platform.organization(id);
