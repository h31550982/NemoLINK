#!/usr/bin/env node
/**
 * Generates app/src/generated/certificate-issuers.ts from the vendored
 * certificate issuer codelist (DE-006-08, C-CRT-002; docs/specs/0084), and
 * keeps only codes the vendored CRT MIG schema accepts. Run from nemolink/:
 *   node tools/gen-cert-issuers.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const list = require(path.join(ROOT, 'vendor/national-spreadsheet/codelists/certificate_issuer.json'));
const src = fs.readFileSync(path.join(ROOT, 'server/src/nemo-client/generated/mig-schemas.ts'), 'utf8');
const crt = JSON.parse(src.match(/"CRT": (\{.*\}),?\n/)[1]);
const allowed = new Set(crt.$defs['qdt:CertificateIssuerIDType_2'].enum);

const rows = list.entries
  .filter((e) => allowed.has(e.id))
  .map((e) => `  { code: ${JSON.stringify(e.id)}, name: ${JSON.stringify(e.en)} },`);

const out = `/**
 * GENERATED FILE — do not edit. Source of truth:
 * vendor/national-spreadsheet/codelists/certificate_issuer.json, filtered to the
 * codes the vendored CRT MIG schema accepts (qdt:CertificateIssuerIDType_2).
 * Regenerate: node tools/gen-cert-issuers.js  (docs/specs/0084)
 */

export interface CertificateIssuer {
  code: string;
  name: string;
}

export const CERTIFICATE_ISSUERS: CertificateIssuer[] = [
${rows.join('\n')}
];

export function certificateIssuerName(code: string | null | undefined): string {
  if (!code) return '';
  return CERTIFICATE_ISSUERS.find((i) => i.code === code)?.name ?? code;
}

/** Issuer types (emsw.fi; C-CRT-002/004): what identifies the issuer for each. */
export const ISSUER_TYPES: { code: string; name: string; needs: 'country' | 'id' | 'name' }[] = [
  { code: '01', name: 'Flag state', needs: 'country' },
  { code: '02', name: 'Classification society', needs: 'id' },
  { code: '03', name: 'Recognized organization', needs: 'id' },
  { code: '04', name: 'Recognized security organization', needs: 'id' },
  { code: '05', name: 'Notified body', needs: 'name' },
  { code: '06', name: 'Insurance company', needs: 'name' },
  { code: '99', name: 'Other', needs: 'name' },
];
`;
fs.writeFileSync(path.join(ROOT, 'app/src/generated/certificate-issuers.ts'), out);
console.log(`certificate-issuers.ts: ${rows.length} issuers`);
