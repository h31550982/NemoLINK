/**
 * Loader for the vendored national-spreadsheet codelists (docs/specs/0021).
 * Pure filesystem → data; no DB here. The vendored files are the source of
 * truth (invariant 8 — read-only): {source: {templateVersion}, entries:
 * [{id, en, fi, sv, national}]} per list, one file per codelist.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CodelistEntry {
  code: string;
  en: string | null;
  fi: string | null;
  sv: string | null;
  national: boolean;
}

export interface CodelistFile {
  codelist: string;
  version: string;
  entries: CodelistEntry[];
}

export function loadSpreadsheetCodelists(dir: string): CodelistFile[] {
  const codelistDir = join(dir, 'codelists');
  const files = readdirSync(codelistDir)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .sort();
  const lists: CodelistFile[] = [];
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(codelistDir, file), 'utf8')) as {
      source?: { templateVersion?: string };
      entries?: unknown;
    };
    if (!Array.isArray(raw.entries)) {
      throw new Error(`${file}: expected an entries array`);
    }
    const seen = new Set<string>();
    const entries: CodelistEntry[] = [];
    for (const e of raw.entries as Record<string, unknown>[]) {
      const code = typeof e.id === 'string' ? e.id.trim() : '';
      if (!code || seen.has(code)) continue;
      seen.add(code);
      entries.push({
        code,
        en: typeof e.en === 'string' && e.en ? e.en : null,
        fi: typeof e.fi === 'string' && e.fi ? e.fi : null,
        sv: typeof e.sv === 'string' && e.sv ? e.sv : null,
        national: e.national === true,
      });
    }
    lists.push({
      codelist: file.replace(/\.json$/, ''),
      version: raw.source?.templateVersion ?? 'unknown',
      entries,
    });
  }
  return lists;
}
