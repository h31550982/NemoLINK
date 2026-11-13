/**
 * Classification + extraction for the supported ship forms (docs/specs/0049).
 * Fingerprints are workbook content (title cells, sheet names) — never the
 * file name. Extraction is honest v1: the NSW forms are mapped against real
 * filled samples; FAL and MDH are label-position best-effort, which is why
 * every parse also carries the stored grid (workbook.ts). Pure functions —
 * no IO, no logging (crew/passenger rows are PII; invariant 3).
 */

import { SheetGrid, StoredGrid, readGrids, toStoredGrids } from './workbook';

export type FormType =
  | 'nsw-crew'
  | 'nsw-pax'
  | 'nsw-security'
  | 'nsw-waste'
  | 'nmsw-mdh'
  | 'fal1'
  | 'fal2'
  | 'fal3'
  | 'fal4'
  | 'fal5'
  | 'fal6'
  | 'fal7';

export const FORM_NAMES: Record<FormType, string> = {
  'nsw-crew': 'NSW crew list',
  'nsw-pax': 'NSW passenger list',
  'nsw-security': 'NSW security notification',
  'nsw-waste': 'NSW waste notification',
  'nmsw-mdh': 'Maritime declaration of health',
  fal1: 'IMO FAL 1 — General declaration',
  fal2: 'IMO FAL 2 — Cargo declaration',
  fal3: 'IMO FAL 3 — Ship’s stores declaration',
  fal4: 'IMO FAL 4 — Crew’s effects declaration',
  fal5: 'IMO FAL 5 — Crew list',
  fal6: 'IMO FAL 6 — Passenger list',
  fal7: 'IMO FAL 7 — Dangerous goods manifest',
};

export type FormContext = 'arrival' | 'departure' | 'both';

export interface ParsedForm {
  formType: FormType;
  formName: string;
  /** The form's own Arrival / Departure X boxes, where it has them. */
  context: FormContext | null;
  /** Header facts as written — ship name, IMO, ports, counts, … */
  fields: Record<string, string>;
  /** The form's main table (crew, passengers, waste items, …). */
  rows: Record<string, string>[] | null;
  /** Plain-words noun for the rows: "crew members", "waste items", … */
  rowsLabel: string | null;
  rowsTruncated: boolean;
  warnings: string[];
  /** The sheet every value was read from (the workbook's first form sheet). */
  sheet?: string;
  /**
   * Where each value sits in that sheet (spec 0093 step 1): the same paths
   * the checks and corrections use (`fields.<key>`, `rows.<i>.<key>`) →
   * A1 address. The corrected-file writer patches exactly these cells.
   * Absent on documents parsed before 0093 — re-parse the stored bytes.
   */
  cells?: Record<string, string>;
}

// ---- small grid helpers ----------------------------------------------------

/** A value read from the grid, with where it sits. */
interface Hit {
  value: string;
  r: number;
  c: number;
}

/** Zero-based grid position → A1 address ("A1", "AB12"). */
export function a1(r: number, c: number): string {
  let col = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    col = String.fromCharCode(65 + ((n - 1) % 26)) + col;
  }
  return `${col}${r + 1}`;
}

function hitAt(rows: string[][], r: number, c: number): Hit | null {
  const value = (rows[r] ?? [])[c] ?? '';
  return value === '' ? null : { value, r, c };
}

function norm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function findCell(
  rows: string[][],
  pred: (text: string) => boolean,
  maxRows = rows.length,
): { r: number; c: number } | null {
  for (let r = 0; r < Math.min(rows.length, maxRows); r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== '' && pred(norm(row[c]))) return { r, c };
    }
  }
  return null;
}

/**
 * The cell immediately right of a label — deliberately narrow: scanning
 * further hits the NEXT label in label/value/label layouts (MDH taught us).
 */
function valueRight(rows: string[][], r: number, c: number): Hit | null {
  return hitAt(rows, r, c + 1);
}

/** First non-empty cell below (r, c), scanning a narrow column window. */
function valueBelow(rows: string[][], r: number, c: number, span = 2): Hit | null {
  for (let i = c; i <= c + span; i++) {
    const hit = hitAt(rows, r + 1, i);
    if (hit) return hit;
  }
  return null;
}

const MAX_TABLE_ROWS = 2000;

interface ColDef {
  key: string;
  match: (header: string) => boolean;
  /** Ordinal columns ("No") never make a row count as filled. */
  ordinal?: boolean;
}

/**
 * Generic labeled-table extraction: find the header row, map columns by
 * header text, take every following row with real content in a mapped
 * non-ordinal column. Blank spacer rows are skipped, but a long run
 * without content (`maxGap`) ends the table — the cells further down are
 * a different section of the form, not more rows (FAL footers, the MDH
 * crew-change block).
 */
function extractTable(
  rows: string[][],
  headerPred: (rowText: string[]) => boolean,
  cols: ColDef[],
  maxGap = 15,
): { rows: Record<string, string>[]; refs: Record<string, string>[]; truncated: boolean } | null {
  let headerRow = -1;
  for (let r = 0; r < rows.length; r++) {
    if (headerPred(rows[r].map(norm))) {
      headerRow = r;
      break;
    }
  }
  if (headerRow === -1) return null;
  const colIndex = new Map<string, number>();
  rows[headerRow].forEach((cell, i) => {
    if (cell === '') return;
    const header = norm(cell);
    for (const def of cols) {
      if (!colIndex.has(def.key) && def.match(header)) colIndex.set(def.key, i);
    }
  });
  const out: Record<string, string>[] = [];
  const refs: Record<string, string>[] = [];
  let truncated = false;
  let gap = 0;
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const record: Record<string, string> = {};
    const ref: Record<string, string> = {};
    let filled = false;
    for (const def of cols) {
      const i = colIndex.get(def.key);
      const value = i === undefined ? '' : (row[i] ?? '');
      if (value !== '') {
        record[def.key] = value;
        ref[def.key] = a1(r, i!);
        if (!def.ordinal) filled = true;
      }
    }
    if (!filled) {
      gap++;
      if (gap > maxGap) break;
      continue;
    }
    gap = 0;
    if (out.length >= MAX_TABLE_ROWS) {
      truncated = true;
      break;
    }
    out.push(record);
    refs.push(ref);
  }
  return { rows: out, refs, truncated };
}

/** Put a table on the form: its rows, their cell addresses, the noun. */
function setTable(
  form: ParsedForm,
  table: ReturnType<typeof extractTable>,
  label: string,
): void {
  form.rows = table?.rows ?? [];
  form.rowsTruncated = table?.truncated ?? false;
  form.rowsLabel = label;
  table?.refs.forEach((ref, i) => {
    for (const [key, addr] of Object.entries(ref)) form.cells![`rows.${i}.${key}`] = addr;
  });
}

const starts = (prefix: string) => (h: string) => h.startsWith(prefix);
const has = (part: string) => (h: string) => h.includes(part);

/**
 * The form's own Arrival / Departure boxes: an 'X' (or 'yes') beside the
 * word — NSW marks to the right, the FAL grid sometimes to the left.
 */
function detectContext(rows: string[][], maxRows = 8): FormContext | null {
  const marked = { arrival: false, departure: false };
  for (let r = 0; r < Math.min(rows.length, maxRows); r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const word = norm(row[c]);
      if (word !== 'arrival' && word !== 'departure') continue;
      const neighbors = [row[c + 1], row[c + 2], row[c - 1], row[c - 2]];
      if (neighbors.some((n) => /^x$/i.test((n ?? '').trim()))) {
        marked[word] = true;
      }
    }
  }
  if (marked.arrival && marked.departure) return 'both';
  if (marked.arrival) return 'arrival';
  if (marked.departure) return 'departure';
  return null;
}

/** NSW header block: labels in one row, the values directly beneath. */
function nswShipFields(rows: string[][], form: ParsedForm): void {
  const pairs: [string, string][] = [
    ['shipName', 'name of ship'],
    ['imo', 'imo number'],
    ['portnetNumber', 'portnet number'],
  ];
  for (const [key, label] of pairs) {
    const at = findCell(rows, (t) => t === label, 8);
    if (at) setIf(form, key, valueBelow(rows, at.r, at.c, 0));
  }
}

function setIf(form: ParsedForm, key: string, hit: Hit | null): void {
  if (!hit) return;
  form.fields[key] = hit.value;
  form.cells![`fields.${key}`] = a1(hit.r, hit.c);
}

// ---- classification --------------------------------------------------------

export function classify(grids: SheetGrid[]): FormType | null {
  const first = grids[0];
  if (!first) return null;
  const top: string[] = [];
  for (let r = 0; r < Math.min(first.rows.length, 4); r++) {
    for (const cell of first.rows[r]) if (cell !== '') top.push(norm(cell));
  }
  const names = grids.map((g) => norm(g.name));
  const anyTop = (pred: (t: string) => boolean) => top.some(pred);

  if (anyTop(starts('nsw crew list'))) return 'nsw-crew';
  if (anyTop(starts('nsw passenger list'))) return 'nsw-pax';
  if (anyTop(starts('nsw security'))) return 'nsw-security';
  if (anyTop(starts('nsw waste'))) return 'nsw-waste';
  if (anyTop(has('maritime declaration of health'))) return 'nmsw-mdh';
  if (
    anyTop(starts('imo general declaration')) ||
    anyTop(starts('imo - yleisselvitys')) ||
    names.some((n) => n === 'imo general declaration' || n === 'imo-yleisselvitys')
  ) {
    return 'fal1';
  }
  for (const t of top) {
    const m = /\(imo fal form (\d)\)/.exec(t);
    if (m && Number(m[1]) >= 2 && Number(m[1]) <= 7) {
      return `fal${m[1]}` as FormType;
    }
  }
  return null;
}

// ---- per-form extractors ---------------------------------------------------

function parseNswCrew(rows: string[][], form: ParsedForm): void {
  nswShipFields(rows, form);
  const table = extractTable(
    rows,
    (r) => r.some(starts('rank or rating')) && r.some(starts('first name')),
    [
      { key: 'no', match: (h) => h === 'no', ordinal: true },
      { key: 'rank', match: starts('rank or rating') },
      { key: 'firstName', match: starts('first name') },
      { key: 'lastName', match: starts('last name') },
      { key: 'dateOfBirth', match: starts('date of birth') },
      { key: 'placeOfBirth', match: starts('place of birth') },
      { key: 'gender', match: starts('gender') },
      { key: 'nationality', match: starts('nationality') },
      { key: 'idDocumentNature', match: starts('nature of identity') },
      { key: 'idDocumentNumber', match: starts('number of identity') },
      { key: 'visaType', match: starts('type of visa') },
      { key: 'visaNumber', match: starts('serial number of visa') },
      { key: 'transit', match: starts('transit') },
    ],
  );
  setTable(form, table, 'crew members');
}

function parseNswPax(rows: string[][], form: ParsedForm): void {
  nswShipFields(rows, form);
  const table = extractTable(
    rows,
    (r) => r.some(starts('first name')) && r.some(starts('last name')),
    [
      { key: 'firstName', match: starts('first name') },
      { key: 'lastName', match: starts('last name') },
      { key: 'nationality', match: starts('nationality') },
      { key: 'dateOfBirth', match: starts('date of birth') },
      { key: 'placeOfBirth', match: starts('place of birth') },
      { key: 'gender', match: starts('gender') },
      { key: 'idDocumentType', match: starts('type of identity') },
      { key: 'idDocumentNumber', match: starts('serial number of identity') },
      { key: 'embarkationPort', match: starts('port of embarkation') },
      { key: 'disembarkationPort', match: starts('port of disembarkation') },
    ],
  );
  setTable(form, table, 'passengers');
}

function parseNswSecurity(rows: string[][], form: ParsedForm): void {
  const table = extractTable(
    rows,
    (r) => r.some(starts('date of arrival')) && r.some(starts('port (locode')),
    [
      { key: 'no', match: (h) => h === 'no', ordinal: true },
      { key: 'arrival', match: starts('date of arrival') },
      { key: 'departure', match: starts('date of departure') },
      { key: 'portLocode', match: starts('port (locode') },
      { key: 'facilityGisis', match: has('gisis') },
      { key: 'securityLevel', match: starts('security level') },
      { key: 'measures', match: starts('special') },
    ],
  );
  setTable(form, table, 'port facility calls');
}

function parseNswWaste(rows: string[][], form: ParsedForm): void {
  nswShipFields(rows, form);
  const facts: [string, string][] = [
    ['lastPortDelivered', 'last port delivered'],
    ['dateOfDelivery', 'date of delivery'],
    ['amountOfDisposal', 'amount of disposal'],
    ['nextPortOfDelivery', 'next port of delivery'],
  ];
  for (const [key, label] of facts) {
    const at = findCell(rows, (t) => t === label, 8);
    if (at) setIf(form, key, valueRight(rows, at.r, at.c));
  }
  const table = extractTable(
    rows,
    (r) => r.some(starts('waste type')),
    [
      { key: 'type', match: starts('waste type'), ordinal: true },
      { key: 'toDeliver', match: starts('waste to be delivered') },
      { key: 'maxCapacity', match: starts('maximum dedicated') },
      // "on board" (older forms, Kestrel) or "retained on board" (the 1003e template)
      { key: 'onBoard', match: (h) => h.startsWith('amount of waste') && h.includes('on board') },
      { key: 'deliveryPort', match: starts('port of delivery') },
      { key: 'estimatedGenerated', match: starts('estimated amount') },
      { key: 'deliveredLastPort', match: starts('waste that has been delivered') },
    ],
  );
  setTable(form, table, 'waste items');
  // "Plastics 501" → the fixed NSW waste type code rides in the label
  form.rows = form.rows!.map((row, i) => {
    const m = row['type'] ? /^(.*\S)\s+(\d{3})$/.exec(row['type']) : null;
    if (!m) return row;
    form.cells![`rows.${i}.typeCode`] = form.cells![`rows.${i}.type`];
    return { ...row, type: m[1], typeCode: m[2] };
  });
}

function parseMdh(rows: string[][], form: ParsedForm): void {
  const facts: [string, (t: string) => boolean][] = [
    ['shipName', (t) => t === 'name of ship'],
    ['imo', (t) => t === 'imo number'],
    ['flagState', starts('flag state of ship')],
    ['shipType', starts('type of ship')],
    ['grossTonnage', starts('gross tonnage')],
    ['master', starts('name of master')],
    ['arrivingFrom', starts('arriving from')],
    ['sailingTo', starts('sailing to')],
    ['arrivalDate', starts('date of arrival')],
    ['arrivalTime', starts('time of arrival')],
    ['agentName', starts('name of ship agent')],
    ['crewCount', starts('number of crew members on board')],
    ['passengerCount', starts('number of passengers on board')],
    // The declaration's answers and their details (spec 0096: the health table)
    ['sanitationCertificate', starts('valid sanitation control exemption / control certificate carried')],
    ['sanitationPlace', starts('valid sanitation control exemption / control certificate place')],
    ['sanitationDate', starts('valid sanitation control exemption/control certificate date')],
    ['reinspection', starts('re-inspection required')],
    ['affectedArea', starts('has ship / vessel visited an affected area')],
    ['affectedWhere', starts('if yes - name of port')],
    ['personDied', starts('has any person died')],
    ['deathCount', starts('total no. of deaths')],
    ['infectiousDisease', starts('is there on board or has there been')],
    ['illGreater', starts('has the total number of ill')],
    ['illCount', starts('how many ill persons')],
    ['illNow', starts('is there any ill person on board now')],
    ['practitioner', starts('was a medical practitioner')],
    ['infectionCondition', starts('are you aware of any condition')],
    ['sanitaryMeasure', starts('has any sanitary measure')],
    ['sanitaryDetails', starts('if yes, specify type, place and date')],
    ['stowaways', starts('have any stowaways been found')],
    ['stowawayPort', starts('if yes, where did they join')],
    ['sickAnimal', starts('is there a sick animal')],
  ];
  for (const [key, pred] of facts) {
    const at = findCell(rows, pred);
    if (at) setIf(form, key, valueRight(rows, at.r, at.c));
  }
  const table = extractTable(
    rows,
    (r) => r.some(starts('port name')) && r.some(has('locode')),
    [
      { key: 'no', match: (h) => h === 'number', ordinal: true },
      { key: 'dateFrom', match: starts('date from') },
      { key: 'dateTo', match: starts('date to') },
      { key: 'portName', match: starts('port name') },
      { key: 'country', match: starts('country') },
      { key: 'locode', match: has('locode') },
    ],
    // The crew-change block sits right under the ports table — stop early
    3,
  );
  // ...and its heading ("Surname / Joined from") can still land as a row: a
  // port of call names a port, so a row with neither name nor code is not one
  if (table) {
    const keep = table.rows.map((r) => !!(r['locode'] || r['portName']));
    table.rows = table.rows.filter((_, i) => keep[i]);
    table.refs = table.refs.filter((_, i) => keep[i]);
  }
  setTable(form, table, 'ports of call');
}

/**
 * FAL 1 boxes are numbered in every language ("5. Name of master" /
 * "5. Päällikön nimi") — the number is the join key, the value sits in
 * the box below the label.
 */
const FAL1_FIELD_BY_NUMBER: Record<string, string> = {
  '1': 'shipName',
  '2': 'port',
  '3': 'dateTime',
  '4': 'flagState',
  '5': 'master',
  '6': 'fromToPort',
  '8': 'agent',
  '9': 'grossTonnage',
  '10': 'netTonnage',
  '11': 'positionInPort',
  '13': 'cargoDescription',
  '14': 'crewCount',
  '15': 'passengerCount',
};

function parseFal1(rows: string[][], form: ParsedForm): void {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const m = /^(\d{1,2})\.\s/.exec(row[c]);
      if (!m) continue;
      const key = FAL1_FIELD_BY_NUMBER[m[1]];
      if (!key || form.fields[key] !== undefined) continue;
      setIf(form, key, valueBelow(rows, r, c));
    }
  }
  // The English sheet's first box drops the "1." — label fallback
  if (form.fields['shipName'] === undefined) {
    const name = findCell(rows, has('name and type of ship'), 8);
    if (name) setIf(form, 'shipName', valueBelow(rows, name.r, name.c));
  }
  const callSign = findCell(rows, has('radio call sign'));
  if (callSign) setIf(form, 'callSign', valueBelow(rows, callSign.r, callSign.c));
  const imo = findCell(rows, has('imo-number'));
  if (imo) setIf(form, 'imo', valueBelow(rows, imo.r, imo.c));
}

/** The shared FAL 2–7 header boxes (1.1 ship … 1.4 voyage, flag, ports). */
function falHeaderFields(rows: string[][], form: ParsedForm): void {
  const facts: [string, (t: string) => boolean][] = [
    ['shipName', starts('1.1 name of ship')],
    ['imo', starts('1.2')],
    ['callSign', starts('1.3')],
    ['voyageNumber', starts('1.4')],
    ['flagState', has('flag')],
    ['port', (t) => /^2\.? port/.test(t)],
    ['date', (t) => /^3\.? date/.test(t)],
    ['master', (t) => /^\d+\.? name of master/.test(t)],
  ];
  for (const [key, pred] of facts) {
    const at = findCell(rows, pred, 14);
    if (at) setIf(form, key, valueBelow(rows, at.r, at.c));
  }
}

const FAL_TABLES: Partial<
  Record<FormType, { label: string; header: (r: string[]) => boolean; cols: ColDef[] }>
> = {
  fal2: {
    label: 'cargo items',
    header: (r) => r.some(has('marks and numbers')),
    cols: [
      { key: 'blNumber', match: (h) => h === 'b/l', ordinal: true },
      { key: 'marksAndNumbers', match: has('marks and numbers') },
      { key: 'packages', match: has('number and kind of packages') },
      { key: 'description', match: has('description of goods') },
      { key: 'hsCode', match: (h) => h.includes('hs code') || h.includes('commodity code') },
      { key: 'grossWeight', match: has('gross weight') },
      { key: 'measurement', match: has('measurement') },
      { key: 'loadingPort', match: has('port of loading') },
      { key: 'dischargePort', match: has('port of discharge') },
    ],
  },
  fal3: {
    label: 'store articles',
    header: (r) => r.some(has('name of article')),
    cols: [
      { key: 'article', match: has('name of article') },
      { key: 'quantity', match: has('quantity') },
      { key: 'location', match: has('location') },
    ],
  },
  fal4: {
    label: 'crew effects',
    header: (r) => r.some(has('family name')),
    cols: [
      { key: 'no', match: (h) => /\bno$/.test(h), ordinal: true },
      { key: 'name', match: has('family name') },
      { key: 'rank', match: has('rank') },
      { key: 'effects', match: has('effects') },
    ],
  },
  fal5: {
    label: 'crew members',
    header: (r) => r.some(has('family name')),
    cols: [
      { key: 'no', match: (h) => /\bno$/.test(h), ordinal: true },
      { key: 'name', match: has('family name') },
      { key: 'rank', match: has('rank') },
      { key: 'nationality', match: has('nationality') },
      { key: 'dateAndPlaceOfBirth', match: has('birth') },
      { key: 'idDocument', match: has('identity document') },
    ],
  },
  fal6: {
    label: 'passengers',
    header: (r) => r.some(has('family name')),
    cols: [
      { key: 'name', match: has('family name') },
      { key: 'nationality', match: has('nationality') },
      { key: 'dateAndPlaceOfBirth', match: has('birth') },
      { key: 'idDocumentType', match: has('type of identity') },
      { key: 'idDocumentNumber', match: has('serial number') },
      { key: 'embarkationPort', match: has('port of embarkation') },
      { key: 'disembarkationPort', match: has('port of disembarkation') },
    ],
  },
  fal7: {
    label: 'dangerous goods items',
    header: (r) => r.some(has('proper shipping name')),
    cols: [
      { key: 'bookingReference', match: has('booking reference'), ordinal: true },
      { key: 'marksAndNumbers', match: has('marks') },
      { key: 'packages', match: has('number and kind') },
      { key: 'properShippingName', match: has('proper shipping name') },
      { key: 'class', match: (h) => h === 'class' || starts('9 class')(h) },
      { key: 'unNumber', match: has('un no') },
      { key: 'packingGroup', match: has('packing group') },
    ],
  },
};

// ---- entry point -----------------------------------------------------------

export interface ParseResult {
  form: ParsedForm | null;
  /** Nothing a ship typed is lost — sparse cells of the form sheets. */
  grid: StoredGrid[];
  gridTruncated: boolean;
}

/**
 * Parse an uploaded spreadsheet. `form` is null when the workbook is not
 * a recognized form (caller stores it `unrecognized`, grid kept). Throws
 * when the bytes will not open as a workbook at all (caller → `failed`).
 */
export function parseForm(buf: Buffer): ParseResult {
  const grids = readGrids(buf);
  const stored = toStoredGrids(grids);
  const formType = classify(grids);
  if (!formType) {
    return { form: null, grid: stored.grids, gridTruncated: stored.truncated };
  }
  const form: ParsedForm = {
    formType,
    formName: FORM_NAMES[formType],
    context: null,
    fields: {},
    rows: null,
    rowsLabel: null,
    rowsTruncated: false,
    warnings: [],
    sheet: grids[0].name,
    cells: {},
  };
  const rows = grids[0].rows;
  form.context = detectContext(rows);

  switch (formType) {
    case 'nsw-crew':
      parseNswCrew(rows, form);
      break;
    case 'nsw-pax':
      parseNswPax(rows, form);
      break;
    case 'nsw-security':
      parseNswSecurity(rows, form);
      break;
    case 'nsw-waste':
      parseNswWaste(rows, form);
      break;
    case 'nmsw-mdh':
      parseMdh(rows, form);
      break;
    case 'fal1':
      parseFal1(rows, form);
      break;
    default: {
      falHeaderFields(rows, form);
      const spec = FAL_TABLES[formType];
      if (spec) {
        setTable(form, extractTable(rows, spec.header, spec.cols), spec.label);
      }
    }
  }

  if (form.rowsLabel && (form.rows?.length ?? 0) === 0) {
    form.warnings.push(`no ${form.rowsLabel} filled in`);
  }
  if (Object.keys(form.fields).length === 0 && (form.rows?.length ?? 0) === 0) {
    form.warnings.push('the form appears to be an empty template');
  }
  return { form, grid: stored.grids, gridTruncated: stored.truncated };
}

/** Cargo uploads predate the review adapter. Read their immutable originals
 *  with the current column map; corrections remain a separate overlay. */
export function refreshCargoForm(form: ParsedForm | null | undefined, content: Buffer | null | undefined): ParsedForm | null {
  if (!form || form.formType !== 'fal2' || !content) return form ?? null;
  const fresh = parseForm(content).form;
  return fresh?.formType === 'fal2' ? fresh : form;
}

/** The list-safe view (no PII): form, context, ship as written, counts. */
export function summarize(form: ParsedForm): Record<string, unknown> {
  return {
    formName: form.formName,
    context: form.context,
    ...(form.fields['shipName'] ? { shipName: form.fields['shipName'] } : {}),
    ...(form.fields['imo'] ? { imo: form.fields['imo'] } : {}),
    ...(form.rowsLabel
      ? { rowCount: form.rows?.length ?? 0, rowsLabel: form.rowsLabel }
      : {}),
    ...(form.warnings.length > 0 ? { warnings: form.warnings } : {}),
  };
}
