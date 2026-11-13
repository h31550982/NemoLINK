-- ============================================================================
-- nemolink — THE schema. Full latest state, always current.
-- Source of truth per docs/02-architecture.md → Schema governance:
--   * every change = dated idempotent migration in migrations/ PLUS the matching
--     update here, in the same PR — one without the other never merges
--   * new tenant schemas are instantiated from this file, never by replaying
--     migrations
--   * CI diffs migrations-from-empty against this file and fails on drift
--
-- Layout: shared `platform` schema + tenant template `org_template`.
-- Tenant tables are created inside org_template via search_path with UNQUALIFIED
-- names and FKs, so provisioning replays the same DDL with search_path pointed
-- at the new org_<slug> schema. org_template never holds data.
-- Column lists for the tenant core follow docs/03-data-model.md verbatim.
-- ============================================================================

-- Extensions (mapping-memory fuzzy matching needs these later; installed from
-- day one so every environment is identical)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ============================================================================
-- platform — org registry, credential vault, reference data, platform audit
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.organization (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9_]*$'),
  name         text NOT NULL,
  business_id  text,
  eori         text,
  schema_name  text NOT NULL UNIQUE,
  auth_config  jsonb,                      -- {type: oidc|saml|local, ...} — auth spec
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- declarant profile (spec 0038): ram:CarrierAgentTradeParty under vendored NOA spelling
  author       text,
  source       text,
  created      timestamptz NOT NULL DEFAULT now(),
  updated      timestamptz NOT NULL DEFAULT now(),
  is_active    boolean NOT NULL DEFAULT true
);

-- Vault rows only: ciphertext + key id (docs/specs/0059). The customer's own
-- NEMO client_id/client_secret, AES-256-GCM under a master key held outside the
-- DB; key_id names that key so it can be rotated. The organizationBusinessId
-- header is NOT here — it is platform.organization.business_id, the same column
-- the declaration content reads. Rotation is deactivate + insert, never an
-- update in place.
CREATE TABLE IF NOT EXISTS platform.nemo_credential (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES platform.organization(id),
  nemo_target text NOT NULL CONSTRAINT nemo_credential_target_check
                            CHECK (nemo_target IN ('stg', 'prd')),
  label       text,
  ciphertext  bytea NOT NULL,
  key_id      text NOT NULL,
  author      text,
  created     timestamptz NOT NULL DEFAULT now(),
  updated     timestamptz NOT NULL DEFAULT now(),
  is_active   boolean NOT NULL DEFAULT true
);

-- One live key per org per target; deactivated rows accumulate freely.
CREATE UNIQUE INDEX IF NOT EXISTS nemo_credential_active_uq
  ON platform.nemo_credential (org_id, nemo_target)
  WHERE is_active;

-- Per-source scoped service credentials for /api/v1/ingest (docs/specs/0026):
-- org-bound + source-system-bound; only the sha256 of the bearer token is
-- stored (the token itself is printed once at creation and never kept).
CREATE TABLE IF NOT EXISTS platform.ingest_credential (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES platform.organization(id),
  source_system  text NOT NULL CHECK (source_system ~ '^[a-z][a-z0-9_-]*$'),
  label          text,
  token_hash     text NOT NULL UNIQUE,
  last_used      timestamptz,
  author         text,
  created        timestamptz NOT NULL DEFAULT now(),
  updated        timestamptz NOT NULL DEFAULT now(),
  is_active      boolean NOT NULL DEFAULT true,
  may_create_ships boolean NOT NULL DEFAULT false  -- a `ship` envelope may register an unknown IMO (docs/specs/0060)
);

-- Ships — the MASTER LIST, platform data since docs/specs/0067 (ADR 0005),
-- an external source for every organisation since spec 0068: one record per
-- hull, as NEMO's own ship database keeps it. author_org = the org the author
-- acted for (an admin's own org, or the org whose ingest credential pushed) —
-- the audit/ledger mask reads it, ownership it is not; NULL for a hull the
-- Digitraffic sync found. data = the NSD mirror (spec 0036, ADR 0004):
-- shipData/iceClass (Port API spelling), ram:* keys (MIG: certificates,
-- construction, inert gas, main engine), plus our namespaces ingest.<source>
-- (watermarks), lanes (spec 0061; customer systems carry org, plus the
-- platform lanes nsd and digitraffic — spec 0068), nemo (0062/0064) and
-- digitraffic (the last visit seen, 0068). Overrides live in each org's
-- fleet_ship row, never here (0068).
CREATE TABLE IF NOT EXISTS platform.ship (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  imo_number  text,
  mmsi        text,
  call_sign   text,
  name        text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  author      text,
  author_org  text,
  source      text,
  created     timestamptz NOT NULL DEFAULT now(),
  updated     timestamptz NOT NULL DEFAULT now(),
  is_active   boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS ship_imo_active_uq
  ON platform.ship (imo_number) WHERE imo_number IS NOT NULL AND is_active;

-- LOCODE / location reference cache — full worldwide set synced from the
-- hub's published dataset (docs/specs/0027)
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

-- Legacy and superseded ways of naming a place (docs/specs/0056): a code that is
-- not a LOCODE at all, a code the port system no longer operates because the
-- place is a port area of a bigger port, a place renamed while its code stayed,
-- or a code that is valid somewhere else. `relation` decides what may be done
-- with a row: not_a_code / port_area_of / renamed may be substituted,
-- confusable_with may only be suggested. Curated by us and seeded from
-- server/src/refdata/location-aliases.json on the locations sync.
CREATE TABLE IF NOT EXISTS platform.location_alias (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  given_code    text,
  given_name    text,
  relation      text NOT NULL,
  current_code  text,
  note          text NOT NULL,
  evidence      text,
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  author        text,
  source        text,
  created       timestamptz NOT NULL DEFAULT now(),
  updated       timestamptz NOT NULL DEFAULT now(),
  is_active     boolean NOT NULL DEFAULT true,
  CONSTRAINT location_alias_relation_check CHECK (
    relation IN ('not_a_code', 'port_area_of', 'renamed', 'confusable_with')
  ),
  CONSTRAINT location_alias_key_check CHECK (
    given_code IS NOT NULL OR given_name IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS location_alias_key
  ON platform.location_alias (COALESCE(given_code, ''), COALESCE(given_name, ''));

CREATE INDEX IF NOT EXISTS location_alias_given_code
  ON platform.location_alias (given_code) WHERE is_active;

-- Codelist reference cache (docs/specs/0021+0023). Authoritative source is the
-- hub codelists page (version 'hub', fi_preferred flags) wherever it has
-- content; the vendored National Spreadsheet fills the lists the page lacks or
-- publishes empty (version = template version). Superseded source versions of
-- a list are kept with is_active = false.
CREATE TABLE IF NOT EXISTS platform.codelist_entry (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codelist      text NOT NULL,
  version       text NOT NULL,
  code          text NOT NULL,
  en            text,
  fi            text,
  sv            text,
  national      boolean NOT NULL DEFAULT false,
  fi_preferred  boolean NOT NULL DEFAULT false,
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  author        text,
  source        text,
  created       timestamptz NOT NULL DEFAULT now(),
  updated       timestamptz NOT NULL DEFAULT now(),
  is_active     boolean NOT NULL DEFAULT true,
  UNIQUE (codelist, version, code)
);

-- Hazmat reference cache (Fintraffic Hazmat Service sync — docs/specs/0021).
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

-- FI statistics-group → representative-HS mapping (docs/specs/0023) —
-- seeded by the refdata 'hsmap' sync from vendor/nemo/hub/hs-map.json
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

-- GISIS port-facility master list (docs/specs/0053) — uploaded by a platform
-- admin from the IMO GISIS Maritime Security CSV export (no public bulk URL).
-- facility_code = normalized <LOCODE>-<4 digits>; locode/country derived from
-- its prefix. Per-country replace on upload flips is_active in place — no
-- versioning, so the natural key is the primary key.
CREATE TABLE IF NOT EXISTS platform.gisis_port_facility (
  facility_code   text PRIMARY KEY,
  locode          text NOT NULL,
  country         text NOT NULL,
  port_name       text,
  facility_name   text NOT NULL,
  description     text,
  longitude       text,
  latitude        text,
  plan_approved   boolean,
  plan_withdrawn  boolean,
  source_updated  date,
  author          text,
  created         timestamptz NOT NULL DEFAULT now(),
  updated         timestamptz NOT NULL DEFAULT now(),
  is_active       boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS gisis_port_facility_locode_idx
  ON platform.gisis_port_facility (locode);
CREATE INDEX IF NOT EXISTS gisis_port_facility_country_idx
  ON platform.gisis_port_facility (country);

-- Reference-data sync bookkeeping (docs/specs/0021): one row per run.
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

-- Platform-level outbound email (admin alerts etc.) — tenant shape + 'failed'
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

-- Platform-level audit (system-admin actions, provisioning, vault access) —
-- append-only, hash-chained; same shape as the tenant audit_event
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

-- Auth v1 (docs/specs/0011) + SSO approval (docs/specs/0012): platform users
-- (one org each) + opaque sessions. Pending users have no role yet; active
-- users always do (user_account_active_role_check).
CREATE TABLE IF NOT EXISTS platform.user_account (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES platform.organization(id),
  username         text NOT NULL,
  email            text,
  display_name     text,
  auth_type        text NOT NULL CHECK (auth_type IN ('oidc', 'local')),
  -- superadmin = nauticAi platform admin (docs/specs/0030), CLI-granted only
  role             text CONSTRAINT user_account_role_check
                     CHECK (role IN ('superadmin', 'admin', 'editor', 'viewer', 'captain')),
  status           text NOT NULL DEFAULT 'active'
    CONSTRAINT user_account_status_check
    CHECK (status IN ('pending', 'active', 'rejected')),
  ship_id          uuid,                    -- captain scope; platform.ship id (spec 0067), deliberately no FK
  -- Captain's PEC (docs/specs/0043+0045): NULL = not answered,
  -- {"none": true} = no PEC for Finland, else {number, type?, regions?,
  -- ports?, validUntil?} — validated at the API (number = MIG 1-10 chars)
  pec              jsonb,
  oidc_issuer      text,
  oidc_subject     text,
  password_hash    text,                    -- argon2id; local accounts only
  failed_attempts  integer NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  author           text,
  created          timestamptz NOT NULL DEFAULT now(),
  updated          timestamptz NOT NULL DEFAULT now(),
  is_active        boolean NOT NULL DEFAULT true,
  CONSTRAINT user_account_active_role_check
    CHECK (status <> 'active' OR role IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_account_username_key
  ON platform.user_account (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS user_account_oidc_key
  ON platform.user_account (oidc_issuer, oidc_subject)
  WHERE oidc_issuer IS NOT NULL;

CREATE TABLE IF NOT EXISTS platform.session (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash     text NOT NULL UNIQUE,     -- sha256 of the opaque cookie token
  user_id        uuid NOT NULL REFERENCES platform.user_account(id),
  -- the customer a platform admin is acting in (docs/specs/0030); every
  -- switch is audited on the platform chain, context dies with the session
  acting_org_id  uuid REFERENCES platform.organization(id),
  created        timestamptz NOT NULL DEFAULT now(),
  expires        timestamptz NOT NULL,
  last_seen      timestamptz NOT NULL DEFAULT now(),
  is_active      boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS session_user_idx ON platform.session (user_id);

-- Tenant-aware migration helper (docs/specs/0022): applies an unqualified DDL
-- block to org_template AND every active org schema, so a tenant-table
-- migration can never reach the template but miss live tenants.
--   SELECT platform.apply_to_tenants($ddl$ ALTER TABLE ... $ddl$);
CREATE OR REPLACE FUNCTION platform.apply_to_tenants(ddl text)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  s        text;
  original text := current_setting('search_path');
  applied  integer := 0;
BEGIN
  FOR s IN
    SELECT x FROM unnest(
      ARRAY['org_template'] ||
      ARRAY(SELECT schema_name FROM platform.organization
             WHERE is_active ORDER BY schema_name)
    ) AS t(x)
  LOOP
    PERFORM set_config('search_path', s, true);
    EXECUTE ddl;
    applied := applied + 1;
  END LOOP;
  PERFORM set_config('search_path', original, true);
  RETURN applied;
END;
$fn$;

-- ============================================================================
-- org_template — tenant tables (template only, never data)
-- Unqualified names + FKs on purpose: provisioning replays this section with
-- search_path = org_<slug>.
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS org_template;
SET search_path = org_template;

-- Ships live in platform.ship since docs/specs/0067 (ADR 0005): one record
-- per hull shared by every organisation; the tenant keeps only references.

-- Spine columns owned by ingestion (docs/specs/0026): plan facts (eta/etd/
-- port/voyage/cargo) and verified actuals (ata/atd) as real columns —
-- invariant 10 reserves data-JSONB keys for vendored spelling; our
-- bookkeeping namespaces: data.ingest.* (per-lane provenance),
-- data.suggestions (pending ship/log values, spec 0034), data.itinerary
-- {prev, next} (the call's rotation, spec 0037). port_locode is a Finnish
-- LOCODE (spec 0037) — enforced at the API edge, not by constraint.
CREATE TABLE IF NOT EXISTS port_call (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ship_id            uuid REFERENCES platform.ship(id),   -- platform data (spec 0067)
  visit_id           text,                 -- NEMO visit id, e.g. FI20260213-003
  port_locode        text,
  port_area_code     text,                 -- NEMO PortCall.portAreaCode, e.g. FIRAU-BE (spec 0048)
  berth              text,                 -- NEMO PortCall.berth, e.g. FIRAU-BE-BE1 (spec 0048)
  eta                timestamptz,
  etd                timestamptz,
  ata                timestamptz,          -- verified actuals (log lane)
  atd                timestamptz,
  voyage_number      text,
  cargo_description  text,
  status             text,                 -- expected | arrived | departed | cancelled (specs 0026/0034)
  source_call_id     uuid,                 -- the source system's own call UUID (spec 0034)
  data               jsonb NOT NULL DEFAULT '{}'::jsonb,
  author             text,
  source             text,
  created            timestamptz NOT NULL DEFAULT now(),
  updated            timestamptz NOT NULL DEFAULT now(),
  is_active          boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS port_call_visit_active_uq
  ON port_call (visit_id) WHERE visit_id IS NOT NULL AND is_active;
CREATE INDEX IF NOT EXISTS port_call_ship_idx ON port_call (ship_id);
CREATE UNIQUE INDEX IF NOT EXISTS port_call_source_call_uq
  ON port_call (source, source_call_id)
  WHERE source_call_id IS NOT NULL;

-- The organisation's fleet (docs/specs/0068): its shortlist of master-list
-- ships, one active row per ship, carrying THIS org's overrides
-- (data.overrides, the spec 0061 shape) on top of the shared master values.
-- Membership is soft: "remove from fleet" deactivates, history stays.
CREATE TABLE IF NOT EXISTS fleet_ship (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ship_id     uuid NOT NULL REFERENCES platform.ship(id),
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  author      text,
  source      text,
  created     timestamptz NOT NULL DEFAULT now(),
  updated     timestamptz NOT NULL DEFAULT now(),
  is_active   boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS fleet_ship_active_uq
  ON fleet_ship (ship_id) WHERE is_active;

-- The certificate files this org keeps for its ships (docs/specs/0084): the
-- CRT sends them with the certificate. Bytes in the files bucket (s3) or, with
-- no bucket configured, in the row (db). Several files per certificate.
CREATE TABLE IF NOT EXISTS ship_certificate_file (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ship_id       uuid NOT NULL REFERENCES platform.ship(id),
  cert_key      text NOT NULL,
  file_name     text NOT NULL,
  description   text NOT NULL,
  content_type  text NOT NULL,
  byte_size     integer NOT NULL,
  sha256        text NOT NULL,
  storage       text NOT NULL CHECK (storage IN ('s3', 'db')),
  storage_key   text,
  content       bytea,
  uploaded_by   text NOT NULL,
  created       timestamptz NOT NULL DEFAULT now(),
  is_active     boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS ship_certificate_file_cert_idx
  ON ship_certificate_file (ship_id, cert_key) WHERE is_active;

-- Uploaded ship forms (docs/specs/0049): raw bytes immutable (the ingest
-- staging store), classification + parsed extraction. PII (crew/passenger
-- rows) lives in `parsed` inside the tenant schema and nowhere else;
-- `summary` is the list-safe non-PII view. Documents never write the
-- port-call spine; Phase-2 declaration lanes read them via ingestion.
-- Values typed into NEMO's tables where no form had them (spec 0096)
CREATE TABLE IF NOT EXISTS call_form_entry (
  port_call_id  uuid NOT NULL REFERENCES port_call(id),
  table_key     text NOT NULL,
  row_key       text NOT NULL,
  column_key    text NOT NULL,
  value         text NOT NULL,
  author        text NOT NULL,
  updated       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (port_call_id, table_key, row_key, column_key)
);

CREATE TABLE IF NOT EXISTS port_call_document (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  port_call_id  uuid NOT NULL REFERENCES port_call(id),
  file_name     text NOT NULL,
  content_type  text NOT NULL,            -- xls | xlsx | pdf (sniffed, not the sent mime)
  byte_size     integer NOT NULL,
  sha256        text NOT NULL,
  content       bytea NOT NULL,           -- raw bytes; emptied when a newer version supersedes the row (spec 0050)
  form_type     text,                     -- nsw-crew | nsw-pax | nsw-security | nsw-waste | nmsw-mdh | fal1..fal7
  context       text,                     -- arrival | departure | both (the form's own X boxes)
  parse_status  text NOT NULL CHECK (parse_status IN
                  ('parsed', 'pdf', 'unrecognized', 'failed')),
  parse_note    text,
  parsed        jsonb,                    -- fields + rows + grid; PII stays here
  corrections   jsonb,                    -- operator overlay {path: {value, author, at}} — parsed stays verbatim (spec 0051)
  ship_confirm_needed boolean NOT NULL DEFAULT false, -- no IMO in the file: counts once confirmed (spec 0093 D4)
  ship_confirmed_by text,
  ship_confirmed_at timestamptz,
  section       text,                     -- the Ship forms section it was dropped on: crew | passengers | stores | waste | security | health
  summary       jsonb,                    -- list-safe, no PII
  uploaded_by   text NOT NULL,
  created       timestamptz NOT NULL DEFAULT now(),
  is_active     boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS port_call_document_call_idx
  ON port_call_document (port_call_id);
CREATE UNIQUE INDEX IF NOT EXISTS port_call_document_dedupe_uq
  ON port_call_document (port_call_id, sha256) WHERE is_active;

CREATE TABLE IF NOT EXISTS declaration (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  port_call_id       uuid NOT NULL REFERENCES port_call(id),
  formality_type     text NOT NULL,        -- NOA, NOD, CWA, ... (API type codes)
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN
                       ('draft', 'ready', 'queued', 'submitted', 'accepted',
                        'rejected', 'superseded', 'withdrawn')),
  lrn                text,
  nemo_formality_id  text,
  resolved_cache     jsonb,                -- rebuildable cache, never truth
  missing_count      integer,              -- UI badges
  check_count        integer,
  author             text,
  created            timestamptz NOT NULL DEFAULT now(),
  updated            timestamptz NOT NULL DEFAULT now(),
  is_active          boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS declaration_port_call_idx
  ON declaration (port_call_id);

-- Raw ingested payloads — the archive behind the lanes. Append-only.
CREATE TABLE IF NOT EXISTS source_record (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system  text NOT NULL,
  channel        text NOT NULL,            -- api | excel | ui | ocr ...
  event_id       text,                     -- envelope dedupe key (spec 0026)
  payload        jsonb NOT NULL,
  outcome        text,                     -- what ingestion did with it (spec 0034)
  received_at    timestamptz NOT NULL DEFAULT now(),
  created        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS source_record_source_event_uq
  ON source_record (source_system, event_id) WHERE event_id IS NOT NULL;

-- One MIG-shaped JSONB document per (declaration, lane); append-only versions.
-- Lanes are extensible — widening the CHECK is a conscious migration.
CREATE TABLE IF NOT EXISTS lane_data (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  declaration_id    uuid NOT NULL REFERENCES declaration(id),
  lane              text NOT NULL CHECK (lane IN ('plan', 'log', 'ship', 'operator')),
  version           integer NOT NULL,
  data              jsonb NOT NULL,        -- MIG-shaped, converted values (keys: MIG spelling)
  source_system     text,
  channel           text,
  source_record_id  uuid REFERENCES source_record(id),
  received_at       timestamptz,
  author            text,
  created           timestamptz NOT NULL DEFAULT now(),
  is_active         boolean NOT NULL DEFAULT true,   -- current version per (declaration, lane)
  UNIQUE (declaration_id, lane, version)
);
CREATE INDEX IF NOT EXISTS lane_data_active_idx
  ON lane_data (declaration_id, lane) WHERE is_active;

-- Sparse: rows exist only where an operator explicitly acted
CREATE TABLE IF NOT EXISTS field_resolution (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  declaration_id  uuid NOT NULL REFERENCES declaration(id),
  field_path      text NOT NULL,           -- JSON pointer, e.g. '/crewMembers'
  resolved_lane   text NOT NULL CHECK (resolved_lane IN ('plan', 'log', 'ship', 'operator')),
  author          text,
  created         timestamptz NOT NULL DEFAULT now(),
  is_active       boolean NOT NULL DEFAULT true     -- history = is_active=false
);
CREATE UNIQUE INDEX IF NOT EXISTS field_resolution_active_uq
  ON field_resolution (declaration_id, field_path) WHERE is_active;

-- Frozen submitted revisions. Append-only.
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

-- Append-only, hash-chained; app role gets no update/delete grants (audit spec)
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

-- Mapping memory: learned text→code pairs (org scope; shared pool is open q #18)
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
                         ('queued', 'sent', 'delivered', 'bounced', 'complained',
                          'failed')),
  related_entity_type  text,               -- e.g. declaration, exception
  related_entity_id    text,
  data                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  author               text,
  created              timestamptz NOT NULL DEFAULT now(),
  updated              timestamptz NOT NULL DEFAULT now(),
  is_active            boolean NOT NULL DEFAULT true
);

RESET search_path;
