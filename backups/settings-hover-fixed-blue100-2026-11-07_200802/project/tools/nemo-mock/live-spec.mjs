// The mock's copy of the vendored spec, made at start (dev tool only).
// Live STG rejects `registeredOwnerName` as an unsupported field (spec 0062
// F1), so NEMOLink never sends it — but the vendored spec still lists it as
// required, and Prism then answers every VID with its canned 400 example
// ("ERR-027 etd_before_eta"). The vendored file stays as published
// (invariant 8); only this copy drops the field from `required`.
import { readFileSync, writeFileSync } from 'node:fs';

const spec = JSON.parse(readFileSync('/openapi/declarant.json', 'utf8'));
let dropped = 0;
const walk = (node) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node.required) && node.required.includes('registeredOwnerName')) {
    node.required = node.required.filter((k) => k !== 'registeredOwnerName');
    dropped++;
  }
  for (const v of Object.values(node)) walk(v);
};
walk(spec);

// A CRT carries its files as multipart parts named `attachments`, one per
// file (the standard form, test/nemo-multipart.spec.ts). Prism reads a single
// part as a string, not a one-item array, and refuses the request; here the
// field takes either.
const att = spec.components?.schemas?.FormalityRequestBodyDTO?.properties?.attachments;
if (att) {
  spec.components.schemas.FormalityRequestBodyDTO.properties.attachments = {
    description: att.items?.description,
    anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }, { type: 'null' }],
  };
  console.log('nemo-mock: CRT attachments accepted as one file or many');
}

writeFileSync('/mock/declarant.live.json', JSON.stringify(spec));
console.log(`nemo-mock: registeredOwnerName no longer required (${dropped} place(s))`);
