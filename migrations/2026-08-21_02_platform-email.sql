-- Migration: 2026-08-21_platform-email
-- Idempotent — safe to rerun. Spec: docs/specs/0003-notify-email-events.md
-- Adds platform.email_message + platform.email_suppression, and widens the
-- email_message status lifecycle with 'failed' (SES Reject / terminal send
-- failure) in both the platform table and the tenant template.

CREATE TABLE IF NOT EXISTS platform.email_message (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient            text NOT NULL,
  template             text,
  subject              text,
  ses_message_id       text,
  status               text NOT NULL DEFAULT 'queued' CHECK (status IN
                         ('queued', 'sent', 'delivered', 'bounced', 'complained',
                          'failed')),
  related_entity_type  text,
  related_entity_id    text,
  data                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  author               text,
  created              timestamptz NOT NULL DEFAULT now(),
  updated              timestamptz NOT NULL DEFAULT now(),
  is_active            boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS email_message_ses_id_idx
  ON platform.email_message (ses_message_id);

-- Hard bounces / complaints / manual blocks: never mail these again
-- (docs/08-security.md — protects shared-account SES reputation too)
CREATE TABLE IF NOT EXISTS platform.email_suppression (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address    text NOT NULL,
  reason     text NOT NULL CHECK (reason IN ('bounce', 'complaint', 'manual')),
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  author     text,
  created    timestamptz NOT NULL DEFAULT now(),
  updated    timestamptz NOT NULL DEFAULT now(),
  is_active  boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS email_suppression_address_active_uq
  ON platform.email_suppression (lower(address)) WHERE is_active;

-- Tenant tables: widen the status lifecycle with 'failed'.
-- Retrofitted tenant-aware (docs/specs/0022): originally altered org_template
-- only — safe at the time (no tenants existed yet; provisioning instantiates
-- from schema.sql), but the whole history must now replay green with a
-- day-one tenant present (CI gate). Self-contained DO block: this file
-- predates platform.apply_to_tenants in replay order. Same end state
-- everywhere; idempotent.
DO $$
DECLARE s text;
BEGIN
  FOR s IN
    SELECT x FROM unnest(
      ARRAY['org_template'] ||
      ARRAY(SELECT schema_name FROM platform.organization
             WHERE is_active ORDER BY schema_name)
    ) AS t(x)
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.email_message DROP CONSTRAINT IF EXISTS email_message_status_check', s);
    EXECUTE format(
      'ALTER TABLE %I.email_message ADD CONSTRAINT email_message_status_check CHECK (status IN
         (''queued'', ''sent'', ''delivered'', ''bounced'', ''complained'', ''failed''))', s);
  END LOOP;
END $$;
