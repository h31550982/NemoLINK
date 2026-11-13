#!/usr/bin/env node
/**
 * Generates the ship master-data reference modules (docs/specs/0036) from
 * the vendored contracts — committed output, rerun after a vendor refresh:
 *   node tools/gen-ship-refs.js
 *
 *  - server/src/canonical/generated/ship-type-codes.ts
 *      valid ship type codes = the Port API ShipData.typeCode enum
 *      (vendor/nemo/openapi/port.json)
 *  - app/src/generated/ship-types.ts
 *      the same codes with EN names from the vendored UNECE Rec 28 codelist
 *  - app/src/generated/ice-classes.ts
 *      MIG SHP qdt:ICEClassCodeContentType codes with names from the
 *      vendored ice_class codelist
 *  - app/src/generated/navigation-types.ts
 *      MIG SHP qdt:TypeOfNavigationCodeContentType codes with names from
 *      the hub type_of_navigation codelist
 *  - app/src/generated/countries.ts
 *      ISO 3166-1 alpha-2 codes/names from the vendored codelist, Finland
 *      pinned first (docs/specs/0041 — FI-first country selects)
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

const banner = (sources, spec) => `/**
 * GENERATED FILE — do not edit. Source of truth:
${sources.map((s) => ` * ${s}`).join('\n')}
 * Regenerate: node tools/gen-ship-refs.js  (docs/specs/${spec})
 */
`;

// ---- vessel type codes (Port API ShipData.typeCode enum) -------------------

const port = read('vendor/nemo/openapi/port.json');
const typeCodes = port.components.schemas.ShipData.properties.typeCode.enum.filter(
  (v) => typeof v === 'string',
);
if (typeCodes.length === 0) throw new Error('port.json: ShipData.typeCode enum missing');

fs.mkdirSync(path.join(root, 'server', 'src', 'canonical', 'generated'), {
  recursive: true,
});
fs.writeFileSync(
  path.join(root, 'server', 'src', 'canonical', 'generated', 'ship-type-codes.ts'),
  banner(['vendor/nemo/openapi/port.json (ShipData.typeCode enum)'], '0036') +
    `
/** UNECE Rec 28 ship type codes accepted by the NSD ship model. */
export const SHIP_TYPE_CODES: ReadonlySet<string> = new Set(
  ${JSON.stringify(typeCodes)},
);
`,
);

// ---- app pickers -----------------------------------------------------------

const rec28 = read('vendor/national-spreadsheet/codelists/un_ece_recommendation_28.json');
// The vendored codelist collapses some blocks into one range entry (e.g.
// "821–839" = pushtow combinations); the Port API enum lists each code
// individually. Expanding a range is mechanical — the entry's own id declares
// its coverage — so every code in it gets the vendored name verbatim.
// Codes named nowhere in vendored material (852–855, open question 7c) fall
// back to the bare code; the UI collapses "code (code)" labels to the code.
const rec28Names = new Map();
for (const e of rec28.entries) {
  const range = /^(\d+)[–-](\d+)$/.exec(e.id);
  if (range && range[1].length === range[2].length) {
    for (let c = Number(range[1]); c <= Number(range[2]); c++) {
      rec28Names.set(String(c), e.en);
    }
  } else {
    rec28Names.set(e.id, e.en);
  }
}
const typeRows = typeCodes
  .map(
    (c) =>
      `  { code: ${JSON.stringify(c)}, name: ${JSON.stringify(rec28Names.get(c) ?? c)} },`,
  )
  .join('\n');

fs.mkdirSync(path.join(root, 'app', 'src', 'generated'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'app', 'src', 'generated', 'ship-types.ts'),
  banner(
    [
      'vendor/nemo/openapi/port.json (ShipData.typeCode enum)',
      'vendor/national-spreadsheet/codelists/un_ece_recommendation_28.json (names)',
    ],
    '0036',
  ) +
    `
export interface ShipType {
  code: string;
  name: string;
}

export const SHIP_TYPES: ShipType[] = [
${typeRows}
];

const BY_CODE = new Map(SHIP_TYPES.map((t) => [t.code, t.name]));

/** Vendored EN name for a code; falls back to the raw code. */
export function shipTypeName(code: string): string {
  return BY_CODE.get(code) ?? code;
}
`,
);

// ---- ice classes -----------------------------------------------------------

const shp = read('vendor/nemo/mig/2.0.1.0/SHP_2.0.1.0.json');
const iceCodes = shp.$defs['qdt:ICEClassCodeContentType'].enum;
if (!Array.isArray(iceCodes) || iceCodes.length === 0) {
  throw new Error('SHP schema: ICE class enum missing');
}
const iceList = read('vendor/national-spreadsheet/codelists/ice_class.json');
const iceNames = new Map(iceList.entries.map((e) => [e.id, e.en]));
iceNames.set('UKN', iceNames.get('UKN') ?? 'Unknown');
const iceRows = iceCodes
  .map(
    (c) =>
      `  { code: ${JSON.stringify(c)}, name: ${JSON.stringify(iceNames.get(c) ?? c)} },`,
  )
  .join('\n');

fs.writeFileSync(
  path.join(root, 'app', 'src', 'generated', 'ice-classes.ts'),
  banner(
    [
      'vendor/nemo/mig/2.0.1.0/SHP_2.0.1.0.json (qdt:ICEClassCodeContentType)',
      'vendor/national-spreadsheet/codelists/ice_class.json (names)',
    ],
    '0036',
  ) +
    `
export interface IceClass {
  code: string;
  name: string;
}

export const ICE_CLASSES: IceClass[] = [
${iceRows}
];

const BY_CODE = new Map(ICE_CLASSES.map((t) => [t.code, t.name]));

/** Vendored EN name for a code; falls back to the raw code. */
export function iceClassName(code: string): string {
  return BY_CODE.get(code) ?? code;
}
`,
);

// ---- types of navigation (spec 0040: "Type of navigation" dropdown) --------

const navCodes = shp.$defs['qdt:TypeOfNavigationCodeContentType'].enum;
if (!Array.isArray(navCodes) || navCodes.length === 0) {
  throw new Error('SHP schema: type-of-navigation enum missing');
}
const hub = JSON.parse(
  fs.readFileSync(path.join(root, 'vendor', 'nemo', 'hub', 'codelists.json'), 'utf8'),
);
const navList = hub.lists.find((l) => l.name === 'type_of_navigation');
if (!navList) throw new Error('hub codelists: type_of_navigation missing');
const navNames = new Map(navList.entries.map((e) => [e.id, e.en]));
const navRows = navCodes
  .map(
    (c) =>
      `  { code: ${JSON.stringify(c)}, name: ${JSON.stringify(navNames.get(c) ?? c)} },`,
  )
  .join('\n');

fs.writeFileSync(
  path.join(root, 'app', 'src', 'generated', 'navigation-types.ts'),
  banner(
    [
      'vendor/nemo/mig/2.0.1.0/SHP_2.0.1.0.json (qdt:TypeOfNavigationCodeContentType)',
      'vendor/nemo/hub/codelists.json (type_of_navigation names)',
    ],
    '0040',
  ) +
    `
export interface NavigationType {
  code: string;
  name: string;
}

export const NAVIGATION_TYPES: NavigationType[] = [
${navRows}
];

const BY_CODE = new Map(NAVIGATION_TYPES.map((t) => [t.code, t.name]));

/** Vendored EN name for a code; falls back to the raw code. */
export function navigationTypeName(code: string): string {
  return BY_CODE.get(code) ?? code;
}
`,
);

// ---- countries (spec 0041: FI-first country selects) -----------------------

const iso = read('vendor/national-spreadsheet/codelists/iso3166_1_alpha_2_unedifact3207.json');
const fi = iso.entries.find((e) => e.id === 'FI');
if (!fi) throw new Error('iso3166 codelist: FI missing');
const countries = [fi, ...iso.entries.filter((e) => e.id !== 'FI')];
const countryRows = countries
  .map((e) => `  { code: ${JSON.stringify(e.id)}, name: ${JSON.stringify(e.en)} },`)
  .join('\n');

fs.writeFileSync(
  path.join(root, 'app', 'src', 'generated', 'countries.ts'),
  banner(
    ['vendor/national-spreadsheet/codelists/iso3166_1_alpha_2_unedifact3207.json'],
    '0041',
  ) +
    `
export interface Country {
  code: string;
  name: string;
}

/** ISO 3166-1 alpha-2, Finland pinned first (spec 0041). */
export const COUNTRIES: Country[] = [
${countryRows}
];

const BY_CODE = new Map(COUNTRIES.map((t) => [t.code, t.name]));

/** Vendored EN name for a code; falls back to the raw code. */
export function countryName(code: string): string {
  return BY_CODE.get(code) ?? code;
}
`,
);

console.log(
  `wrote ship-type-codes.ts / ship-types.ts (${typeCodes.length} types), ice-classes.ts (${iceCodes.length} classes), navigation-types.ts (${navCodes.length} types), countries.ts (${countries.length} countries)`,
);
