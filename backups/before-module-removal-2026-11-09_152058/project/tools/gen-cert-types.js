#!/usr/bin/env node
/**
 * Generates app/src/generated/certificate-types.ts from the vendored
 * certificate_type codelist (docs/specs/0020), with FI-preferred flags
 * from the hub codelists page (docs/specs/0043 ordering rule). Committed
 * output — rerun after a vendor refresh:  node tools/gen-cert-types.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'vendor', 'national-spreadsheet', 'codelists', 'certificate_type.json');
const hubSrc = path.join(root, 'vendor', 'nemo', 'hub', 'codelists.json');
const out = path.join(root, 'app', 'src', 'generated', 'certificate-types.ts');

const entries = JSON.parse(fs.readFileSync(src, 'utf8')).entries;
if (!Array.isArray(entries) || entries.length === 0) {
  throw new Error('certificate_type.json: unexpected shape');
}
const hub = JSON.parse(fs.readFileSync(hubSrc, 'utf8'));
const hubList = hub.lists.find((l) => l.name === 'certificate_type');
if (!hubList) throw new Error('hub codelists: certificate_type missing');
const preferred = new Set(hubList.entries.filter((e) => e.fiPreferred).map((e) => e.id));

const rows = entries
  .map(
    (e) =>
      `  { code: ${JSON.stringify(e.id)}, name: ${JSON.stringify(e.en)}, fiPreferred: ${preferred.has(e.id)} },`,
  )
  .join('\n');

const body = `/**
 * GENERATED FILE — do not edit. Source of truth:
 * vendor/national-spreadsheet/codelists/certificate_type.json
 * vendor/nemo/hub/codelists.json (certificate_type fiPreferred flags)
 * Regenerate: node tools/gen-cert-types.js  (docs/specs/0020)
 */

export interface CertificateType {
  code: string;
  name: string;
  /** Most commonly used in the Finnish implementation (hub flag). */
  fiPreferred: boolean;
}

export const CERTIFICATE_TYPES: CertificateType[] = [
${rows}
];

const BY_CODE = new Map(CERTIFICATE_TYPES.map((t) => [t.code, t.name]));

/** Vendored EN name for a code; falls back to the raw code. */
export function certificateName(code: string): string {
  return BY_CODE.get(code) ?? code;
}
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, body);
console.log(`wrote ${out} (${entries.length} certificate types, ${preferred.size} FI-preferred)`);
