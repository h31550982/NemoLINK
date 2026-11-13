-- 0096 — values typed into NEMO's tables where no ship form had them (a
-- passport's expiry, the issuing nation, the CSO's phone): one row per cell,
-- per port call. An entered value wins over the forms (0086); removing it
-- falls back to them. Never written into the ship's own file (decision 2).
-- row_key: the person key for crew, the waste code, the sequence number,
-- `_` for a table's header fields. Idempotent, tenant-aware (spec 0022).

SELECT platform.apply_to_tenants($ddl$
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
$ddl$);
