#!/usr/bin/env node
/**
 * Generates app/src/generated/noa-codes.ts from the vendored national
 * codelists the NOA wizard picks from (docs/specs/0088): purposes of call
 * (UN/EDIFACT 8025, DE-014-10), voyage types (DE-014-22) and ship registries
 * (annex V of 2009/42/EC, DE-005-10). Parked entries are left out.
 * Committed output — rerun after a vendor refresh:  node tools/gen-noa-codes.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'vendor', 'national-spreadsheet', 'codelists');
const out = path.join(root, 'app', 'src', 'generated', 'noa-codes.ts');

function entries(file) {
  const list = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).entries;
  if (!Array.isArray(list) || list.length === 0) throw new Error(`${file}: unexpected shape`);
  return list.filter((e) => !e.parked && typeof e.id === 'string' && e.id);
}

const rows = (list) =>
  list.map((e) => `  { code: ${JSON.stringify(e.id)}, name: ${JSON.stringify(e.en ?? e.id)} },`).join('\n');

const purposes = entries('un_edifact_8025.json');
const voyages = entries('voyage_type.json');
const registries = entries('annex_v_of_2009_42_ec.json');

const body = `/**
 * GENERATED FILE — do not edit. Source of truth:
 * vendor/national-spreadsheet/codelists/un_edifact_8025.json (purpose of call)
 * vendor/national-spreadsheet/codelists/voyage_type.json (type of voyage)
 * vendor/national-spreadsheet/codelists/annex_v_of_2009_42_ec.json (ship registry)
 * Regenerate: node tools/gen-noa-codes.js  (docs/specs/0088)
 */

export interface NoaCode {
  code: string;
  name: string;
}

/** DE-014-10 — primary purpose of call. */
export const CALL_PURPOSES: NoaCode[] = [
${rows(purposes)}
];

/** DE-014-22 — type of voyage. */
export const VOYAGE_TYPES: NoaCode[] = [
${rows(voyages)}
];

/** DE-005-10 — ship registry. */
export const SHIP_REGISTRIES: NoaCode[] = [
${rows(registries)}
];

function nameIn(list: NoaCode[], code: string | null | undefined): string {
  if (!code) return '';
  return list.find((c) => c.code === code)?.name ?? code;
}

export const callPurposeName = (code: string | null | undefined): string => nameIn(CALL_PURPOSES, code);
export const voyageTypeName = (code: string | null | undefined): string => nameIn(VOYAGE_TYPES, code);
export const registryName = (code: string | null | undefined): string => nameIn(SHIP_REGISTRIES, code);
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, body);
console.log(`wrote ${out} (${purposes.length} purposes, ${voyages.length} voyage types, ${registries.length} registries)`);
