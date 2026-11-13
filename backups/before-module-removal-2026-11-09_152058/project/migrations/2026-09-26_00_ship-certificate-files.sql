-- 2026-09-26_00_ship-certificate-files — the certificate files each
-- organisation keeps for the ships of its fleet (docs/specs/0084). NEMO's CRT
-- carries a certificate with its files (pdf, xml, jpg, png; max 10 MB each,
-- a description each). The details are shared master data (spec 0020); the
-- copies are the org's own. Bytes live in the files bucket (storage = s3,
-- storage_key) — in the row only where no bucket is configured (dev: db).
-- A certificate may carry several files (the CL certificate and its annex).
-- Idempotent.

SELECT platform.apply_to_tenants($ddl$
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
$ddl$);
