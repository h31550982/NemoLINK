/**
 * A ledger value in words (spec 0090): codes with their names, times in the
 * house stamp. Shared by the ledger and the wizards' "this goes to NEMO"
 * summary (spec 0092), so both read a value the same way.
 */
import { reactive } from 'vue';
import type { LedgerRow } from '../auth/auth';
import { callPurposeName, registryName, voyageTypeName } from '../generated/noa-codes';
import { countryName } from '../generated/countries';
import { shipTypeName } from '../generated/ship-types';
import { fmtStamp } from './time';

export const LANGUAGES = [
  { code: 'FI', name: 'Finnish' },
  { code: 'SV', name: 'Swedish' },
  { code: 'EN', name: 'English' },
];

/** Port names seen in lookups, so a UN/LOCODE reads as its port. */
export const portNames = reactive<Record<string, string | null>>({});
/** Port area and berth names from the port's list, so a code reads as its place. */
export const placeNames = reactive<Record<string, string | null>>({});

export function ledgerWords(r: Pick<LedgerRow, 'kind' | 'codelist'>, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.map((x) => ledgerWords(r, x)).join(', ');
  const s = String(v);
  if (r.kind === 'time') return fmtStamp(s);
  switch (r.codelist) {
    case 'purpose':
      return `${callPurposeName(s)} (${s})`;
    case 'voyage':
      return `${voyageTypeName(s)} (${s})`;
    case 'country':
      return `${countryName(s)} (${s})`;
    case 'registry':
      return `${registryName(s)} (${s})`;
    case 'shipType':
      return `${shipTypeName(s)} (${s})`;
    case 'locode':
      return portNames[s] ? `${portNames[s]} (${s})` : s;
    case 'portArea':
    case 'berth':
      return placeNames[s] ? `${placeNames[s]} (${s})` : s;
    case 'language':
      return `${LANGUAGES.find((l) => l.code === s)?.name ?? s} (${s})`;
    default:
      return s;
  }
}
