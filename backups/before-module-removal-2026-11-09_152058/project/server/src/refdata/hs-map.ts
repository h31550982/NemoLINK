/**
 * Loader for the vendored FI statistics-group → representative-HS mapping
 * (docs/specs/0023): vendor/nemo/hub/hs-map.json, produced by
 * tools/nemo-schemas from the hub's hs-map page. Pure filesystem → data.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface HsMapEntry {
  groupCode: string;
  groupLabel: string | null;
  refinement: string;
  hsPrinted: string | null;
  hs6: string;
}

export function loadHsMap(vendorDir: string): HsMapEntry[] {
  const raw = JSON.parse(
    readFileSync(join(vendorDir, 'nemo', 'hub', 'hs-map.json'), 'utf8'),
  ) as { entries?: unknown };
  if (!Array.isArray(raw.entries)) {
    throw new Error('hs-map.json: expected an entries array');
  }
  const seen = new Set<string>();
  const entries: HsMapEntry[] = [];
  for (const e of raw.entries as Record<string, unknown>[]) {
    const groupCode = typeof e.groupCode === 'string' ? e.groupCode.trim() : '';
    const refinement = typeof e.refinement === 'string' ? e.refinement.trim() : '';
    const hs6 = typeof e.hs6 === 'string' ? e.hs6 : '';
    if (!groupCode || !refinement) {
      throw new Error('hs-map.json: entry missing groupCode/refinement');
    }
    if (!/^\d{6}$/.test(hs6)) {
      throw new Error(`hs-map.json: bad hs6 '${hs6}' (${groupCode}/${refinement})`);
    }
    const key = `${groupCode}\t${refinement}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      groupCode,
      groupLabel: typeof e.groupLabel === 'string' && e.groupLabel ? e.groupLabel : null,
      refinement,
      hsPrinted: typeof e.hsPrinted === 'string' && e.hsPrinted ? e.hsPrinted : null,
      hs6,
    });
  }
  return entries;
}
