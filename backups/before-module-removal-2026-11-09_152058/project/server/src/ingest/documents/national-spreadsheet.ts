/**
 * The National Spreadsheet, prefilled (docs/specs/0093 step 5, 0096 build
 * step 4): NEMO's own workbook (NationalSpreadsheetV2.0.1) with the call's
 * reviewed NEMO tables written into their sheets — crew and effects,
 * stores, waste, security. NEMOLink's backup when the NEMO API is down: the
 * file is uploaded through NEMO's web UI as is.
 *
 * Values are written the way the workbook's own inputs take them: a coded
 * cell as its dropdown's text ("CRE-001 – Alcoholic spirits", read from the
 * workbook's code-list sheets, so a new template brings its own words),
 * dates as dd.mm.yyyy, numbers as numbers. Only input cells are touched;
 * every other part of NEMO's workbook stays as NEMO made it.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { CellWrite, keepSheets, rowStyles, writeSheets } from './corrected-file';
import { LISTS } from './form-codes';
import type { MergedTable, TableCell, TableRow } from './form-tables';

const TEMPLATE = 'NationalSpreadsheetV2.0.1.xlsx';
const CREW_SHEET = "Crew list and crew's effects";
const PAX_SHEET = 'Passenger list';
const STORES_SHEET = "Ship's stores";

/**
 * NEMO's workbook read once per process: the dropdown texts, the waste
 * sheet's fixed rows, and `slim` — the template already cut to the table
 * sheets (lookups dropped, far cells and unused strings trimmed). Every
 * download starts from `slim`: slimming the 6.5 MB original took about
 * two seconds a download.
 */
let cached: {
  buf: Buffer;
  slim: Buffer;
  dropdowns: Map<string, Map<string, string>>;
  wasteRows: Map<string, number>;
} | null = null;

/** The code-list sheets the dropdowns point at: [sheet, display column]. */
const DROPDOWN_OF: Record<string, [string, string]> = {
  [LISTS.crewRank]: ['imo_compendium_IMO0043', 'C'],
  [LISTS.nationality]: ['iso3166_1_alpha_3_iso_iec_7501', 'E'],
  [LISTS.country]: ['iso3166_1_alpha_3_iso_3166_3', 'C'],
  [LISTS.gender]: ['un_edifact_3499', 'C'],
  [LISTS.identityDocument]: ['un_edifact_1001', 'C'],
  iso3166_1_alpha_2_unedifact3207: ['iso3166_1_alpha_2_unedifact3207', 'C'],
  [LISTS.crewEffects]: ['crew_effects', 'C'],
  [LISTS.storesArticle]: ['ship_stores_article', 'C'],
  issc_type: ['issc_type', 'C'],
  currentSecurityLevel: ['imo_compendium_IMO0137', 'E'],
  un_edifact_3035: ['un_edifact_3035', 'E'],
  callSecurityLevel: ['imo_compendium_IMO0149', 'C'],
};

function template(): NonNullable<typeof cached> {
  if (cached) return cached;
  const buf = readFileSync(join(__dirname, 'templates', TEMPLATE));
  const sheets = [...new Set(Object.values(DROPDOWN_OF).map(([s]) => s))];
  const wb = XLSX.read(buf, { type: 'buffer', sheets });
  const dropdowns = new Map<string, Map<string, string>>();
  for (const [key, [sheet, col]] of Object.entries(DROPDOWN_OF)) {
    const ws = wb.Sheets[sheet];
    const map = new Map<string, string>();
    if (ws) {
      const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
      for (let r = 1; r <= range.e.r; r++) {
        const code = ws[`A${r + 1}`]?.v;
        const text = ws[`${col}${r + 1}`]?.v;
        if (code !== undefined && text) map.set(String(code), String(text));
      }
    }
    dropdowns.set(key, map);
  }
  const slim = keepSheets(buf, Object.values(SHEETS).map((s) => s.replace('’', "'")));
  cached = { buf, slim, dropdowns, wasteRows: wasteRowsOf(buf) };
  return cached;
}

/** Reads the template ahead of the first download (server start); a failure waits for that download. */
export function warmNationalSpreadsheet(): void {
  try {
    template();
  } catch {
    // The download itself reports it
  }
}

/** A code as its dropdown's text; the bare code when the template has no entry. */
function dropdown(key: string, code: string | null): string | null {
  if (!code) return null;
  return template().dropdowns.get(key)?.get(code) ?? code;
}

/** ISO date → the sheets' dd.mm.yyyy. */
function ddmmyyyy(iso: string | null): string | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

const num = (v: string | null) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : v);
const val = (c: TableCell | undefined) => (c?.value ?? null);

const UNITS_CREW: Record<string, string> = {
  KGM: 'KGM / kilogram', TNE: 'TNE / metric ton', MTQ: 'MTQ / cubic metre', LTR: 'LTR / litre', NAR: 'NAR / number of articles',
};
const UNITS_STORES: Record<string, string> = {
  KGM: 'KGM / Kilogram', LTR: 'LTR / Litre', MTQ: 'MTQ / Cubic metre', NAR: 'NAR / Number of articles', TNE: 'TNE / Metric ton',
};

/**
 * Row-by-row writes from the first data row down, the sequence number in A.
 * Rows past the template's table (`last`) take its last row's styles, so an
 * added line looks like the table's — not like whatever sits below it.
 */
function rowsFrom(
  sheet: string,
  first: number,
  last: number,
  rows: TableRow[],
  cells: (row: TableRow) => Record<string, string | number | null>,
): CellWrite[] {
  const out: CellWrite[] = [];
  const styles = rows.length > last - first + 1 ? rowStyles(template().slim, sheet, last) : new Map<string, string>();
  rows.forEach((row, i) => {
    const r = first + i;
    const style = (col: string) => (r > last ? styles.get(col) : undefined);
    const put = (col: string, value: string | number) => {
      const s = style(col);
      out.push({ addr: `${col}${r}`, value, ...(s ? { style: s } : {}) });
    };
    put('A', i + 1);
    for (const [col, value] of Object.entries(cells(row))) {
      if (value !== null && value !== '') put(col, value);
    }
  });
  return out;
}

function crewSheet(t: MergedTable): CellWrite[] {
  const more: string[] = [];
  const writes = rowsFrom(CREW_SHEET, 11, 110, t.rows, (row) => {
    const c = row.cells;
    const item = row.items?.[0] ?? {};
    for (const extra of (row.items ?? []).slice(1)) {
      more.push(
        `${row.label}: ${[val(extra['effectsType']), val(extra['effectsDescription']), val(extra['effectsQuantity']), val(extra['effectsUnit'])].filter(Boolean).join(' ')}`,
      );
    }
    const unit = val(item['effectsUnit']);
    return {
      B: val(c['familyName']),
      C: val(c['givenName']),
      D: dropdown(LISTS.crewRank, val(c['rank'])),
      E: dropdown(LISTS.nationality, val(c['nationality'])),
      F: ddmmyyyy(val(c['dateOfBirth'])),
      G: val(c['placeOfBirth']),
      H: dropdown(LISTS.country, val(c['countryOfBirth'])),
      I: dropdown(LISTS.gender, val(c['gender'])),
      J: dropdown(LISTS.identityDocument, val(c['documentType'])),
      K: val(c['documentNumber']),
      L: dropdown('iso3166_1_alpha_2_unedifact3207', val(c['documentIssuer'])),
      M: ddmmyyyy(val(c['documentExpiry'])),
      N: val(c['residencePermit']),
      O: val(c['visaNumber']),
      P: dropdown(LISTS.crewEffects, val(item['effectsType'])),
      Q: val(item['effectsDescription']),
      R: num(val(item['effectsQuantity'])),
      S: unit ? (UNITS_CREW[unit] ?? unit) : null,
    };
  });
  writes.push({ addr: 'A6', value: 'Arrival' });
  if (more.length > 0) {
    // The sheet holds one effects item per crew member ("more on UI")
    writes.push({ addr: 'B6', value: `Further crew effects, to add in the NEMO UI: ${more.join('; ')}` });
  }
  return writes;
}

function storesSheet(t: MergedTable): CellWrite[] {
  const writes = rowsFrom(STORES_SHEET, 11, 20, t.rows, (row) => {
    const c = row.cells;
    const unit = val(c['unit']);
    return {
      B: dropdown(LISTS.storesArticle, val(c['article'])),
      C: val(c['articleName']),
      D: num(val(c['quantity'])),
      E: unit ? (UNITS_STORES[unit] ?? unit) : null,
      F: val(c['location']),
    };
  });
  writes.push({ addr: 'A6', value: 'Arrival' });
  return writes;
}

function passengerSheet(t: MergedTable): CellWrite[] {
  const writes = rowsFrom(PAX_SHEET, 11, 110, t.rows, (row) => {
    const c = row.cells;
    return {
      B: dropdown('un_edifact_3035', val(c['personType'])),
      C: val(c['familyName']),
      D: val(c['givenName']),
      E: dropdown(LISTS.nationality, val(c['nationality'])),
      F: ddmmyyyy(val(c['dateOfBirth'])),
      G: val(c['placeOfBirth']),
      H: dropdown(LISTS.country, val(c['countryOfBirth'])),
      I: dropdown(LISTS.gender, val(c['gender'])),
      J: val(c['embarkationPort']),
      K: val(c['disembarkationPort']),
      L: yesNo(val(c['inTransit'])),
      M: dropdown(LISTS.identityDocument, val(c['documentType'])),
      N: val(c['documentNumber']),
      O: ddmmyyyy(val(c['documentExpiry'])),
      P: dropdown('iso3166_1_alpha_2_unedifact3207', val(c['documentIssuer'])),
      Q: val(c['residencePermit']),
      R: val(c['visaNumber']),
      S: val(c['specialCare']),
      T: val(c['emergencyContact']),
    };
  });
  writes.push({ addr: 'A6', value: 'Arrival' });
  return writes;
}

/** The health declaration: every answer in its fixed cell (the sheet's own layout). */
function healthSheet(t: MergedTable): CellWrite[] {
  const h = t.header;
  const cells: [string, string | number | null][] = [
    ['A6', val(h['remarks'])],
    ['A11', yesNo(val(h['stowaways']))],
    ['C11', val(h['stowawayPort'])],
    ['A25', yesNo(val(h['sanitationValid']))],
    ['B25', yesNo(val(h['reinspection']))],
    ['C25', ddmmyyyy(val(h['sanitationDate']))],
    ['D25', val(h['sanitationPort'])],
    ['A30', yesNo(val(h['infectedArea']))],
    ['B30', ddmmyyyy(val(h['infectedDate']))],
    ['C30', val(h['infectedPort'])],
    ['A35', yesNo(val(h['personDied']))],
    ['B35', num(val(h['deathCount']))],
    ['A39', yesNo(val(h['disease']))],
    ['A43', yesNo(val(h['illGreater']))],
    ['B43', num(val(h['illCount']))],
    ['A47', yesNo(val(h['illNow']))],
    ['A51', yesNo(val(h['practitioner']))],
    ['A55', yesNo(val(h['infection']))],
    ['A59', yesNo(val(h['sanitaryMeasure']))],
    ['D59', val(h['sanitaryDetails'])],
    ['A73', yesNo(val(h['sickAnimal']))],
  ];
  return cells.filter(([, v]) => v !== null && v !== '').map(([addr, value]) => ({ addr, value: value! }));
}

/** The waste sheet's rows are fixed: each waste code has its own row (11–40). */
function wasteSheet(t: MergedTable, codeRows: Map<string, number>): CellWrite[] {
  const h = t.header;
  const writes: CellWrite[] = [];
  const head: [string, string | null][] = [
    ['A6', val(h['remarks'])],
    ['B6', ddmmyyyy(val(h['lastDeliveryDate']))],
    ['C6', val(h['lastDeliveryPort'])],
    ['D6', val(h['nextDeliveryPort'])],
  ];
  for (const [addr, value] of head) if (value) writes.push({ addr, value });
  for (const row of t.rows) {
    const r = codeRows.get(row.key);
    if (!r) continue;
    const c = row.cells;
    const cols: [string, string | number | null][] = [
      ['D', val(c['description'])],
      ['E', num(val(c['toDeliver']))],
      ['F', num(val(c['capacity']))],
      ['G', num(val(c['retained']))],
      ['H', val(c['remainderPort'])],
      ['I', num(val(c['generated']))],
    ];
    for (const [col, value] of cols) if (value !== null && value !== '') writes.push({ addr: `${col}${r}`, value });
  }
  return writes;
}

/** NEMO's yes/no dropdown: '1' → "1 / Yes", '0' → "0 / No". */
function yesNo(v: string | null): string | null {
  if (v === null || v === '') return null;
  return /^(1|y|yes|true|kyllä)/i.test(v) ? '1 / Yes' : '0 / No';
}

function securitySheet(t: MergedTable): CellWrite[] {
  const h = t.header;
  const writes: CellWrite[] = [];
  const head: [string, string | null][] = [
    ['A7', val(h['otherMatters'])],
    ['B7', val(h['missingCalls'])],
    ['A17', dropdown('currentSecurityLevel', val(h['securityLevel']))],
    ['B17', yesNo(val(h['validIssc']))],
    ['A22', yesNo(val(h['validIssc']))],
    ['B22', ddmmyyyy(val(h['isscExpiry']))],
    ['C22', dropdown('issc_type', val(h['isscType']))],
    ['D22', val(h['rsoName'])],
    ['A26', val(h['csoGivenName'])],
    ['B26', val(h['csoFamilyName'])],
    ['C26', val(h['csoMobile'])],
    ['D26', val(h['csoEmail'])],
  ];
  for (const [addr, value] of head) if (value) writes.push({ addr, value });
  t.rows.slice(0, 10).forEach((row, i) => {
    const r = 31 + i;
    const c = row.cells;
    const cols: [string, string | null][] = [
      ['B', ddmmyyyy(val(c['start']))],
      ['C', ddmmyyyy(val(c['end']))],
      ['D', val(c['port'])],
      ['E', val(c['facility'])],
      ['F', dropdown('callSecurityLevel', val(c['level']))],
      ['H', val(c['measures'])],
    ];
    for (const [col, value] of cols) if (value) writes.push({ addr: `${col}${r}`, value });
  });
  return writes;
}

/** Waste code → its fixed row on the template's waste sheet (code in column C). */
function wasteRowsOf(buf: Buffer): Map<string, number> {
  const ws = XLSX.read(buf, { type: 'buffer', sheets: ['Waste notification'] }).Sheets['Waste notification'];
  const out = new Map<string, number>();
  for (let r = 11; r <= 60; r++) {
    const code = ws?.[`C${r}`]?.v;
    if (code !== undefined && /^\d{3}$/.test(String(code).trim())) out.set(String(code).trim(), r);
  }
  return out;
}

export const SHEETS: Record<MergedTable['key'], string> = {
  crew: 'Crew list and crew’s effects',
  passengers: 'Passenger list',
  health: 'Maritime declaration of health',
  stores: 'Ship’s stores',
  waste: 'Waste notification',
  security: 'Security notification',
};

/** NEMO's workbook with the call's tables written in. */
export function nationalSpreadsheet(tables: MergedTable[]): Buffer {
  const { slim, wasteRows } = template();
  const bySheet: Record<string, CellWrite[]> = {};
  for (const t of tables) {
    const sheet = SHEETS[t.key].replace('’', "'");
    if (t.key === 'crew') bySheet[sheet] = crewSheet(t);
    if (t.key === 'stores') bySheet[sheet] = storesSheet(t);
    if (t.key === 'waste') bySheet[sheet] = wasteSheet(t, wasteRows);
    if (t.key === 'security') bySheet[sheet] = securitySheet(t);
    if (t.key === 'passengers') bySheet[sheet] = passengerSheet(t);
    if (t.key === 'health') bySheet[sheet] = healthSheet(t);
  }
  // Only the tables with their values (user decision 2026-09-30): NEMO's
  // lookup sheets and the unfilled formalities are left out
  return keepSheets(writeSheets(slim, bySheet), Object.keys(bySheet));
}
