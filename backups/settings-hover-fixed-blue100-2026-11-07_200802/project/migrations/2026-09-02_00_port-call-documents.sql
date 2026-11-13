-- 0049 — port-call documents: the ingest staging store made real.
-- Idempotent, tenant-aware (docs/specs/0022): unqualified DDL replayed
-- into org_template + every active org schema.
--
-- Raw uploaded ship forms (NSW/FAL Excel, PDFs), immutable bytes plus the
-- classification and parsed extraction. PII (crew/passenger rows) lives in
-- `parsed` inside the tenant schema and nowhere else; `summary` is the
-- list-safe non-PII view. Nothing here ever writes the port-call spine.

SELECT platform.apply_to_tenants($ddl$

  CREATE TABLE IF NOT EXISTS port_call_document (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    port_call_id  uuid NOT NULL REFERENCES port_call(id),
    file_name     text NOT NULL,
    content_type  text NOT NULL,            -- xls | xlsx | pdf (sniffed, not the sent mime)
    byte_size     integer NOT NULL,
    sha256        text NOT NULL,
    content       bytea NOT NULL,           -- raw, immutable (staging store)
    form_type     text,                     -- nsw-crew | nsw-pax | nsw-security | nsw-waste | nmsw-mdh | fal1..fal7
    context       text,                     -- arrival | departure | both (the form's own X boxes)
    parse_status  text NOT NULL CHECK (parse_status IN
                    ('parsed', 'pdf', 'unrecognized', 'failed')),
    parse_note    text,
    parsed        jsonb,                    -- fields + rows + grid; PII stays here
    summary       jsonb,                    -- list-safe, no PII
    uploaded_by   text NOT NULL,
    created       timestamptz NOT NULL DEFAULT now(),
    is_active     boolean NOT NULL DEFAULT true
  );
  CREATE INDEX IF NOT EXISTS port_call_document_call_idx
    ON port_call_document (port_call_id);
  CREATE UNIQUE INDEX IF NOT EXISTS port_call_document_dedupe_uq
    ON port_call_document (port_call_id, sha256) WHERE is_active;

$ddl$);
