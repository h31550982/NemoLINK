/**
 * org_template DDL extraction from schema.sql (docs/specs/0010).
 * Tenant schemas are instantiated from THE schema — never from migrations
 * (docs/02 schema governance). The section is exactly delimited in schema.sql;
 * both markers are mandatory so a reshuffled file can never cause a silent
 * partial replay.
 */

import { readFileSync } from 'node:fs';

const START = 'SET search_path = org_template;';
const END = 'RESET search_path;';

/** Slugs must be safe in an identifier position and not shadow system names. */
const SLUG_RE = /^[a-z][a-z0-9_]*$/;
const RESERVED = new Set(['platform', 'org_template', 'public', 'information_schema']);

export function validateSlug(slug: string): void {
  if (!SLUG_RE.test(slug) || slug.length > 40) {
    throw new Error(
      `Invalid org slug '${slug}' (need ^[a-z][a-z0-9_]*$, max 40 chars)`,
    );
  }
  if (RESERVED.has(slug) || slug.startsWith('pg_')) {
    throw new Error(`Org slug '${slug}' is a reserved name`);
  }
}

/** The unqualified tenant DDL between the org_template markers. */
export function extractTemplateDdl(schemaSql: string): string {
  const start = schemaSql.indexOf(START);
  if (start === -1) {
    throw new Error(`schema.sql: missing template marker '${START}'`);
  }
  const from = start + START.length;
  const end = schemaSql.indexOf(END, from);
  if (end === -1) {
    throw new Error(`schema.sql: missing template end marker '${END}'`);
  }
  const ddl = schemaSql.slice(from, end).trim();
  if (!/CREATE TABLE/i.test(ddl)) {
    throw new Error('schema.sql: org_template section contains no tables');
  }
  return ddl;
}

export function loadTemplateDdl(schemaSqlPath: string): string {
  return extractTemplateDdl(readFileSync(schemaSqlPath, 'utf8'));
}
