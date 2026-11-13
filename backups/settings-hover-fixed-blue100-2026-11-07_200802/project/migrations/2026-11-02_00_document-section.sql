-- Ship forms (user 2026-11-02): a file dropped on one form's section — the
-- crew, the stores, the waste… — stays listed under that section. A parsed
-- form already belongs to its table by form type; a PDF or an unread file
-- has nothing else to place it. Idempotent, tenant-aware (docs/specs/0022).
-- Existing documents stay as they were: no section.

SELECT platform.apply_to_tenants($ddl$

  ALTER TABLE port_call_document
    ADD COLUMN IF NOT EXISTS section text;

$ddl$);
