/**
 * Loader for the vendored hub codelist values (docs/specs/0023):
 * vendor/nemo/hub/codelists.json, produced by tools/nemo-schemas from the
 * hub's codelists page. Authoritative wherever it has content (user decision
 * 2026-08-23); emptyLists records the sections the page publishes without
 * rows — the National Spreadsheet remains the source for those.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface HubCodelistEntry {
  code: string;
  en: string | null;
  fi: string | null;
  sv: string | null;
  fiPreferred: boolean;
}

export interface HubCodelist {
  name: string;
  entries: HubCodelistEntry[];
}

export function loadHubCodelists(vendorDir: string): {
  lists: HubCodelist[];
  emptyLists: string[];
} {
  const raw = JSON.parse(
    readFileSync(join(vendorDir, 'nemo', 'hub', 'codelists.json'), 'utf8'),
  ) as { lists?: unknown; emptyLists?: unknown };
  if (!Array.isArray(raw.lists)) throw new Error('codelists.json: expected a lists array');
  const lists: HubCodelist[] = [];
  for (const l of raw.lists as Record<string, unknown>[]) {
    const name = typeof l.name === 'string' ? l.name : '';
    // List names become API path segments — anything unexpected must surface
    // loudly at sync time, never slip through. (Hub names include uppercase:
    // directive_2009_42_ec_annex_II_1.)
    if (!/^[A-Za-z0-9_]{1,100}$/.test(name)) {
      throw new Error(`codelists.json: unexpected list name '${name}'`);
    }
    if (!Array.isArray(l.entries)) throw new Error(`codelists.json: ${name} has no entries array`);
    const seen = new Set<string>();
    const entries: HubCodelistEntry[] = [];
    for (const e of l.entries as Record<string, unknown>[]) {
      const code = typeof e.id === 'string' ? e.id.trim() : '';
      if (!code || seen.has(code)) continue;
      seen.add(code);
      entries.push({
        code,
        en: typeof e.en === 'string' && e.en ? e.en : null,
        fi: typeof e.fi === 'string' && e.fi ? e.fi : null,
        sv: typeof e.sv === 'string' && e.sv ? e.sv : null,
        fiPreferred: e.fiPreferred === true,
      });
    }
    if (entries.length > 0) lists.push({ name, entries });
  }
  const emptyLists = Array.isArray(raw.emptyLists)
    ? (raw.emptyLists as unknown[]).filter((n): n is string => typeof n === 'string')
    : [];
  return { lists, emptyLists };
}
