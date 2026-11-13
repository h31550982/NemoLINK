-- Migration: 2026-08-21_base-schema
-- Idempotent — safe to rerun. Spec: docs/specs/0002-db-base-schema.md
-- Adds the platform tables and the tenant template schema org_template.
-- (Extensions + platform schema itself: 2026-08-21_init.sql)
-- No org_<slug> schemas exist yet, so no tenant-registry iteration is needed.

CREATE TABLE IF NOT EXISTS platform.organization (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9_]*$'),
  name         text NOT NULL,
  business_id  text,
  eori         text,
  schema_name  text NOT NULL UNIQUE,
  auth_config  jsonb,
  author       text,
  source       text,
  created      timestamptz NOT NULL DEFAULT now(),
  updated      timestamptz NOT NULL DEFAULT now(),
  is_active    boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS platform.nemo_credential (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES platform.organization(id),
  label       text,
  ciphertext  bytea NOT NULL,
  key_id      text NOT NULL,
  author      text,
  created     timestamptz NOT NULL DEFAULT now(),
  updated     timestamptz NOT NULL DEFAULT now(),
  is_active   boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS platform.location (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  locode        text NOT NULL,
  name          text,
  country_code  text,
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  author        text,
  source        text,
  created       timestamptz NOT NULL DEFAULT now(),
  updated       timestamptz NOT NULL DEFAULT now(),
  is_active     boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS location_locode_active_uq
  ON platform.location (locode) WHERE is_active;

CREATE TABLE IF NOT EXISTS platform.codelist_entry (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codelist  text NOT NULL,
  version   text NOT NULL,
  code      text NOT NULL,
  en        text,
  fi        text,
  sv        text,
  national  boolean NOT NULL DEFAULT false,
  data      jsonb NOT NULL DEFAULT '{}'::jsonb,
  author    text,
  source    text,
  created   timestamptz NOT NULL DEFAULT now(),
  updated   timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (codelist, version, code)
);

CREATE TABLE IF NOT EXISTS platform.audit_event (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq          bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  category     text NOT NULL CHECK (category IN ('access', 'content', 'email')),
  actor_id     text,
  entity_type  text,
  entity_id    text,
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash    text,
  event_hash   text NOT NULL,
  created      timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Tenant template (unqualified names + FKs on purpose — see schema.sql header)
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS org_template;
SET search_path = org_template;

CREATE TABLE IF NOT EXISTS vessel (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  imo_number  text,
  mmsi        text,
  call_sign   text,
  name        text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  author      text,
  source      text,
  created     timestamptz NOT NULL DEFAULT now(),
  updated     timestamptz NOT NULL DEFAULT now(),
  is_active   boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS vessel_imo_active_uq
  ON vessel (imo_number) WHERE imo_number IS NOT NULL AND is_active;

CREATE TABLE IF NOT EXISTS port_call (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id    uuid REFERENCES vessel(id),
  visit_id     text,
  port_locode  text,
  eta          timestamptz,
  etd          timestamptz,
  status       text,
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,
  author       text,
  source       text,
  created      timestamptz NOT NULL DEFAULT now(),
  updated      timestamptz NOT NULL DEFAULT now(),
  is_active    boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS port_call_visit_active_uq
  ON port_call (visit_id) WHERE visit_id IS NOT NULL AND is_active;

CREATE TABLE IF NOT EXISTS declaration (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  port_call_id       uuid NOT NULL REFERENCES port_call(id),
  formality_type     text NOT NULL,
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN
                       ('draft', 'ready', 'queued', 'submitted', 'accepted',
                        'rejected', 'superseded', 'withdrawn')),
  lrn                text,
  nemo_formality_id  text,
  resolved_cache     jsonb,
  missing_count      integer,
  check_count        integer,
  author             text,
  created            timestamptz NOT NULL DEFAULT now(),
  updated            timestamptz NOT NULL DEFAULT now(),
  is_active          boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS declaration_port_call_idx
  ON declaration (port_call_id);

CREATE TABLE IF NOT EXISTS source_record (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system  text NOT NULL,
  channel        text NOT NULL,
  payload        jsonb NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  created        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lane_data (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  declaration_id    uuid NOT NULL REFERENCES declaration(id),
  lane              text NOT NULL CHECK (lane IN ('plan', 'log', 'ship', 'operator')),
  version           integer NOT NULL,
  data              jsonb NOT NULL,
  source_system     text,
  channel           text,
  source_record_id  uuid REFERENCES source_record(id),
  received_at       timestamptz,
  author            text,
  created           timestamptz NOT NULL DEFAULT now(),
  is_active         boolean NOT NULL DEFAULT true,
  UNIQUE (declaration_id, lane, version)
);
CREATE INDEX IF NOT EXISTS lane_data_active_idx
  ON lane_data (declaration_id, lane) WHERE is_active;

CREATE TABLE IF NOT EXISTS field_resolution (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  declaration_id  uuid NOT NULL REFERENCES declaration(id),
  field_path      text NOT NULL,
  resolved_lane   text NOT NULL CHECK (resolved_lane IN ('plan', 'log', 'ship', 'operator')),
  author          text,
  created         timestamptz NOT NULL DEFAULT now(),
  is_active       boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS field_resolution_active_uq
  ON field_resolution (declaration_id, field_path) WHERE is_active;

CREATE TABLE IF NOT EXISTS submission (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  declaration_id  uuid NOT NULL REFERENCES declaration(id),
  revision        integer NOT NULL,
  payload         jsonb NOT NULL,
  response        jsonb,
  nemo_status     text,
  author          text,
  created         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (declaration_id, revision)
);

CREATE TABLE IF NOT EXISTS audit_event (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq          bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  category     text NOT NULL CHECK (category IN ('access', 'content', 'email')),
  actor_id     text,
  entity_type  text,
  entity_id    text,
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash    text,
  event_hash   text NOT NULL,
  created      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mapping_alias (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_text   text NOT NULL,
  code              text NOT NULL,
  codelist          text NOT NULL,
  codelist_version  text,
  use_count         integer NOT NULL DEFAULT 0,
  author            text,
  source            text,
  created           timestamptz NOT NULL DEFAULT now(),
  updated           timestamptz NOT NULL DEFAULT now(),
  is_active         boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS mapping_alias_active_uq
  ON mapping_alias (normalized_text, codelist) WHERE is_active;

CREATE TABLE IF NOT EXISTS email_message (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient            text NOT NULL,
  template             text,
  subject              text,
  ses_message_id       text,
  status               text NOT NULL DEFAULT 'queued' CHECK (status IN
                         ('queued', 'sent', 'delivered', 'bounced', 'complained')),
  related_entity_type  text,
  related_entity_id    text,
  data                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  author               text,
  created              timestamptz NOT NULL DEFAULT now(),
  updated              timestamptz NOT NULL DEFAULT now(),
  is_active            boolean NOT NULL DEFAULT true
);

RESET search_path;
